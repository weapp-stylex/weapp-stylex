import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const workspace = fileURLToPath(new URL('../../../', import.meta.url))
const content = fileURLToPath(new URL('../src/content/docs/', import.meta.url))
const packages = ['weapp-stylex', 'core', 'compiler', 'weapp-vite', 'taro', 'uni-app']
const pages = {
  runtime: [
    'create',
    'attrs',
    'props',
    'defineVars',
    'createTheme',
    'defineConsts',
    'keyframes',
    'firstThatWorks',
    'types',
    'defineMarker',
    'defaultMarker',
    'when',
    'env',
    'positionTry',
    'viewTransitionClass',
    'unstable_conditional',
    'unstable_defineVarsNested',
    'unstable_defineConstsNested',
    'unstable_createThemeNested',
    'legacyMerge',
  ],
  types: [
    'CSSProperties',
    'CompiledStyles',
    'InlineStyles',
    'Keyframes',
    'MapNamespaces',
    'StaticStyles',
    'StaticStylesWithout',
    'StyleXArray',
    'StyleXClassNameFor',
    'StyleXStyles',
    'StyleXStylesWithout',
    'StyleXVar',
    'Theme',
    'Types',
    'VarGroup',
    'PositionTry',
  ],
  adapters: ['stylexCompiler', 'createStylex', 'stylexTaro', 'stylexLoader', 'stylexUniApp'],
  compiler: [
    'StylexBackend',
    'backendBuildDependencies',
    'StylexDiagnostic',
    'formatDiagnostic',
    'StylexCompileError',
    'compileError',
    'SfcParser',
    'StylexCompilerOptions',
    'TransformHost',
    'ModuleStyles',
    'SourceTransform',
    'SCRIPT_RE',
    'sourceId',
    'processRules',
    'StylexSession',
    'PluginHost',
    'createVitePlugins',
    'StyleAsset',
    'ScriptChunk',
    'StyleBundle',
    'AssetSink',
    'assetText',
    'WxssEmitter',
  ],
}
const pageForSymbol = new Map(Object.entries(pages).flatMap(([page, names]) => names.map(name => [name, page])))
const defaultExports = new Map([
  ['weapp-stylex/weapp-vite', 'stylexCompiler'],
  ['@weapp-stylex/weapp-vite', 'stylexCompiler'],
  ['weapp-stylex/taro', 'stylexTaro'],
  ['@weapp-stylex/taro', 'stylexTaro'],
  ['weapp-stylex/taro/loader', 'stylexLoader'],
  ['@weapp-stylex/taro/loader', 'stylexLoader'],
  ['weapp-stylex/uni-app', 'stylexUniApp'],
  ['@weapp-stylex/uni-app', 'stylexUniApp'],
])

// Follow every declaration condition, including the facade's ESM and CJS entries.
function declarationTargets(value) {
  if (!value || typeof value !== 'object') {
    return []
  }
  return Object.entries(value).flatMap(([condition, target]) => condition === 'types' && typeof target === 'string'
    ? [target]
    : declarationTargets(target))
}

const entries = []
for (const directory of packages) {
  const packageRoot = path.join(workspace, 'packages', directory)
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
  for (const [subpath, conditions] of Object.entries(manifest.exports)) {
    if (subpath === './package.json') {
      continue
    }
    const specifier = `${manifest.name}${subpath === '.' ? '' : subpath.slice(1)}`
    const targets = [...new Set(declarationTargets(conditions))]
    assert.ok(targets.length, `${specifier}: public entry has no declaration target`)
    for (const target of targets) {
      const filename = path.join(packageRoot, target)
      try {
        await readFile(filename)
      }
      catch {
        throw new Error(`Missing ${filename}. Build the public packages before checking API docs.`)
      }
      entries.push({ specifier, filename })
    }
  }
}

const program = ts.createProgram([...new Set(entries.map(entry => entry.filename))], {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  noEmit: true,
})
const checker = program.getTypeChecker()
const requirements = new Map()
const symbols = new Map()
const failures = []

function resolveSymbol(symbol) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}

function requireSection(name, page, member) {
  const anchor = `api-${name}${member ? `-${member}` : ''}`
  requirements.set(`${page}#${anchor}`, { anchor, page, label: member || name })
}

for (const entry of entries) {
  const source = program.getSourceFile(entry.filename)
  const module = source && checker.getSymbolAtLocation(source)
  assert.ok(module, `${entry.specifier}: declaration is not a TypeScript module`)
  const exports = checker.getExportsOfModule(module)
  assert.ok(exports.length, `${entry.specifier}: public exports could not be resolved`)
  for (const exported of exports) {
    const target = resolveSymbol(exported)
    const name = exported.name === 'default' ? defaultExports.get(entry.specifier) : exported.name
    if (!name || !pageForSymbol.has(name)) {
      failures.push(`${entry.specifier}: unmapped public export ${exported.name}; add its API chapter mapping`)
      continue
    }
    if (exported.name === 'default' && target.name !== name) {
      failures.push(`${entry.specifier}: default export no longer aliases ${name}`)
    }
    if (!target.declarations?.length) {
      failures.push(`${entry.specifier}: ${exported.name} could not be resolved to its declaration`)
    }
    requireSection(name, pageForSymbol.get(name))
    symbols.set(name, target)
  }
}

for (const [owner, page] of [['types', 'runtime'], ['when', 'runtime'], ['Types', 'types'], ['StylexSession', 'compiler'], ['WxssEmitter', 'compiler']]) {
  const symbol = symbols.get(owner)
  assert.ok(symbol, `Missing public ${owner} export`)
  let members
  if (owner === 'Types') {
    members = checker.getExportsOfModule(symbol)
  }
  else if (symbol.flags & ts.SymbolFlags.Class) {
    members = checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol)).filter(member => !(member.declarations || []).some(declaration => ts.getCombinedModifierFlags(declaration) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)))
  }
  else {
    const declaration = symbol.valueDeclaration || symbol.declarations[0]
    members = checker.getPropertiesOfType(checker.getTypeOfSymbolAtLocation(symbol, declaration))
  }
  assert.ok(members.length, `Could not resolve ${owner} public members`)
  for (const member of members) {
    requireSection(owner, page, member.name)
  }
}

// An anchor must belong to an actual section, not a code example or unrelated mention.
// Consecutive anchors may share a heading, for example a table of small helper types.
function sections(markdown, filename) {
  const lines = markdown.split(/\r?\n/)
  const headings = []
  const anchors = []
  let fence
  for (const [index, line] of lines.entries()) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) {
      if (!fence) {
        fence = marker
      }
      else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = undefined
      }
      continue
    }
    if (fence) {
      continue
    }
    const heading = /^(#{1,6})[ \t]+\S.*$/.exec(line)
    if (heading) {
      headings.push({ index, level: heading[1].length })
    }
    const anchor = /^\s*<a id="(api-[^"]+)"\s*(?:><\/a>|\/>)\s*$/.exec(line)
    if (anchor) {
      anchors.push({ index, id: anchor[1] })
    }
  }
  const result = new Map()
  const isGap = line => !line.trim() || /^\s*<a id="api-[^"]+"\s*(?:><\/a>|\/>)\s*$/.test(line)
  for (const anchor of anchors) {
    const heading = headings.find(candidate => candidate.index > anchor.index && lines.slice(anchor.index + 1, candidate.index).every(isGap))
      || headings.findLast(candidate => candidate.index < anchor.index && lines.slice(candidate.index + 1, anchor.index).every(isGap))
    if (!heading || heading.level < 2 || heading.level > 4) {
      failures.push(`${filename}: ${anchor.id} must be adjacent to a level 2–4 heading`)
      continue
    }
    const end = headings.find(candidate => candidate.index > heading.index && candidate.level <= heading.level)?.index || lines.length
    const body = lines.slice(heading.index, end).filter(line => !isGap(line)).join('\n')
    if (result.has(anchor.id)) {
      failures.push(`${filename}: duplicate anchor ${anchor.id}`)
    }
    result.set(anchor.id, body)
  }
  return result
}

for (const locale of ['', 'zh/']) {
  const chapters = new Map()
  for (const page of Object.keys(pages)) {
    const filename = `${locale}api/${page}.mdx`
    try {
      chapters.set(page, sections(await readFile(path.join(content, filename), 'utf8'), filename))
    }
    catch (error) {
      failures.push(`${filename}: ${error.message}`)
    }
  }
  for (const { page, anchor, label } of requirements.values()) {
    const filename = `${locale}api/${page}.mdx`
    const section = chapters.get(page)?.get(anchor)
    if (!section) {
      failures.push(`${filename}: missing section anchor ${anchor}`)
      continue
    }
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(section)) {
      failures.push(`${filename}#${anchor}: its section must describe ${label}`)
    }
  }
  for (const [page, chapter] of chapters) {
    const expected = new Set([...requirements.values()].filter(requirement => requirement.page === page).map(({ anchor }) => anchor))
    for (const anchor of chapter.keys()) {
      if (!expected.has(anchor)) {
        failures.push(`${locale}api/${page}.mdx}: ${anchor} does not map to a public export/member in this chapter`)
      }
    }
  }
}

assert.equal(failures.length, 0, `API coverage failed:\n${failures.map(failure => `- ${failure}`).join('\n')}`)
console.log(`API coverage checked: ${new Set(entries.map(entry => entry.specifier)).size} public entries, ${entries.length} declaration conditions, ${symbols.size} exports, ${requirements.size} sections in both locales.`)
