import type { Rule, Options as StyleXOptions } from '@stylexjs/babel-plugin'
import type {
  WeappCompilerPlugin,
  WeappCompilerPluginContext,
  WeappCompilerPluginOption,
} from 'weapp-vite'
import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import babel from '@babel/core'
import stylexBabelPlugin from '@stylexjs/babel-plugin'

const STYLEX_IMPORT_RE = /from\s*["'](?:@weapp-stylex\/core|@stylexjs\/stylex)["']|require\(\s*["'](?:@weapp-stylex\/core|@stylexjs\/stylex)["']\s*\)/
const SCRIPT_RE = /\.[cm]?[jt]sx?$/i
const WXSS_RE = /\.(?:wxss|acss|css)$/i

interface OutputAsset {
  type: 'asset'
  fileName: string
  source: string | Uint8Array
}

interface OutputChunk {
  type: 'chunk'
  fileName: string
  code: string
}

type OutputFile = OutputAsset | OutputChunk
type OutputBundle = Record<string, OutputFile>

export interface StylexCompilerOptions {
  /** Module names that should be handled by the StyleX Babel transform. */
  importSources?: readonly string[]
  /** Additional official StyleX Babel options. */
  babel?: Partial<StyleXOptions>
}

function toPosix(fileName: string): string {
  return fileName.replaceAll('\\', '/')
}

function dirname(fileName: string): string {
  const normalized = toPosix(fileName)
  const slash = normalized.lastIndexOf('/')
  return slash === -1 ? '.' : normalized.slice(0, slash)
}

function joinOutputPath(directory: string, fileName: string): string {
  return directory === '.' ? fileName : `${directory}/${fileName}`
}

function readAsset(asset: OutputAsset): string {
  return typeof asset.source === 'string'
    ? asset.source
    : new TextDecoder().decode(asset.source)
}

function parserPlugins(id: string): ('typescript' | 'jsx')[] {
  const plugins: ('typescript' | 'jsx')[] = []
  const normalized = id.toLowerCase().split('?')[0] ?? ''
  if (/\.(?:ts|mts|cts|tsx)$/.test(normalized)) {
    plugins.push('typescript')
  }
  if (/\.(?:jsx|tsx)$/.test(normalized)) {
    plugins.push('jsx')
  }
  return plugins
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasStylexImport(code: string, importSources: readonly string[]): boolean {
  if (importSources.length === 2 && importSources.includes('@weapp-stylex/core') && importSources.includes('@stylexjs/stylex')) {
    return STYLEX_IMPORT_RE.test(code)
  }
  return importSources.some(source =>
    new RegExp(`(?:from\\s*["']${escapeRegExp(source)}["']|require\\(\\s*["']${escapeRegExp(source)}["']\\s*\\))`).test(code),
  )
}

function collectOutputDirectories(bundle: OutputBundle, hasWxss: boolean): Set<string> {
  const directories = new Set<string>()
  if (!hasWxss) {
    directories.add('.')
    return directories
  }
  for (const output of Object.values(bundle)) {
    const fileName = toPosix(output.fileName)
    if (output.type === 'asset' && WXSS_RE.test(fileName)) {
      directories.add(dirname(fileName))
      continue
    }
    // A page/component can have no local WXSS. Keep a companion asset in its
    // output directory so a later native entry can import it without relying
    // on a web-only global stylesheet.
    if (/\.(?:wxml|js|mjs|cjs|json)$/i.test(fileName)) {
      directories.add(dirname(fileName))
    }
  }
  if (directories.size === 0) {
    directories.add('.')
  }
  return directories
}

function styleSheetImport(): string {
  return '@import "./stylex.wxss";\n'
}

async function emitStyleSheetAsset(
  bundle: OutputBundle,
  context: WeappCompilerPluginContext,
  fileName: string,
  css: string,
): Promise<void> {
  const asset: OutputAsset = {
    type: 'asset',
    fileName,
    source: css,
  }
  // The normal compiler host gives us a resolved config and a Rolldown bundle
  // proxy. Avoid touching that proxy; it intentionally rejects new keys.
  if (!context.resolvedConfig) {
    bundle[fileName] = asset
  }
  // Rolldown exposes a read-only bundle proxy to compiler providers. Plain
  // Rollup/Vitest bundles accept the assignment above; native weapp-vite
  // builds need the physical fallback so the asset is still present when the
  // host writes its output directory.
  if (bundle[fileName] === asset) {
    return
  }
  const resolvedConfig = context.resolvedConfig as
    | { root?: string, build?: { outDir?: string } }
    | undefined
  const configuredOutDir = resolvedConfig?.build?.outDir ?? 'dist'
  const outputRoot = isAbsolute(configuredOutDir)
    ? configuredOutDir
    : resolvePath(resolvedConfig?.root ?? context.root, configuredOutDir)
  const outputPath = resolvePath(outputRoot, fileName)
  await mkdir(resolvePath(outputPath, '..'), { recursive: true })
  await writeFile(outputPath, css, 'utf8')
}

/**
 * Create the native mini-program compiler provider.
 *
 * The provider intentionally uses a full-build CSS snapshot. This keeps JS,
 * WXSS and StyleX metadata in sync while leaving stateful HMR for a later
 * version of the integration.
 */
export function stylexCompiler(options: StylexCompilerOptions = {}): WeappCompilerPluginOption {
  const importSources = options.importSources ?? ['@weapp-stylex/core', '@stylexjs/stylex']
  const babelOptions: Partial<StyleXOptions> = {
    ...options.babel,
    // WXSS output is shared by pages, components and ordinary subpackages;
    // keep the prefix stable so classes remain portable between directories.
    classNamePrefix: 'sx',
    importSources,
    debug: false,
    dev: false,
    test: false,
    styleResolution: 'application-order',
    runtimeInjection: false,
  }

  const provider: WeappCompilerPlugin = {
    name: 'weapp-stylex',
    phase: 'source',
    capabilities: {
      bundle: true,
      script: true,
      style: true,
      content: true,
      hmr: true,
    },
    create(context: WeappCompilerPluginContext) {
      let rules: Rule[] = []
      let hasStylexSource = false
      const claimed = new Set<string>()

      return {
        buildStart() {
          // The host uses a full rebuild for HMR. Start every build with a
          // fresh metadata snapshot so removed styles cannot leak into WXSS.
          rules = []
          hasStylexSource = false
          claimed.clear()
        },

        claimSource(request) {
          if (request.kind !== 'script' || !SCRIPT_RE.test(request.id.split('?')[0] ?? '')) {
            return false
          }
          if (!hasStylexImport(request.code, importSources)) {
            return false
          }
          claimed.add(request.id)
          context.addWatchFile(request.id)
          return { id: request.id, entryId: request.id }
        },

        transformSource(request) {
          if (request.kind !== 'script' || !claimed.has(request.id)) {
            return null
          }
          const result = babel.transformSync(request.code, {
            filename: request.id,
            sourceType: 'module',
            babelrc: false,
            configFile: false,
            ast: false,
            sourceMaps: true,
            parserOpts: {
              sourceType: 'module',
              plugins: parserPlugins(request.id),
            },
            plugins: [stylexBabelPlugin.withOptions(babelOptions)],
          })

          if (!result?.code) {
            context.warn(`StyleX 没有生成代码：${request.id}`)
            return null
          }
          const metadata = result.metadata as { stylex?: unknown } | undefined
          if (Array.isArray(metadata?.stylex)) {
            rules.push(...(metadata.stylex as Rule[]))
            hasStylexSource ||= metadata.stylex.length > 0
          }
          return {
            code: result.code,
            map: result.map ?? undefined,
            dependencies: [request.id],
            handled: true,
          }
        },

        async generateBundle(bundleLike) {
          if (!hasStylexSource || rules.length === 0) {
            return
          }
          const bundle = bundleLike as unknown as OutputBundle
          const css = stylexBabelPlugin.processStylexRules(rules, {
            legacyDisableLayers: true,
            useLayers: false,
          })
          if (!css.trim()) {
            return
          }

          const existingStylexAssets = Object.values(bundle).filter(
            output => output.fileName === 'stylex.wxss' || output.fileName.endsWith('/stylex.wxss'),
          )
          if (existingStylexAssets.length > 0) {
            throw new Error(
              `StyleX WXSS 文件名冲突：构建输出已存在 ${existingStylexAssets[0]?.fileName ?? 'stylex.wxss'}。请重命名项目中的同名文件。`,
            )
          }

          const wxssOutputs = Object.values(bundle).filter(
            (output): output is OutputAsset => output.type === 'asset' && WXSS_RE.test(output.fileName),
          )
          const directories = collectOutputDirectories(bundle, wxssOutputs.length > 0)

          for (const directory of directories) {
            const stylexFileName = joinOutputPath(directory, 'stylex.wxss')
            await emitStyleSheetAsset(bundle, context, stylexFileName, css)
          }

          if (wxssOutputs.length === 0) {
            // With no native stylesheet entry, app.wxss is the one global
            // entry that the WeChat runtime loads for every page.
            if (bundle['app.wxss']) {
              throw new Error('StyleX WXSS 文件名冲突：构建输出已存在 app.wxss，无法创建兜底入口。')
            }
            await emitStyleSheetAsset(bundle, context, 'app.wxss', styleSheetImport())
            return
          }

          for (const output of wxssOutputs) {
            const importStatement = styleSheetImport()
            const source = readAsset(output)
            if (!source.includes(importStatement.trim())) {
              output.source = `${importStatement}${source}`
            }
          }
        },

        watchChange(id, change) {
          if (SCRIPT_RE.test(id.split('?')[0] ?? '') && (change.event === 'update' || change.event === 'delete')) {
            claimed.delete(id)
          }
        },

        dispose() {
          rules = []
          claimed.clear()
          hasStylexSource = false
        },
      }
    },
  }

  return provider
}

export default stylexCompiler
