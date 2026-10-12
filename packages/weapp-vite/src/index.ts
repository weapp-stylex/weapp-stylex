import type {
  PluginHost,
  StyleBundle,
  StylexCompilerOptions,
  StylexTarget,
} from '@weapp-stylex/compiler'
import type { WeappCompilerPluginOption } from 'weapp-vite'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assertStylexTarget,
  createVitePlugins,
  formatDiagnostic,
  MiniProgramStyleEmitter,
  resolveStylexTarget,
  SCRIPT_RE,
  StylexSession,
} from '@weapp-stylex/compiler'
import { createShadowStylePlugins } from './web.js'

export type { StylexCompilerOptions, StylexTarget } from '@weapp-stylex/compiler'

function hostTarget(platform: string): StylexTarget {
  const target = platform === 'wechat' ? 'weapp' : platform === 'h5' ? 'web' : platform
  assertStylexTarget(target)
  return target
}

function provider(
  options: StylexCompilerOptions,
  sessionFor = (target: StylexTarget) => new StylexSession(resolveStylexTarget(options, target)),
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
      const target = hostTarget(context.platform)
      if (target === 'web') {
        throw new Error('Use createStylex() with both returned fields for weapp-vite Web builds.')
      }
      const session = sessionFor(target)
      const emitter = new MiniProgramStyleEmitter(target, {
        template: context.outputExtensions.wxml,
        style: context.outputExtensions.wxss,
      })
      return {
        buildStart() {
          session.beginBuild()
        },
        claimSource(request) {
          if (
            request.kind !== 'script'
            || !SCRIPT_RE.test(request.id.split('?')[0]!)
          ) {
            return false
          }
          if (!session.hasImport(request.code)) {
            session.remove(request.id)
            return false
          }
          return { id: request.id, entryId: request.id }
        },
        async transformSource(request) {
          const result = await session.transform(request.code, request.id, {
            resolve: async (source, importer) =>
              (await context.resolve(source, importer, { skipSelf: true }))?.id,
            addWatchFile: id => context.addWatchFile(id),
            diagnostic: (diagnostic) => {
              if (diagnostic.level === 'warning') {
                context.warn(formatDiagnostic(diagnostic))
              }
              else { context.error(formatDiagnostic(diagnostic)) }
            },
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
/** Use both returned fields for native/Wevu mini-programs and the host Web runtime. */
export function createStylex(options: StylexCompilerOptions = {}) {
  const sessions = new Map<StylexTarget, StylexSession>()
  let target: StylexTarget = options.target ?? 'weapp'
  let watching = false
  const sessionFor = (active: StylexTarget) => {
    let session = sessions.get(active)
    if (!session) {
      session = new StylexSession(resolveStylexTarget(options, active))
      sessions.set(active, session)
    }
    return session
  }
  const current = () => sessionFor(target)
  const web = () => target === 'web'
  return {
    vitePlugins: [
      {
        name: 'weapp-stylex:host',
        enforce: 'pre' as const,
        configResolved(config: {
          command?: string
          build?: { watch?: unknown }
          weappVite?: { name: string, runtime: string, platform?: string }
          weapp?: { platform?: string }
        }) {
          const host = config.weappVite
          target = hostTarget(host?.runtime === 'web' ? 'web' : host?.platform ?? config.weapp?.platform ?? options.target ?? 'weapp')
          resolveStylexTarget(options, target)
          watching = config.command === 'serve' || Boolean(config.build?.watch)
        },
        closeBundle() {
          if (web() && !watching) {
            current().clear()
          }
        },
      },
      ...createVitePlugins(current, {
        sfcOnly: () => !web(),
        emitStyles: false,
        sourceId: id => web() && new URLSearchParams(id.split('?')[1]).has('weapp-web-component') ? id.split('?')[0]! : id,
      }),
      {
        name: 'weapp-stylex:web-sfc-script',
        enforce: 'post' as const,
        async transform(this: PluginHost, code: string, id: string) {
          const [filename, query] = id.split('?')
          if (!web() || !filename?.endsWith('.vue') || (query && !new URLSearchParams(query).has('weapp-web-component'))) {
            return null
          }
          // Web 1.6 scans/caches SFCs before Vite's raw source transforms.
          // Complete that cached script without touching the host template,
          // macros, lifecycle, or its separate style/template modules.
          const result = await current().transformCompiledSfcScript(code, id, {
            resolve: async (source, importer) => {
              const resolved = await this.resolve(source, importer, { skipSelf: true })
              return resolved && !resolved.external ? resolved.id : undefined
            },
            addWatchFile: dependency => this.addWatchFile(dependency),
            diagnostic: diagnostic => diagnostic.level === 'warning'
              ? this.warn(formatDiagnostic(diagnostic))
              : this.error({ message: formatDiagnostic(diagnostic), id: diagnostic.file }),
          })
          return result ? { code: result.code, map: result.map } : null
        },
      },
      ...createShadowStylePlugins(current, web),
    ],
    compilerPlugin: provider(options, sessionFor),
  }
}
export default stylexCompiler
