import type { StylexSession } from './session.js'
import type { StyleBundle } from './wxss.js'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { formatDiagnostic } from './diagnostics.js'
import { sourceId } from './session.js'
import { WxssEmitter } from './wxss.js'

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
  session: StylexSession,
  options: { sfcOnly?: boolean, emitStyles?: boolean } = {},
) {
  const emitter = new WxssEmitter()
  let outputRoot: string | undefined
  let watching = false
  return [
    {
      name: 'weapp-stylex:source',
      enforce: 'pre' as const,
      buildStart() {
        session.beginBuild()
      },
      async transform(this: PluginHost, code: string, id: string) {
        if (options.sfcOnly && (!id.endsWith('.vue') || id.includes('?'))) {
          return null
        }
        const result = await session.transform(code, id, {
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
      shouldTransformCachedModule({ id }: { id: string }) {
        return session.dirty.has(sourceId(id))
      },
      watchChange(id: string, change: { event: string }) {
        session.change(id, change.event === 'delete')
      },
      closeWatcher() {
        session.clear()
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
        if (options.emitStyles !== false && !watching) {
          session.clear()
          emitter.clear()
        }
      },
      closeWatcher() {
        emitter.clear()
      },
      generateBundle: {
        order: 'post' as const,
        async handler(
          this: PluginHost,
          _options: unknown,
          bundle: StyleBundle,
        ) {
          session.prune(this.getModuleIds())
          if (options.emitStyles !== false) {
            await emitter.generate(bundle, session.css(), {
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
