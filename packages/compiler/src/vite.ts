import type { StylexSession } from './session.js'
import type { StyleBundle } from './wxss.js'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { formatDiagnostic } from './diagnostics.js'
import { sourceId } from './session.js'
import { MiniProgramStyleEmitter } from './wxss.js'

export interface PluginHost {
  resolve: (
    source: string,
    importer?: string,
    options?: { skipSelf?: boolean },
  ) => Promise<{
    id: string
    external?: boolean | 'absolute' | 'relative'
  } | null>
  warn: (message: string) => void
  error: (error: { message: string, id: string, loc?: { line: number, column: number } }) => never
  addWatchFile: (id: string) => void
  getModuleIds: () => IterableIterator<string>
  emitFile: (asset: {
    type: 'asset'
    fileName: string
    source: string
  }) => string
}
/** Structural hooks accepted by Vite 4/5/8; no Vite runtime is bundled. */
export function createVitePlugins(
  session: StylexSession | (() => StylexSession),
  options: {
    sfcOnly?: boolean | (() => boolean)
    emitStyles?: boolean | (() => boolean)
    sourceId?: (id: string) => string
  } = {},
) {
  const current = () => typeof session === 'function' ? session() : session
  const enabled = (value: boolean | (() => boolean) | undefined, fallback: boolean) => typeof value === 'function' ? value() : value ?? fallback
  const emitters = new Map<string, MiniProgramStyleEmitter>()
  const clearEmitters = () => {
    for (const emitter of emitters.values()) {
      emitter.clear()
    }
    emitters.clear()
  }
  let outputRoot: string | undefined
  let watching = false
  return [
    {
      name: 'weapp-stylex:source',
      enforce: 'pre' as const,
      buildStart() {
        current().beginBuild()
      },
      transform: {
        order: 'pre' as const,
        async handler(this: PluginHost, code: string, id: string) {
          id = options.sourceId?.(id) ?? id
          if (enabled(options.sfcOnly, false) && (!id.endsWith('.vue') || id.includes('?'))) {
            return null
          }
          const result = await current().transform(code, id, {
            resolve: async (source, importer) => {
              const resolved = await this.resolve(source, importer, {
                skipSelf: true,
              })
              return resolved && !resolved.external ? resolved.id : undefined
            },
            addWatchFile: dependency => this.addWatchFile(dependency),
            diagnostic: (diagnostic) => {
              if (diagnostic.level === 'warning') {
                this.warn(formatDiagnostic(diagnostic))
              }
              else {
                this.error({ message: formatDiagnostic(diagnostic), id: diagnostic.file, loc: diagnostic.line ? { line: diagnostic.line, column: (diagnostic.column ?? 1) - 1 } : undefined })
              }
            },
          })
          return result ? { code: result.code, map: result.map } : null
        },
      },
      shouldTransformCachedModule({ id }: { id: string }) {
        return current().dirty.has(sourceId(id))
      },
      watchChange(id: string, change: { event: string }) {
        current().change(id, change.event === 'delete')
      },
      handleHotUpdate<T>(context: {
        file: string
        modules: T[]
        server: { moduleGraph: {
          getModulesByFile: (id: string) => Set<T> | undefined
          invalidateModule: (module: T) => void
        } }
      }) {
        const active = current()
        active.change(context.file)
        const affected = new Set(context.modules)
        for (const id of active.dirty) {
          for (const module of context.server.moduleGraph.getModulesByFile(id) ?? []) {
            context.server.moduleGraph.invalidateModule(module)
            affected.add(module)
          }
        }
        return [...affected]
      },
      configureServer(server: { httpServer?: { once: (event: string, callback: () => void) => void } | null }) {
        server.httpServer?.once('close', () => {
          current().clear()
          clearEmitters()
        })
      },
      closeWatcher() {
        current().clear()
      },
    },
    {
      name: 'weapp-stylex:output',
      enforce: 'post' as const,
      configResolved(config: { root: string, command?: string, build: { outDir: string, watch?: unknown } }) {
        outputRoot = path.resolve(config.root, config.build.outDir)
        watching = config.command === 'serve' || Boolean(config.build.watch)
      },
      closeBundle() {
        if (enabled(options.emitStyles, true) && !watching) {
          current().clear()
          clearEmitters()
        }
      },
      closeWatcher() {
        clearEmitters()
      },
      generateBundle: {
        order: 'post' as const,
        async handler(
          this: PluginHost,
          _options: unknown,
          bundle: StyleBundle,
        ) {
          const active = current()
          active.prune(this.getModuleIds())
          if (enabled(options.emitStyles, true)) {
            const target = active.options.target ?? 'weapp'
            if (target === 'web') {
              throw new Error('Use createWebStylePlugins for the web target and disable mini-program style emission.')
            }
            const outputKey = `${target}\0${outputRoot ?? ''}`
            let emitter = emitters.get(outputKey)
            if (!emitter) {
              emitter = new MiniProgramStyleEmitter(target)
              emitters.set(outputKey, emitter)
            }
            await emitter.generate(bundle, active.css(), {
              emit: (fileName, source) => {
                this.emitFile({ type: 'asset', fileName, source })
              },
              remove: async (fileName) => {
                if (outputRoot) {
                  await rm(path.join(outputRoot, fileName), { force: true })
                }
              },
            })
          }
        },
      },
    },
  ]
}
