import type { ModuleStyles, StyleBundle, StylexCompilerOptions } from '@weapp-stylex/compiler'
import type { Compilation, Compiler, Module } from 'webpack'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assetText, backendBuildDependencies, createRpxOnlyPostcssTransformer, injectWebStyleLink, MiniProgramStyleEmitter, processRules, StylexSession, webAssetUrl, webCssHash } from '@weapp-stylex/compiler'

interface WebpackHostOptions {
  policyKey?: string
}

/** Recovers the configured host plugin instead of reconstructing its defaults. */
function findPxtransform(value: unknown): Parameters<typeof createRpxOnlyPostcssTransformer>[0] {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  if ('postcssPlugin' in value && value.postcssPlugin === 'postcss-pxtransform') {
    return value as Parameters<typeof createRpxOnlyPostcssTransformer>[0]
  }
  for (const item of Object.values(value)) {
    const found = findPxtransform(item)
    if (found) {
      return found
    }
  }
  return undefined
}

function collectStyles(compilation: Compilation, session: StylexSession): string {
  const metadata: ModuleStyles[] = []
  const visited = new Set<Module>()
  const collect = (module: Module) => {
    if (visited.has(module)) {
      return
    }
    visited.add(module)
    const info = module.buildInfo as { weappStylex?: ModuleStyles & { fingerprint?: string } }
    if (info?.weappStylex) {
      if (info.weappStylex.fingerprint !== session.fingerprint) {
        throw new Error('Stale StyleX Webpack cache. Clear the host cache and rebuild.')
      }
      metadata.push(info.weappStylex)
    }
    if ('modules' in module) {
      for (const child of (module as Module & { modules: Iterable<Module> }).modules) {
        collect(child)
      }
    }
  }
  for (const module of compilation.modules) {
    if (compilation.chunkGraph.getNumberOfModuleChunks(module)) {
      collect(module)
    }
  }
  session.prune([...visited].flatMap(module => 'resource' in module && typeof module.resource === 'string' ? [module.resource] : []))
  return processRules(metadata.flatMap(value => value.rules), session.options.target)
}

function webpackDevClient(): string {
  return `
let serial=0, appliedHash=null;
async function refresh(){
  const request=++serial;
  const response=await fetch(__webpack_public_path__+'__weapp_stylex__/manifest.json',{cache:'no-store'});
  if(!response.ok)return;
  const state=await response.json();
  if(request!==serial||state.errors||state.hash===appliedHash)return;
  appliedHash=state.hash;
  const owned=()=>document.querySelectorAll('link[data-weapp-stylex]');
  const old=owned()[0];
  if(!state.fileName){for(const link of owned())link.remove();return;}
  const link=document.createElement('link');link.rel='stylesheet';link.dataset.weappStylex='';
  link.href=__webpack_public_path__+state.fileName+'?v='+state.hash;
  link.addEventListener('load',()=>{if(appliedHash===state.hash){for(const other of owned())if(other!==link)other.remove();}else link.remove();},{once:true});
  link.addEventListener('error',()=>{if(appliedHash===state.hash)appliedHash=null;link.remove();},{once:true});
  if(old)old.before(link);else document.head.prepend(link);
}
const onUpdate=()=>{void refresh().catch(error=>console.error(error));};
const onMessage=event=>{
  if(event.source!==window)return;
  const data=event.data;
  if(typeof data==='string'?data.startsWith('webpackHotUpdate'):data&&['webpackOk','webpackStillOk','webpackWarnings'].includes(data.type))onUpdate();
};
window.addEventListener('message',onMessage);
if(import.meta.webpackHot)import.meta.webpackHot.dispose(()=>{window.removeEventListener('message',onMessage);serial++;});
onUpdate();
`
}

export class StylexWebpackPlugin {
  constructor(readonly options: StylexCompilerOptions = {}, readonly host: WebpackHostOptions = {}) {}
  apply(compiler: Compiler): void {
    const session = new StylexSession(this.options)
    const target = session.options.target ?? 'weapp'
    const web = target === 'web'
    const emitter = web ? undefined : new MiniProgramStyleEmitter(target)
    const convert = createRpxOnlyPostcssTransformer(findPxtransform(compiler.options.module.rules), path.join(compiler.context, '__weapp_stylex__/styles.css'))
    const policyKey = this.host.policyKey ?? 'taro-h5:rpx-only:v1'
    let previousCssAsset: string | undefined
    const removeOutput = async (name: string): Promise<void> => {
      const filesystem = compiler.outputFileSystem
      if (!filesystem?.unlink) {
        return
      }
      await new Promise<void>((resolve, reject) => {
        filesystem.unlink!(path.join(compiler.outputPath, name), (error) => {
          if (error && error.code !== 'ENOENT') {
            reject(error)
          }
          else {
            resolve()
          }
        })
      })
    }
    if (compiler.options.cache && compiler.options.cache.type === 'filesystem') {
      const cache = compiler.options.cache
      cache.version = `${cache.version ?? ''}:weapp-stylex:${session.fingerprint}:${web ? policyKey : target}`
      cache.buildDependencies = { ...cache.buildDependencies, weappStylex: [...(cache.buildDependencies?.weappStylex ?? []), ...backendBuildDependencies, typeof __filename === 'string' ? __filename : fileURLToPath(import.meta.url)] }
    }
    if (web && compiler.options.mode === 'development') {
      // WDS broadcasts only successful compiles. Its local emitter can belong
      // to a different physical Webpack peer group from this optional adapter.
      const client = `data:text/javascript,${encodeURIComponent(webpackDevClient())}`
      const originalEntry = compiler.options.entry
      compiler.options.entry = async () => {
        const entries = typeof originalEntry === 'function' ? await originalEntry() : originalEntry
        return Object.fromEntries(Object.entries(entries).map(([name, entry]) => [name, { ...entry, import: [client, ...(entry.import ?? [])] }]))
      }
    }
    compiler.hooks.thisCompilation.tap('weapp-stylex', (compilation) => {
      session.beginBuild()
      let css = ''
      let fileName: string | undefined
      compiler.webpack.NormalModule.getCompilationHooks(compilation).loader.tap('weapp-stylex', (context) => {
        Object.assign(context, { stylexSession: session })
      })
      if (web) {
        // Chunk membership is known here; this async hook precedes hashing.
        compilation.hooks.optimizeTree.tapPromise({ name: 'weapp-stylex', stage: Number.MAX_SAFE_INTEGER }, async () => {
          css = await convert(collectStyles(compilation, session))
          fileName = css.trim() ? `css/stylex-${webCssHash(css)}.css` : undefined
        })
        compilation.hooks.fullHash.tap('weapp-stylex', (hash) => {
          hash.update(css)
        })
        compilation.hooks.processAssets.tap({ name: 'weapp-stylex', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, () => {
          if (fileName && !compilation.errors.length) {
            if (compilation.getAsset(fileName)) {
              throw new Error(`StyleX CSS filename conflict: ${fileName}`)
            }
            compilation.emitAsset(fileName, new compiler.webpack.sources.RawSource(css))
          }
          if (compiler.options.mode === 'development') {
            const manifest = '__weapp_stylex__/manifest.json'
            if (compilation.getAsset(manifest)) {
              throw new Error(`StyleX dev manifest filename conflict: ${manifest}`)
            }
            compilation.emitAsset(manifest, new compiler.webpack.sources.RawSource(JSON.stringify({ hash: webCssHash(css), fileName: fileName ?? null, errors: Boolean(compilation.errors.length) })))
          }
        })
      }
      compilation.hooks.processAssets.tapPromise({ name: 'weapp-stylex', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT + 1 }, async () => {
        if (web) {
          if (compilation.errors.length) {
            if (fileName && fileName !== previousCssAsset) {
              compilation.deleteAsset(fileName)
            }
            if (compiler.options.mode === 'development') {
              compilation.updateAsset('__weapp_stylex__/manifest.json', new compiler.webpack.sources.RawSource(JSON.stringify({ hash: webCssHash(css), fileName: fileName ?? null, errors: true })))
            }
            return
          }
          const html = compilation.getAssets().filter(asset => asset.name.endsWith('.html'))
          if (fileName && !html.length) {
            throw new Error('StyleX H5 output requires an HTML entry to attach its stylesheet')
          }
          for (const asset of html) {
            if (fileName) {
              const configuredBase = compilation.outputOptions.publicPath
              const base = typeof configuredBase === 'string' && configuredBase !== 'auto' ? configuredBase : './'
              compilation.updateAsset(asset.name, new compiler.webpack.sources.RawSource(injectWebStyleLink(asset.source.source().toString(), webAssetUrl(base, fileName, asset.name))))
            }
          }
          if (previousCssAsset && previousCssAsset !== fileName) {
            compilation.deleteAsset(previousCssAsset)
            await removeOutput(previousCssAsset)
          }
          previousCssAsset = fileName
          return
        }
        const bundle: StyleBundle = {}
        for (const asset of compilation.getAssets()) {
          bundle[asset.name] = { type: 'asset', fileName: asset.name, source: asset.source.source().toString() }
        }
        await emitter!.generate(bundle, collectStyles(compilation, session), {
          emit: (name, source) => {
            const asset = new compiler.webpack.sources.RawSource(source)
            if (compilation.getAsset(name)) {
              compilation.updateAsset(name, asset)
            }
            else {
              compilation.emitAsset(name, asset)
            }
          },
          remove: async (name) => {
            compilation.deleteAsset(name)
            await removeOutput(name)
          },
        })
        const extension = target === 'alipay' ? '.acss' : target === 'tt' ? '.ttss' : '.wxss'
        for (const output of Object.values(bundle)) {
          if (output.type === 'asset' && output.fileName.endsWith(extension) && compilation.getAsset(output.fileName)) {
            compilation.updateAsset(output.fileName, new compiler.webpack.sources.RawSource(assetText(output)))
          }
        }
      })
    })
    compiler.hooks.shutdown.tap('weapp-stylex', () => {
      session.clear()
      emitter?.clear()
    })
  }
}
