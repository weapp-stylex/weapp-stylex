import type {
  ModuleStyles,
  StyleBundle,
  StylexCompilerOptions,
} from '@weapp-stylex/compiler'
import type { Compiler, Module } from 'webpack'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assetText,
  backendBuildDependencies,
  processRules,
  StylexSession,
  WxssEmitter,
} from '@weapp-stylex/compiler'

export class StylexWebpackPlugin {
  constructor(readonly options: StylexCompilerOptions = {}) {}
  apply(compiler: Compiler): void {
    const session = new StylexSession(this.options)
    const emitter = new WxssEmitter()
    // Append to the host cache identity and build inputs; never replace its settings.
    if (compiler.options.cache && compiler.options.cache.type === 'filesystem') {
      const cache = compiler.options.cache
      cache.version = `${cache.version ?? ''}:weapp-stylex:${session.fingerprint}`
      cache.buildDependencies = { ...cache.buildDependencies, weappStylex: [...(cache.buildDependencies?.weappStylex ?? []), ...backendBuildDependencies, typeof __filename === 'string' ? __filename : fileURLToPath(import.meta.url)] }
    }
    compiler.hooks.thisCompilation.tap('weapp-stylex', (compilation) => {
      session.beginBuild()
      compiler.webpack.NormalModule.getCompilationHooks(compilation).loader.tap(
        'weapp-stylex',
        (context) => {
          Object.assign(context, { stylexSession: session })
        },
      )
      compilation.hooks.processAssets.tapPromise(
        {
          name: 'weapp-stylex',
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT + 1,
        },
        async () => {
          const metadata: ModuleStyles[] = []
          const visited = new Set<Module>()
          const collect = (module: Module) => {
            if (visited.has(module)) {
              return
            }
            visited.add(module)
            const info = module.buildInfo as { weappStylex?: ModuleStyles }
            if (info?.weappStylex) {
              if ((info.weappStylex as ModuleStyles & { fingerprint?: string }).fingerprint !== session.fingerprint) {
                throw new Error('Stale StyleX Webpack cache. Clear the host cache and rebuild.')
              }
              metadata.push(info.weappStylex)
            }
            if ('modules' in module) {
              for (const child of (
                module as Module & { modules: Iterable<Module> }
              ).modules) {
                collect(child)
              }
            }
          }
          for (const module of compilation.modules) {
            if (compilation.chunkGraph.getNumberOfModuleChunks(module)) {
              collect(module)
            }
          }
          session.prune([...visited].flatMap(module =>
            'resource' in module && typeof module.resource === 'string'
              ? [module.resource]
              : [],
          ))
          const bundle: StyleBundle = {}
          for (const asset of compilation.getAssets()) {
            bundle[asset.name] = {
              type: 'asset',
              fileName: asset.name,
              source: asset.source.source().toString(),
            }
          }
          await emitter.generate(
            bundle,
            processRules(metadata.flatMap(value => value.rules)),
            {
              emit: (fileName, source) => {
                const asset = new compiler.webpack.sources.RawSource(source)
                if (compilation.getAsset(fileName)) {
                  compilation.updateAsset(fileName, asset)
                }
                else {
                  compilation.emitAsset(fileName, asset)
                }
              },
              remove: async (fileName) => {
                compilation.deleteAsset(fileName)
                await rm(path.join(compiler.outputPath, fileName), {
                  force: true,
                })
              },
            },
          )
          for (const output of Object.values(bundle)) {
            if (
              output.type === 'asset'
              && output.fileName.endsWith('.wxss')
              && compilation.getAsset(output.fileName)
            ) {
              compilation.updateAsset(
                output.fileName,
                new compiler.webpack.sources.RawSource(assetText(output)),
              )
            }
          }
        },
      )
    })
    compiler.hooks.shutdown.tap('weapp-stylex', () => session.clear())
  }
}
