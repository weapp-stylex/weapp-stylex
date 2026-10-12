import type { StylexSession } from './session.js'
import type { StyleBundle } from './wxss.js'
import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import MagicString from 'magic-string'
import { assetText } from './wxss.js'

export const WEB_CSS_ID = 'virtual:weapp-stylex/web-css'
const CLIENT_ID = 'virtual:weapp-stylex/web-client'
const STATE_PATH = '__weapp_stylex__/state'
const CSS_PATH = '__weapp_stylex__/styles.css'
const PAGE_MARKER = '__WEAPP_STYLEX_PAGE_CSS_9c73f6__'
const COMPONENT_MARKER = '__WEAPP_STYLEX_COMPONENT_CSS_9c73f6__'
type MaybePromise<T> = T | Promise<T>
type SessionSource = StylexSession | (() => StylexSession)

export interface WebStyleOptions {
  enabled?: boolean | (() => boolean)
  delivery?: 'document' | 'shadow'
  transformCss: (css: string) => MaybePromise<string>
  transformShadowCss?: (css: string) => MaybePromise<{ pageCss: string, componentCss: string }>
  policyKey?: string | (() => string)
}

export interface WebModuleNode {
  id: string | null
  importedModules: Set<WebModuleNode>
}
export interface WebServer {
  middlewares: { use: (handler: (request: { url?: string }, response: { setHeader: (name: string, value: string) => void, end: (body: string) => void, statusCode: number }, next: () => void) => void) => void }
  ws: { send: (message: unknown) => void }
  httpServer?: { once: (event: 'close', listener: () => void) => void } | null
  moduleGraph: {
    getModuleById: (id: string) => WebModuleNode | undefined
    getModuleByUrl?: (url: string) => Promise<WebModuleNode | undefined>
    getModulesByFile?: (id: string) => Set<WebModuleNode> | undefined
    // Method variance accepts Vite 4/5/8's richer ModuleNode parameter types.
    // eslint-disable-next-line ts/method-signature-style
    invalidateModule?(module: WebModuleNode): void
  }
}
export interface WebPluginHost {
  getModuleIds: () => IterableIterator<string>
  emitFile: (asset: { type: 'asset', fileName: string, source: string }) => string
  error: (message: string) => never
}
interface WebState {
  revision: number
  hash: string
  empty: boolean
  css: string
  pageCss: string
  componentCss: string
}

export function webCssHash(css: string): string {
  return createHash('sha256').update(css).digest('hex').slice(0, 16)
}

export function webAssetUrl(base: string, fileName: string, htmlFileName = 'index.html'): string {
  if (base === '' || base === './') {
    const relative = path.posix.relative(path.posix.dirname(htmlFileName), fileName)
    return relative.startsWith('.') ? relative : `./${relative}`
  }
  return `${base.endsWith('/') ? base : `${base}/`}${fileName}`
}

/** StyleX precedes application CSS, matching the mini-program import contract. */
export function injectWebStyleLink(html: string, href: string): string {
  if (html.includes('data-weapp-stylex')) {
    throw new Error('StyleX HTML ownership conflict: data-weapp-stylex is reserved')
  }
  const escaped = href.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
  const tag = `<link rel="stylesheet" data-weapp-stylex href="${escaped}">`
  const styles = [...html.matchAll(/<(?:link|style)\b[^>]*>/gi)].find(match => /^<style\b/i.test(match[0]) || /\brel\s*=\s*(?:["']stylesheet["']|stylesheet(?=\s|\/?>))/i.test(match[0]))
  const offset = styles?.index ?? html.search(/<\/head\s*>/i)
  if (offset < 0) {
    throw new Error('StyleX requires an HTML head to attach its stylesheet')
  }
  return `${html.slice(0, offset)}${tag}\n${html.slice(offset)}`
}

function clientCode(stateUrl: string, cssUrl: string, shadow: boolean): string {
  const common = `
const stateUrl=${JSON.stringify(stateUrl)};
let appliedHash=null, revision=-1, disposed=false, ready=document.readyState==='complete';
async function readState(ready=false){
  const response=await fetch(stateUrl+(ready?'?ready=1':''),{cache:'no-store'});
  if(!response.ok)throw new Error('Cannot read StyleX dev styles');
  return response.json();
}
function onUpdate(){ void refresh(ready).catch(error=>console.error(error)); }
function onReady(){ready=true;onUpdate();}
if(import.meta.hot){
  import.meta.hot.on('weapp-stylex:styles',onUpdate);
  import.meta.hot.on('vite:ws:connect',onUpdate);
  import.meta.hot.dispose(()=>{disposed=true;document.removeEventListener('DOMContentLoaded',onReady);});
}
document.addEventListener('DOMContentLoaded',onReady,{once:true});
`
  if (shadow) {
    return `${common}
const initial=await readState();
appliedHash=initial.hash;revision=initial.revision;
export const pageCss=initial.pageCss;
export const componentCss=initial.componentCss;
async function refresh(ready=false){
  const next=await readState(ready);
  if(disposed||next.revision<revision)return;
  revision=next.revision;
  if(appliedHash!==null&&next.hash!==appliedHash)location.reload();
}
void refresh().catch(error=>console.error(error));
`
  }
  return `${common}
const cssUrl=${JSON.stringify(cssUrl)};
async function refresh(ready=false){
  const next=await readState(ready);
  if(disposed||next.revision<revision)return;
  revision=next.revision;
  if(next.hash===appliedHash)return;
  appliedHash=next.hash;
  const owned=()=>document.querySelectorAll('link[data-weapp-stylex]');
  const old=owned()[0];
  if(next.empty){for(const link of owned())link.remove();return;}
  const link=document.createElement('link');
  link.rel='stylesheet';link.dataset.weappStylex='';
  link.href=cssUrl+'?v='+next.hash;
  link.addEventListener('load',()=>{if(appliedHash===next.hash){for(const other of owned())if(other!==link)other.remove();}else link.remove();},{once:true});
  link.addEventListener('error',()=>{if(appliedHash===next.hash)appliedHash=null;link.remove();},{once:true});
  if(old)old.before(link);else document.head.prepend(link);
}
void refresh().catch(error=>console.error(error));
`
}

/** Global StyleX ordering is finalized after module loading, never in CSS load(). */
export function createWebStylePlugins(source: SessionSource, options: WebStyleOptions) {
  const session = () => typeof source === 'function' ? source() : source
  const enabled = () => typeof options.enabled === 'function' ? options.enabled() : options.enabled !== false
  const shadow = options.delivery === 'shadow'
  let base = '/'
  let assetsDir = 'assets'
  let outputRoot: string | undefined
  let serving = false
  let watching = false
  let writing = true
  let server: WebServer | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let state: WebState = { revision: 0, hash: '', empty: true, css: '', pageCss: '', componentCss: '' }
  let pending: Promise<WebState> | undefined
  const previousAssets = new Map<string, string>()
  const entriesByHtml = new Map<string, Set<string>>()
  const devUrl = (name: string) => webAssetUrl(base, name)

  async function snapshot(): Promise<WebState> {
    const work = (pending ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const raw = session().css()
      const styles = shadow && options.transformShadowCss
        ? await options.transformShadowCss(raw)
        : { pageCss: await options.transformCss(raw), componentCss: '' }
      const css = styles.pageCss
      const policyKey = typeof options.policyKey === 'function' ? options.policyKey() : options.policyKey
      const hash = webCssHash(`${policyKey ?? ''}\0${css}\0${styles.componentCss}`)
      if (hash !== state.hash) {
        state = { revision: state.revision + 1, hash, empty: !raw.trim(), css, ...styles }
        server?.ws.send({ type: 'custom', event: 'weapp-stylex:styles', data: { revision: state.revision, hash } })
      }
      return state
    })
    pending = work
    try {
      return await work
    }
    finally {
      if (pending === work) {
        pending = undefined
      }
    }
  }

  function scheduleSnapshot() {
    if (!server || !enabled()) {
      return
    }
    clearTimeout(timer)
    timer = setTimeout(() => {
      void snapshot().catch((error: Error) => {
        server?.ws.send({ type: 'error', err: { message: error.message, stack: error.stack ?? '', plugin: 'weapp-stylex:web' } })
      })
    }, 0)
  }

  async function pruneDevGraph() {
    if (!server?.moduleGraph.getModuleByUrl || !entriesByHtml.size) {
      return
    }
    const visited = new Set<WebModuleNode>()
    const visit = (node: WebModuleNode | undefined) => {
      if (!node || visited.has(node)) {
        return
      }
      visited.add(node)
      for (const imported of node.importedModules) {
        visit(imported)
      }
    }
    for (const urls of entriesByHtml.values()) {
      for (const url of urls) {
        visit(await server.moduleGraph.getModuleByUrl(url))
      }
    }
    // An entry may still be loading on the first state request.
    if (visited.size || [...entriesByHtml.values()].every(urls => urls.size === 0)) {
      const active = session()
      const previous = [...active.modules.keys()]
      active.prune([...visited].flatMap(node => node.id ? [node.id] : []))
      // Pruning removes our source metadata. Invalidate the host's transformed
      // module too, so importing an unchanged source again repopulates it.
      for (const id of previous) {
        if (active.modules.has(id)) {
          continue
        }
        const nodes = new Set(server.moduleGraph.getModulesByFile?.(id) ?? [])
        const node = server.moduleGraph.getModuleById(id)
        if (node) {
          nodes.add(node)
        }
        for (const removed of nodes) {
          server.moduleGraph.invalidateModule?.(removed)
        }
      }
    }
  }

  return [{
    name: 'weapp-stylex:web',
    enforce: 'post' as const,
    configResolved(config: { root: string, base: string, command: string, build: { outDir: string, assetsDir?: string, watch?: unknown, write?: boolean } }) {
      const nextOutputRoot = path.resolve(config.root, config.build.outDir)
      if (outputRoot !== nextOutputRoot) {
        entriesByHtml.clear()
      }
      base = config.base
      assetsDir = config.build.assetsDir ?? 'assets'
      outputRoot = nextOutputRoot
      serving = config.command === 'serve'
      watching = serving || Boolean(config.build.watch)
      writing = config.build.write !== false
    },
    resolveId(id: string) {
      if (!enabled()) {
        return null
      }
      return [WEB_CSS_ID, CLIENT_ID].includes(id) ? `\0${id}` : null
    },
    load(id: string) {
      if (!enabled()) {
        return null
      }
      if (id === `\0${WEB_CSS_ID}` && shadow) {
        return serving
          ? clientCode(devUrl(STATE_PATH), devUrl(CSS_PATH), true)
          : `export const pageCss=${JSON.stringify(PAGE_MARKER)};export const componentCss=${JSON.stringify(COMPONENT_MARKER)};`
      }
      return id === `\0${CLIENT_ID}` && serving
        ? clientCode(devUrl(STATE_PATH), devUrl(CSS_PATH), false)
        : null
    },
    configureServer(value: WebServer) {
      if (!enabled()) {
        return
      }
      server = value
      value.httpServer?.once('close', () => {
        clearTimeout(timer)
        server = undefined
      })
      value.middlewares.use((request, response, next) => {
        const url = request.url?.split('?')[0]
        if (![devUrl(STATE_PATH), devUrl(CSS_PATH)].includes(url ?? '')) {
          next()
          return
        }
        void (async () => {
          if (request.url?.includes('ready=1')) {
            await pruneDevGraph()
          }
          const current = await snapshot()
          response.setHeader('Cache-Control', 'no-store')
          response.setHeader('Content-Type', url === devUrl(STATE_PATH) ? 'application/json' : 'text/css')
          response.end(url === devUrl(STATE_PATH) ? JSON.stringify(current) : current.css)
        })().catch((error: Error) => {
          response.statusCode = 500
          response.end(error.message)
        })
      })
    },
    transform(_code: string, _id: string) {
      scheduleSnapshot()
      return null
    },
    handleHotUpdate() {
      scheduleSnapshot()
      if (enabled()) {
        server?.ws.send({ type: 'full-reload' })
        return []
      }
      return undefined
    },
    transformIndexHtml(html: string, context?: { path: string }) {
      if (!enabled() || !serving) {
        return undefined
      }
      const htmlPath = context?.path ?? '/index.html'
      const entryUrls = new Set<string>()
      const addEntry = (url: string) => {
        if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(url)) {
          return
        }
        const resolved = new URL(url, `http://stylex.invalid${htmlPath}`)
        const basePath = new URL(base, 'http://stylex.invalid').pathname
        // Vite's HTML contains the public base; its module graph stores URLs
        // relative to that base. Keep queries, which identify virtual modules.
        let pathname = resolved.pathname
        if (basePath !== '/' && pathname.startsWith(basePath)) {
          pathname = `/${pathname.slice(basePath.length)}`
        }
        if (pathname === '/@vite/client' || pathname.includes(CLIENT_ID)) {
          return
        }
        entryUrls.add(`${pathname}${resolved.search}`)
      }
      for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        if (!/\btype\s*=\s*["']module["']/i.test(match[1]!)) {
          continue
        }
        const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(match[1]!)?.[1]
        if (src) {
          addEntry(src)
        }
        else {
          for (const imported of match[2]!.matchAll(/\b(?:import\s*(?:\(\s*)?|from\s*)["']([^"']+)["']/g)) {
            addEntry(imported[1]!)
          }
        }
      }
      entriesByHtml.set(htmlPath, entryUrls)
      if (shadow) {
        return undefined
      }
      return [{ tag: 'script', attrs: { type: 'module', src: devUrl(`@id/${CLIENT_ID}`) }, injectTo: 'head-prepend' as const }]
    },
    async renderStart(this: WebPluginHost) {
      if (enabled()) {
        session().prune(this.getModuleIds())
        await snapshot()
      }
    },
    augmentChunkHash() {
      return enabled() && shadow ? state.hash : undefined
    },
    renderChunk(code: string) {
      if (!enabled() || !shadow || (!code.includes(PAGE_MARKER) && !code.includes(COMPONENT_MARKER))) {
        return null
      }
      const output = new MagicString(code)
      for (const [marker, css] of [[PAGE_MARKER, state.pageCss], [COMPONENT_MARKER, state.componentCss]]) {
        const expression = new RegExp(`["']${marker}["']`, 'g')
        for (const match of code.matchAll(expression)) {
          output.overwrite(match.index!, match.index! + match[0].length, JSON.stringify(css))
        }
      }
      return { code: output.toString(), map: output.generateMap({ hires: true }).toString() }
    },
    generateBundle: {
      order: 'post' as const,
      async handler(this: WebPluginHost, _output: unknown, bundle: StyleBundle) {
        if (!enabled() || shadow) {
          return
        }
        session().prune(this.getModuleIds())
        const current = await snapshot()
        const fileName = current.empty ? undefined : path.posix.join(assetsDir, `stylex-${webCssHash(current.css)}.css`)
        const previousAsset = outputRoot ? previousAssets.get(outputRoot) : undefined
        if (fileName) {
          if (bundle[fileName]) {
            this.error(`StyleX CSS filename conflict: ${fileName}`)
          }
          const html = Object.values(bundle).filter(asset => asset.type === 'asset' && asset.fileName.endsWith('.html'))
          if (!html.length) {
            this.error('StyleX H5 output requires an HTML entry to attach its stylesheet')
          }
          for (const asset of html) {
            if (asset.type === 'asset') {
              asset.source = injectWebStyleLink(assetText(asset), webAssetUrl(base, fileName, asset.fileName))
            }
          }
          this.emitFile({ type: 'asset', fileName, source: current.css })
        }
        if (writing && previousAsset && previousAsset !== fileName && outputRoot) {
          await rm(path.join(outputRoot, previousAsset), { force: true })
        }
        if (writing && outputRoot) {
          if (fileName) {
            previousAssets.set(outputRoot, fileName)
          }
          else {
            previousAssets.delete(outputRoot)
          }
        }
      },
    },
    closeBundle() {
      clearTimeout(timer)
      if (!watching) {
        if (enabled()) {
          session().clear()
        }
      }
    },
    closeWatcher() {
      clearTimeout(timer)
      server = undefined
      entriesByHtml.clear()
      previousAssets.clear()
    },
  }]
}
