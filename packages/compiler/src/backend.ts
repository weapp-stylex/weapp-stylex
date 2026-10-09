import type { BabelFileResult } from '@babel/core'
import type { Options, Rule } from '@stylexjs/babel-plugin'
import type { analyzeScript, ScriptAst } from './analysis.js'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import babel from '@babel/core'
import stylexPlugin from '@stylexjs/babel-plugin'

export type StylexBackend = 'babel' | 'auto' | 'swc'
export interface BackendResult {
  code: string
  map: BabelFileResult['map']
  rules: Rule[]
  backend: 'babel' | 'swc'
}
const require = createRequire(typeof __filename === 'string' ? __filename : import.meta.url)
export const SWC_VERSION = '0.19.0'
// Bump when analysis, hashing or output semantics change, including local development.
const CACHE_ABI = 2
export const backendBuildDependencies = [
  typeof __filename === 'string' ? __filename : fileURLToPath(import.meta.url),
  require.resolve('../package.json'),
  require.resolve('@babel/core/package.json'),
  require.resolve('@stylexjs/babel-plugin/package.json'),
]

export function compilerFingerprint(options: object): string {
  const stable = (value: unknown): unknown => {
    if (typeof value === 'function') {
      return value.toString()
    }
    if (Array.isArray(value)) {
      return value.map(stable)
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)]))
    }
    return value
  }
  return createHash('sha256').update(JSON.stringify(stable({
    options,
    abi: CACHE_ABI,
    babel: babel.version,
    stylex: require('@stylexjs/babel-plugin/package.json').version,
    compiler: require('../package.json').version,
    swc: SWC_VERSION,
  }))).digest('hex')
}

export class NativeBackendUnavailable extends Error {}
let native: Promise<typeof import('@stylexswc/rs-compiler')> | undefined
export async function loadSwc() {
  // Only addon loading failures are compatibility fallbacks. Transform failures propagate.
  native ??= import('@stylexswc/rs-compiler').catch((cause: unknown) => {
    throw new NativeBackendUnavailable(`Optional @stylexswc/rs-compiler@${SWC_VERSION} is unavailable. Reinstall with optional dependencies on a supported platform, or select backend: "babel".`, { cause })
  })
  return native
}

function acceptedImportSource(source: string): boolean {
  return source.length <= 214 && !['node_modules', 'favicon.ico'].includes(source)
    && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(source)
}

export function swcUnsupported(analysis: ReturnType<typeof analyzeScript>, custom: Partial<Options> | undefined): string | undefined {
  if (Object.keys(custom ?? {}).length) {
    return 'custom Babel options require the official compiler'
  }
  if ([...analysis.runtimeSources].some(source => !acceptedImportSource(source))) {
    return 'this runtime import subpath is not accepted by SWC'
  }
  if (analysis.dependencies.size) {
    return 'compile-time imports and cross-file tokens require the official compiler'
  }
  if ([...analysis.methods].some(method => ['defineVars', 'createTheme', 'defineConsts'].includes(method))) {
    return 'themes and constants require the official compiler'
  }
  return analysis.unsupported
}

export function transformBabel(ast: ScriptAst, code: string, filename: string, options: Partial<Options>): BackendResult {
  const result = babel.transformFromAstSync(ast, code, {
    filename,
    sourceFileName: filename,
    sourceType: 'unambiguous',
    babelrc: false,
    configFile: false,
    sourceMaps: true,
    cloneInputAst: false,
    plugins: [stylexPlugin.withOptions(options)],
  })
  if (!result?.code) {
    throw new Error(`StyleX did not produce code for ${filename}`)
  }
  return { code: result.code, map: result.map, rules: (result.metadata as { stylex?: Rule[] }).stylex ?? [], backend: 'babel' }
}

export async function transformSwc(code: string, filename: string, sources: readonly string[]): Promise<BackendResult> {
  const compiler = await loadSwc()
  const result = compiler.transform(filename, code, {
    importSources: [...sources].filter(acceptedImportSource),
    classNamePrefix: 'sx',
    debug: false,
    dev: false,
    test: false,
    runtimeInjection: false,
    styleResolution: 'application-order',
    legacyDisableLayers: true,
    sourceMap: compiler.SourceMaps.True,
    unstable_moduleResolution: { type: 'haste' },
  })
  return { code: result.code, map: result.map ? JSON.parse(result.map) : undefined, rules: result.metadata.stylex, backend: 'swc' }
}
