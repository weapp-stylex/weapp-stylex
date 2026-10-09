import type { Options, Rule } from '@stylexjs/babel-plugin'
import type { BackendResult, StylexBackend } from './backend.js'
import type { StylexDiagnostic } from './diagnostics.js'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import remapping from '@ampproject/remapping'
import babel from '@babel/core'
import stylexPlugin from '@stylexjs/babel-plugin'
import { parse } from '@vue/compiler-sfc'
import { Bundle, MagicString } from 'magic-string'
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import { analyzeScript } from './analysis.js'
import { compilerFingerprint, NativeBackendUnavailable, swcUnsupported, transformBabel, transformSwc } from './backend.js'
import { compileError, StylexCompileError } from './diagnostics.js'

export type SfcParser = typeof parse

export interface StylexCompilerOptions {
  backend?: StylexBackend
  importSources?: readonly string[]
  babel?: Partial<Options>
}
export interface TransformHost {
  resolve: (source: string, importer: string) => Promise<string | undefined>
  addWatchFile: (id: string) => void
  diagnostic?: (diagnostic: StylexDiagnostic) => void
}
export interface ModuleStyles {
  rules: Rule[]
  dependencies: string[]
}
export interface SourceTransform extends ModuleStyles {
  code: string
  map?: string
}
type ScriptResult = ModuleStyles & BackendResult

export const SCRIPT_RE = /\.[cm]?[jt]sx?$/i

export function sourceId(id: string): string {
  const file = id.split('?')[0]!.replace(/^\0/, '')
  try {
    return realpathSync(file).replaceAll('\\', '/')
  }
  catch {
    return file.replaceAll('\\', '/')
  }
}
function parserPlugins(filename: string): ('typescript' | 'jsx')[] {
  return [
    ...(/\.[cm]?tsx?$/.test(filename) ? ['typescript' as const] : []),
    ...(/\.[jt]sx$/.test(filename) ? ['jsx' as const] : []),
  ]
}
function canonicalPath(filename: string, dependencies: Set<string>): string {
  const file = sourceId(filename)
  let directory = path.dirname(file)
  while (true) {
    try {
      const manifest = path.join(directory, 'package.json')
      dependencies.add(manifest)
      const pkg = JSON.parse(
        readFileSync(manifest, 'utf8'),
      ) as { name?: string }
      if (pkg.name) {
        return `${pkg.name}:${path.relative(directory, file).replaceAll('\\', '/')}`
      }
    }
    catch {
      /* Source directories do not need individual manifests. */
    }
    const parent = path.dirname(directory)
    if (parent === directory) {
      return path.basename(file)
    }
    directory = parent
  }
}

export function processRules(rules: Rule[]): string {
  const root = postcss.parse(
    stylexPlugin.processStylexRules(rules, {
      legacyDisableLayers: true,
      useLayers: false,
    }),
  )
  root.walkRules((rule) => {
    if (!rule.selector.includes(':root')) {
      return
    }
    rule.selector = selectorParser((selectors) => {
      selectors.walkPseudos((pseudo) => {
        if (pseudo.value === ':root') {
          const parent = pseudo.parent!
          let start = parent.index(pseudo)
          while (start > 0 && parent.nodes[start - 1]!.type !== 'combinator') {
            start--
          }
          const first = parent.nodes[start]!
          const tag = selectorParser.tag({ value: 'page' })
          pseudo.replaceWith(tag)
          // A tag must lead its compound selector: .theme:root -> page.theme.
          if (first !== pseudo) {
            tag.remove()
            tag.spaces.before = first.spaces.before
            first.spaces.before = ''
            parent.insertBefore(first, tag)
          }
        }
      })
    }).processSync(rule.selector)
  })
  return root.toString()
}

/** Metadata is replaced per module and retained across cached watch rebuilds. */
export class StylexSession {
  readonly modules = new Map<string, ModuleStyles>()
  readonly dirty = new Set<string>()
  readonly importSources: readonly string[]
  readonly fingerprint: string
  constructor(
    readonly options: StylexCompilerOptions = {},
    readonly parseSfc: SfcParser = parse,
  ) {
    if (options.backend && !['babel', 'auto', 'swc'].includes(options.backend)) {
      throw new Error(`Unknown StyleX backend: ${options.backend}`)
    }
    this.fingerprint = compilerFingerprint(options)
    this.importSources = options.importSources ?? [
      'weapp-stylex',
      'weapp-stylex/core',
      '@weapp-stylex/core',
      '@stylexjs/stylex',
    ]
  }

  hasImport(code: string): boolean {
    return this.importSources.some(source => code.includes(source))
  }

  private revision = 0
  private nextRequest = 0
  private readonly scriptCache = new Map<string, { result: ScriptResult, signatures: string[] }>()
  private readonly pending = new Map<string, Promise<ScriptResult>>()
  private readonly resolutions = new Map<string, Promise<string | undefined>>()
  private readonly sources = new Map<string, Promise<string>>()
  private readonly signatures = new Map<string, Promise<string>>()
  private readonly identities = new Map<string, { name: string, dependencies: string[] }>()
  private readonly edges = new Map<string, Set<string>>()
  private readonly requests = new Map<string, number>()
  private readonly scriptKeys = new Map<string, string>()
  private readonly notices = new Set<string>()
  private readonly aliases = new Map<string, string>()
  private readonly counters = { parses: 0, babelTransforms: 0, swcTransforms: 0, cacheHits: 0, tokenReads: 0, resolutions: 0 }

  getStats() {
    return { ...this.counters }
  }

  private remember(id: string): string {
    const raw = id.split('?')[0]!.replace(/^\0/, '').replaceAll('\\', '/')
    const physical = sourceId(id)
    if (physical !== raw) {
      this.aliases.set(raw, physical)
    }
    return physical
  }

  /** Per-build filesystem/resolver facts expire; compiled metadata survives watch. */
  beginBuild(): void {
    this.revision++
    this.pending.clear()
    this.edges.clear()
    this.resolutions.clear()
    this.sources.clear()
    this.signatures.clear()
    this.identities.clear()
  }

  private signature(id: string): Promise<string> {
    let value = this.signatures.get(id)
    if (!value) {
      value = stat(id, { bigint: true }).then(s => `${s.mtimeNs}:${s.ctimeNs}:${s.size}`, () => 'missing')
      this.signatures.set(id, value)
    }
    return value
  }

  private identity(id: string, dependencies: Set<string>): string {
    let value = this.identities.get(id)
    if (!value) {
      const files = new Set<string>()
      value = { name: canonicalPath(id, files), dependencies: [...files] }
      this.identities.set(id, value)
    }
    for (const file of value.dependencies) {
      dependencies.add(file)
    }
    return value.name
  }

  async transformScript(
    code: string,
    filename: string,
    host: TransformHost,
    ancestors: ReadonlySet<string> = new Set(),
    generation = this.revision,
  ): Promise<ScriptResult> {
    filename = this.remember(filename)
    if (ancestors.has(filename)) {
      throw new Error(`Cyclic StyleX token dependency: ${filename}`)
    }
    const revision = generation
    const key = `${filename}\0${createHash('sha256').update(code).update(this.fingerprint).digest('hex')}`
    if (revision === this.revision) {
      this.scriptKeys.set(filename, key)
    }
    const cacheable = revision === this.revision && !Object.keys(this.options.babel ?? {}).length
    const cached = cacheable ? this.scriptCache.get(key) : undefined
    if (cached) {
      const signatures = await Promise.all(cached.result.dependencies.map(id => this.signature(id)))
      if (revision === this.revision && signatures.every((value, i) => value === cached.signatures[i])) {
        this.counters.cacheHits++
        for (const id of cached.result.dependencies) {
          host.addWatchFile(id)
        }
        return cached.result
      }
      this.scriptCache.delete(key)
    }
    let work = cacheable ? this.pending.get(key) : undefined
    if (work) {
      this.counters.cacheHits++
    }
    else {
      work = this.compileScript(code, filename, host, ancestors, revision)
      if (cacheable) {
        this.pending.set(key, work)
      }
    }
    try {
      const result = await work
      if (cacheable && revision === this.revision && this.scriptKeys.get(filename) === key) {
        const signatures = await Promise.all(result.dependencies.map(id => this.signature(id)))
        if (revision === this.revision && this.scriptKeys.get(filename) === key) {
          for (const previous of this.scriptCache.keys()) {
            if (previous.startsWith(`${filename}\0`)) {
              this.scriptCache.delete(previous)
            }
          }
          this.scriptCache.set(key, { result, signatures })
        }
      }
      for (const id of result.dependencies) {
        host.addWatchFile(id)
      }
      return result
    }
    catch (cause) {
      throw compileError(cause, filename)
    }
    finally {
      if (this.pending.get(key) === work) {
        this.pending.delete(key)
      }
    }
  }

  private async compileScript(
    code: string,
    filename: string,
    host: TransformHost,
    ancestors: ReadonlySet<string>,
    generation: number,
  ): Promise<ScriptResult> {
    const resolutions = new Map<string, string>()
    const dependencies = new Set<string>([filename])
    this.counters.parses++
    const ast = babel.parseSync(code, {
      filename,
      babelrc: false,
      configFile: false,
      parserOpts: { sourceType: 'unambiguous', plugins: parserPlugins(filename) },
    })
    if (!ast) {
      throw new Error(`Cannot parse ${filename}`)
    }
    const analysis = analyzeScript(ast, this.importSources, this.options.backend !== undefined && this.options.backend !== 'babel')
    if (!analysis.runtimeSources.size) {
      return {
        code,
        map: undefined,
        rules: [],
        dependencies: [filename],
        backend: 'babel',
      }
    }
    await Promise.all([...analysis.dependencies].map(async (specifier) => {
      const key = `${filename}\0${specifier}`
      let resolving = this.resolutions.get(key)
      if (!resolving) {
        this.counters.resolutions++
        resolving = host.resolve(specifier, filename)
        this.resolutions.set(key, resolving)
      }
      let resolved: string | undefined
      try {
        resolved = await resolving
      }
      catch (cause) {
        this.resolutions.delete(key)
        throw new Error(`Cannot resolve StyleX dependency "${specifier}" from ${filename}`, { cause })
      }
      if (!resolved) {
        throw new Error(`Cannot resolve StyleX dependency "${specifier}" from ${filename}. Import token definitions directly from a tokens.stylex.ts file.`)
      }
      const dependency = this.remember(resolved)
      resolutions.set(specifier, dependency)
      dependencies.add(dependency)
    }))
    const tokens = new Set([...resolutions.values()].filter(id => /\.stylex\.[cm]?[jt]sx?$/i.test(id)))
    if (generation === this.revision) {
      this.edges.set(filename, tokens)
    }
    const visiting = new Set<string>()
    const visit = (id: string) => {
      if (visiting.has(id)) {
        throw new Error(`Cyclic StyleX token dependency: ${id}`)
      }
      visiting.add(id)
      for (const child of this.edges.get(id) ?? []) {
        visit(child)
      }
      visiting.delete(id)
    }
    visit(filename)
    const backend = this.options.backend ?? 'babel'
    let result: BackendResult | undefined
    const reason = backend === 'babel'
      ? undefined
      : filename.includes('.vue.stylex-script-')
        ? 'raw Vue SFC scripts require template-binding preservation by Babel'
        : swcUnsupported(analysis, this.options.babel)
    const fallback = (message: string) => {
      if (backend === 'swc') {
        throw new Error(`SWC cannot compile this module: ${message}. Select backend: "auto" or "babel".`)
      }
      if (!this.notices.has(message) && host.diagnostic) {
        this.notices.add(message)
        host.diagnostic({ level: 'warning', code: 'STYLEX_FALLBACK', file: filename, message: `Using Babel: ${message}`, hint: 'This compatibility fallback preserves official StyleX semantics. backend: "babel" disables acceleration notices.' })
      }
    }
    if (reason) {
      fallback(reason)
    }
    else if (backend !== 'babel') {
      try {
        result = await transformSwc(code, filename, this.importSources)
        this.counters.swcTransforms++
      }
      catch (error) {
        if (!(error instanceof NativeBackendUnavailable)) {
          throw error
        }
        fallback(error.message)
      }
    }
    if (!result) {
      this.counters.babelTransforms++
      result = transformBabel(ast, code, filename, {
        unstable_moduleResolution: {
          type: 'custom',
          filePathResolver: specifier => resolutions.get(specifier),
          getCanonicalFilePath: file => this.identity(file, dependencies),
        },
        ...this.options.babel,
        importSources: [...this.importSources],
        classNamePrefix: 'sx',
        debug: false,
        dev: false,
        test: false,
        runtimeInjection: false,
        styleResolution: 'application-order',
      })
    }
    const rules = [...result.rules]
    const lineage = new Set([...ancestors, filename])
    for (const dependency of tokens) {
      let reading = this.sources.get(dependency)
      if (!reading) {
        this.counters.tokenReads++
        reading = readFile(dependency, 'utf8')
        this.sources.set(dependency, reading)
      }
      let source: string
      try {
        source = await reading
      }
      catch (error) {
        this.sources.delete(dependency)
        throw error
      }
      if (!this.hasImport(source)) {
        continue
      }
      const tokenRequest = this.requests.get(dependency)
      const token = await this.transformScript(source, dependency, host, lineage, generation)
      // A host may have compiled this token earlier but erased its runtime import.
      // Refresh the retained owner too, so an old default cannot compete with new CSS.
      if (generation === this.revision && this.modules.has(dependency) && this.requests.get(dependency) === tokenRequest) {
        this.modules.set(dependency, token)
        this.dirty.delete(dependency)
      }
      rules.push(...token.rules)
      for (const id of token.dependencies) {
        dependencies.add(id)
      }
    }
    return { ...result, rules, dependencies: [...dependencies] }
  }

  async transform(code: string, id: string, host: TransformHost): Promise<SourceTransform | null> {
    try {
      return await this.transformSource(code, id, host)
    }
    catch (cause) {
      const error = compileError(cause, sourceId(id))
      host.diagnostic?.(error.diagnostic)
      throw error
    }
  }

  private async transformSource(
    code: string,
    id: string,
    host: TransformHost,
  ): Promise<SourceTransform | null> {
    const filename = this.remember(id)
    if (filename.endsWith('.vue')) {
      return id.includes('?') ? null : this.transformSfc(code, filename, host)
    }
    if (!SCRIPT_RE.test(filename)) {
      return null
    }
    if (!this.hasImport(code)) {
      this.remove(filename)
      return null
    }
    const revision = this.revision
    const request = this.request(filename)
    const result = await this.transformScript(code, filename, host)
    if (revision === this.revision && this.requests.get(filename) === request) {
      this.modules.set(filename, result)
      this.dirty.delete(filename)
    }
    return {
      ...result,
      map: result.map ? JSON.stringify(result.map) : undefined,
    }
  }

  private async transformSfc(
    code: string,
    filename: string,
    host: TransformHost,
  ): Promise<SourceTransform | null> {
    if (!this.hasImport(code)) {
      this.remove(filename)
      return null
    }
    const revision = this.revision
    const request = this.request(filename)
    const { descriptor, errors } = this.parseSfc(code, { filename })
    if (errors.length) {
      throw new Error(
        `Cannot parse ${filename}: ${errors.map(String).join('; ')}`,
      )
    }
    const blocks = [descriptor.script, descriptor.scriptSetup]
      .filter(block => block && !block.src && this.hasImport(block.content))
      .sort((a, b) => a!.loc.start.offset - b!.loc.start.offset)
    if (!blocks.length) {
      this.remove(filename)
      return null
    }
    const output = new Bundle({ separator: '' })
    const maps = new Map<string, string>()
    const rules: Rule[] = []
    const dependencies = new Set<string>([filename])
    let cursor = 0
    for (const [index, block] of blocks.entries()) {
      const { start, end } = block!.loc
      const original = `${filename}?stylex-original=${index}`
      const transformed = `${filename}?stylex-transformed=${index}`
      const scriptFilename = `${filename}.stylex-script-${index}.${block!.lang ?? 'js'}`
      let result: ScriptResult
      try {
        result = await this.transformScript(
          block!.content,
          scriptFilename,
          {
            resolve: specifier => host.resolve(specifier, filename),
            diagnostic: diagnostic => host.diagnostic?.(diagnostic.file === scriptFilename
              ? { ...diagnostic, file: filename, line: diagnostic.line ? diagnostic.line + start.line - 1 : undefined, column: diagnostic.line === 1 ? (diagnostic.column ?? 1) + start.column - 1 : diagnostic.column }
              : diagnostic),
            addWatchFile: (dependency) => {
              if (dependency !== scriptFilename) {
                host.addWatchFile(dependency)
              }
            },
          },
        )
      }
      catch (cause) {
        const diagnostic = compileError(cause, scriptFilename).diagnostic
        if (diagnostic.file !== scriptFilename) {
          throw cause
        }
        throw new StylexCompileError({ ...diagnostic, file: filename, line: diagnostic.line ? diagnostic.line + start.line - 1 : undefined, column: diagnostic.line === 1 ? (diagnostic.column ?? 1) + start.column - 1 : diagnostic.column }, cause)
      }
      output.addSource({
        content: new MagicString(code)
          .remove(0, cursor)
          .remove(start.offset, code.length),
        filename,
      })
      output.addSource({
        content: new MagicString(result.code),
        filename: transformed,
      })
      if (result.map) {
        maps.set(
          transformed,
          JSON.stringify({ ...result.map, sources: [original] }),
        )
        maps.set(
          original,
          new MagicString(code)
            .remove(0, start.offset)
            .remove(end.offset, code.length)
            .generateMap({
              source: filename,
              includeContent: true,
              hires: true,
            })
            .toString(),
        )
      }
      rules.push(...result.rules)
      for (const dependency of result.dependencies) {
        if (dependency !== scriptFilename) {
          dependencies.add(dependency)
        }
      }
      cursor = end.offset
    }
    output.addSource({
      content: new MagicString(code).remove(0, cursor),
      filename,
    })
    host.addWatchFile(filename)
    const map = remapping(
      output.generateMap({ includeContent: true, hires: true }).toString(),
      source => maps.get(source) ?? null,
    )
    const result = {
      code: output.toString(),
      map: JSON.stringify(map),
      rules,
      dependencies: [...dependencies],
    }
    if (revision === this.revision && this.requests.get(filename) === request) {
      this.modules.set(filename, result)
      this.dirty.delete(filename)
    }
    return result
  }

  private request(id: string): number {
    const request = ++this.nextRequest
    this.requests.set(id, request)
    return request
  }

  remove(id: string): void {
    const normalized = this.aliases.get(id.split('?')[0]!.replace(/^\0/, '').replaceAll('\\', '/')) ?? sourceId(id)
    this.requests.delete(normalized)
    this.modules.delete(normalized)
    this.dirty.delete(normalized)
    for (const file of this.scriptKeys.keys()) {
      if (file === normalized || file.startsWith(`${normalized}.`)) {
        this.scriptKeys.delete(file)
      }
    }
    for (const key of this.pending.keys()) {
      if (key.startsWith(`${normalized}\0`) || key.startsWith(`${normalized}.stylex-script-`)) {
        this.pending.delete(key)
      }
    }
    for (const key of this.scriptCache.keys()) {
      const file = key.split('\0')[0]!
      if (file === normalized || file.startsWith(`${normalized}.`)) {
        this.scriptCache.delete(key)
      }
    }
    this.edges.delete(normalized)
    for (const [alias, physical] of this.aliases) {
      if (physical === normalized) {
        this.aliases.delete(alias)
      }
    }
  }

  change(id: string, deleted = false): void {
    // A deleted symlink/source no longer realpaths; retain its last physical identity.
    const normalized = this.aliases.get(id.split('?')[0]!.replace(/^\0/, '').replaceAll('\\', '/')) ?? sourceId(id)
    this.revision++
    this.resolutions.clear()
    this.sources.clear()
    this.signatures.clear()
    this.identities.clear()
    this.pending.clear()
    const configuration = /\.json$|(?:^|\/)config\/|(?:^|\/)[^/]*config\.[cm]?[jt]s$|lock\.(?:yaml|json)$/.test(normalized)
    const affected = new Set([normalized])
    for (const [key, entry] of this.scriptCache) {
      if (configuration || entry.result.dependencies.includes(normalized) || key.startsWith(`${normalized}.`)) {
        affected.add(key.split('\0')[0]!)
        this.scriptCache.delete(key)
      }
    }
    this.dirty.add(normalized)
    if (deleted) {
      this.remove(normalized)
    }
    for (const [owner, module] of this.modules) {
      if (configuration || module.dependencies.some(id => affected.has(id))) {
        this.dirty.add(owner)
      }
    }
    if (configuration) {
      this.edges.clear()
    }
    else {
      this.edges.delete(normalized)
    }
  }

  prune(ids: Iterable<string>): void {
    const active = new Set([...ids].map(sourceId))
    // Tokens can be removed from rendered JS after Babel resolves their values,
    // while their CSS defaults remain dependencies of a live styles module.
    for (const id of active) {
      for (const dependency of this.modules.get(id)?.dependencies ?? []) {
        active.add(dependency)
      }
    }
    for (const id of this.modules.keys()) {
      if (!active.has(id)) {
        this.remove(id)
      }
    }
    for (const file of this.scriptKeys.keys()) {
      const owner = file.replace(/\.stylex-script-\d+\.[^.]+$/, '')
      if (!active.has(owner)) {
        this.remove(file)
      }
    }
  }

  css(): string {
    return processRules(
      [...this.modules.values()].flatMap(module => module.rules),
    )
  }

  clear(): void {
    this.modules.clear()
    this.dirty.clear()
    this.scriptCache.clear()
    this.pending.clear()
    this.edges.clear()
    this.notices.clear()
    this.requests.clear()
    this.scriptKeys.clear()
    this.aliases.clear()
    this.beginBuild()
  }
}
