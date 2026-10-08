import type {
  StyleBundle,
  StylexCompilerOptions,
} from '@weapp-stylex/compiler'
import type { WeappCompilerPluginOption } from 'weapp-vite'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  createVitePlugins,
  SCRIPT_RE,
  sourceId,
  StylexSession,
  WxssEmitter,
} from '@weapp-stylex/compiler'

export type { StylexCompilerOptions } from '@weapp-stylex/compiler'

function provider(
  options: StylexCompilerOptions,
  session = new StylexSession(options),
): WeappCompilerPluginOption {
  return {
    name: 'weapp-stylex',
    phase: 'source',
    capabilities: {
      bundle: true,
      script: true,
      style: true,
      content: true,
      hmr: true,
    },
    create(context) {
      const emitter = new WxssEmitter()
      return {
        claimSource(request) {
          if (
            request.kind !== 'script'
            || !SCRIPT_RE.test(request.id.split('?')[0]!)
          ) {
            return false
          }
          if (!session.hasImport(request.code)) {
            session.modules.delete(sourceId(request.id))
            session.dirty.delete(sourceId(request.id))
            return false
          }
          return { id: request.id, entryId: request.id }
        },
        async transformSource(request) {
          const result = await session.transform(request.code, request.id, {
            resolve: async (source, importer) =>
              (await context.resolve(source, importer, { skipSelf: true }))?.id,
            addWatchFile: id => context.addWatchFile(id),
          })
          return result
            ? {
                code: result.code,
                map: result.map,
                dependencies: result.dependencies,
                handled: true,
              }
            : null
        },
        async generateBundle(bundleLike) {
          const bundle = bundleLike as unknown as StyleBundle
          const chunks = Object.values(bundle).filter(
            output => output.type === 'chunk' && output.modules,
          )
          if (chunks.length) {
            session.prune(
              chunks.flatMap(chunk =>
                chunk.type === 'chunk' ? Object.keys(chunk.modules ?? {}) : [],
              ),
            )
          }
          const config = context.resolvedConfig as
            { root?: string, build?: { outDir?: string } } | undefined
          const outputRoot = path.resolve(
            config?.root ?? context.root,
            config?.build?.outDir ?? 'dist',
          )
          await emitter.generate(bundle, session.css(), {
            emit: async (fileName, source) => {
              if (!config) {
                bundle[fileName] = { type: 'asset', fileName, source }
                return
              }
              // weapp-vite 7.4 exposes a read-only Rolldown bundle for new keys.
              const file = path.join(outputRoot, fileName)
              await mkdir(path.dirname(file), { recursive: true })
              await writeFile(file, source)
            },
            remove: async (fileName) => {
              if (config) {
                await rm(path.join(outputRoot, fileName), { force: true })
              }
            },
          })
        },
        watchChange(id, change) {
          session.change(id, change.event === 'delete')
          for (const dependency of session.dirty) {
            context.invalidate(dependency)
          }
        },
        closeWatcher() {
          session.clear()
          emitter.clear()
        },
        dispose() {
          const config = context.resolvedConfig as
            { build?: { watch?: unknown } } | undefined
          if (!context.isDev && !config?.build?.watch) {
            session.clear()
            emitter.clear()
          }
        },
      }
    },
  }
}

/** Compatible native JS/TS entry point. */
export function stylexCompiler(
  options: StylexCompilerOptions = {},
): WeappCompilerPluginOption {
  return provider(options)
}
/** Use both returned fields to preprocess Vue SFCs and emit native WXSS. */
export function createStylex(options: StylexCompilerOptions = {}) {
  const session = new StylexSession(options)
  return {
    vitePlugins: createVitePlugins(session, {
      sfcOnly: true,
      emitStyles: false,
    }),
    compilerPlugin: provider(options, session),
  }
}
export default stylexCompiler
