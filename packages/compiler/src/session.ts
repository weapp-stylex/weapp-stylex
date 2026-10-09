import type { BabelFileResult } from '@babel/core'
import type { Options, Rule } from '@stylexjs/babel-plugin'
import { readFileSync, realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import remapping from '@ampproject/remapping'
import babel from '@babel/core'
import stylexPlugin from '@stylexjs/babel-plugin'
import { parse } from '@vue/compiler-sfc'
import { Bundle, MagicString } from 'magic-string'
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'

export type SfcParser = typeof parse

export interface StylexCompilerOptions {
  importSources?: readonly string[]
  babel?: Partial<Options>
}
export interface TransformHost {
  resolve: (source: string, importer: string) => Promise<string | undefined>
  addWatchFile: (id: string) => void
}
export interface ModuleStyles {
  rules: Rule[]
  dependencies: string[]
}
export interface SourceTransform extends ModuleStyles {
  code: string
  map?: string
}
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
function canonicalPath(filename: string): string {
  const file = sourceId(filename)
  let directory = path.dirname(file)
  while (true) {
    try {
      const pkg = JSON.parse(
        readFileSync(path.join(directory, 'package.json'), 'utf8'),
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
  constructor(
    readonly options: StylexCompilerOptions = {},
    readonly parseSfc: SfcParser = parse,
  ) {
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

  async transformScript(
    code: string,
    filename: string,
    host: TransformHost,
    ancestors: ReadonlySet<string> = new Set(),
  ): Promise<ModuleStyles & { code: string, map: BabelFileResult['map'] }> {
    const resolutions = new Map<string, string>()
    const dependencies = new Set<string>([sourceId(filename)])
    const ast = babel.parseSync(code, {
      filename,
      babelrc: false,
      configFile: false,
      parserOpts: {
        sourceType: 'unambiguous',
        plugins: parserPlugins(filename),
      },
    })
    for (const node of ast?.program.body ?? []) {
      if (
        'source' in node
        && node.source
        && 'value' in node.source
        && typeof node.source.value === 'string'
      ) {
        const specifier = node.source.value
        if (this.importSources.includes(specifier)) {
          continue
        }
        const resolved = await host.resolve(specifier, sourceId(filename))
        if (resolved) {
          resolutions.set(specifier, sourceId(resolved))
          dependencies.add(sourceId(resolved))
        }
      }
    }
    for (const dependency of dependencies) {
      host.addWatchFile(dependency)
    }
    const result = babel.transformSync(code, {
      filename,
      sourceFileName: filename,
      sourceType: 'unambiguous',
      babelrc: false,
      configFile: false,
      sourceMaps: true,
      parserOpts: { plugins: parserPlugins(filename) },
      plugins: [
        stylexPlugin.withOptions({
          unstable_moduleResolution: {
            type: 'custom',
            filePathResolver: specifier => resolutions.get(specifier),
            getCanonicalFilePath: canonicalPath,
          },
          ...this.options.babel,
          importSources: [...this.importSources],
          classNamePrefix: 'sx',
          debug: false,
          dev: false,
          test: false,
          runtimeInjection: false,
          styleResolution: 'application-order',
        }),
      ],
    })
    if (!result?.code) {
      throw new Error(`StyleX did not produce code for ${filename}`)
    }
    const metadata = result.metadata as { stylex?: Rule[] }
    const rules = [...(metadata.stylex ?? [])]
    // Babel inlines token references and may erase their JS import completely.
    // Collect their default CSS here so even a host that never loads the token
    // module (or restores this module from cache) receives the full metadata.
    const lineage = new Set([...ancestors, sourceId(filename)])
    for (const dependency of new Set(resolutions.values())) {
      if (!/\.stylex\.[cm]?[jt]sx?$/i.test(dependency)) {
        continue
      }
      if (lineage.has(dependency)) {
        throw new Error(`Cyclic StyleX token dependency: ${dependency}`)
      }
      const source = await readFile(dependency, 'utf8')
      if (!this.hasImport(source)) {
        continue
      }
      const token = await this.transformScript(source, dependency, host, lineage)
      rules.push(...token.rules)
      for (const id of token.dependencies) {
        dependencies.add(id)
      }
    }
    return {
      code: result.code,
      map: result.map,
      rules,
      dependencies: [...dependencies],
    }
  }

  async transform(
    code: string,
    id: string,
    host: TransformHost,
  ): Promise<SourceTransform | null> {
    const filename = sourceId(id)
    if (filename.endsWith('.vue')) {
      return id.includes('?') ? null : this.transformSfc(code, filename, host)
    }
    if (!SCRIPT_RE.test(filename)) {
      return null
    }
    if (!this.hasImport(code)) {
      this.modules.delete(filename)
      this.dirty.delete(filename)
      return null
    }
    const result = await this.transformScript(code, filename, host)
    this.modules.set(filename, result)
    this.dirty.delete(filename)
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
      this.modules.delete(filename)
      this.dirty.delete(filename)
      return null
    }
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
      this.modules.delete(filename)
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
      const scriptFilename = `${filename}.${block!.lang ?? 'js'}`
      const result = await this.transformScript(
        block!.content,
        scriptFilename,
        {
          resolve: specifier => host.resolve(specifier, filename),
          addWatchFile: (dependency) => {
            if (dependency !== scriptFilename) {
              host.addWatchFile(dependency)
            }
          },
        },
      )
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
    this.modules.set(filename, result)
    this.dirty.delete(filename)
    return result
  }

  change(id: string, deleted = false): void {
    const normalized = sourceId(id)
    this.dirty.add(normalized)
    if (deleted) {
      this.modules.delete(normalized)
    }
    for (const [owner, module] of this.modules) {
      if (module.dependencies.includes(normalized)) {
        this.dirty.add(owner)
      }
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
        this.modules.delete(id)
        this.dirty.delete(id)
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
  }
}
