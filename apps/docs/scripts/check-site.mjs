import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { getSiteSidebar } from '../src/lib/navigation.ts'

const output = new URL('../dist/', import.meta.url)
const content = new URL('../src/content/docs/', import.meta.url)
const origin = 'https://stylex.weapp.dev'
const editPrefix = 'https://github.com/weapp-stylex/weapp-stylex/edit/main/apps/docs/src/content/docs/'
const customComponents = new Set(['Aside', 'ApiTable', 'Tabs', 'Tab', 'Steps', 'Step', 'HomeHero', 'CardGrid', 'LinkCard'])
// Keep published routes reachable; adding pages does not require changing this baseline.
const publicRoutes = [
  'get-started',
  'aggregate-package',
  'native',
  'wevu',
  'taro-react',
  'taro-vue3',
  'uni-app',
  'styles',
  'themes',
  'configuration',
  'architecture',
  'performance',
  'examples',
  'faq',
  'contributing',
  'api',
  'api/runtime',
  'api/types',
  'api/adapters',
  'api/compiler',
  'recipes',
  'recipes/composition',
  'recipes/dynamic-styles',
  'recipes/tokens-themes',
  'recipes/shared-modules',
  'recipes/components-subpackages',
  'recipes/migration',
  'troubleshooting',
]

function decode(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: '\u00A0' }
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name) => {
    if (name.startsWith('#')) {
      const hex = name[1]?.toLowerCase() === 'x'
      return String.fromCodePoint(Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10))
    }
    return named[name.toLowerCase()] ?? entity
  })
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(([, name, double, single]) => [name, decode(double ?? single)]))
}

function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map(([tag]) => attributes(tag))
}

const idsIn = html => tags(html, '[a-z][a-z0-9:-]*').map(tag => tag.id).filter(Boolean)
const flattenNavigation = items => items.flatMap(item => item.type === 'group' ? flattenNavigation(item.children) : item.type === 'link' ? [item.href] : [])
const normalize = text => text.replace(/\s+/g, ' ').trim()
const normalizeReadable = text => normalize(text.replace(/^[ \t]*\|[ :|-]+\|[ \t]*$/gm, '| TABLE-DELIMITER |'))
const stripFrontmatter = text => text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
const frontmatter = text => /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1] ?? ''

function sourceRoute(file, text) {
  const slug = /^slug:\s*(?:"([^"]*)"|'([^']*)'|([^#\r\n]+))/m.exec(frontmatter(text))
  const id = (slug ? slug[1] ?? slug[2] ?? slug[3].trim() : file.replace(/\.mdx?$/, '').replace(/(?:^|\/)index$/, '')).replace(/^\/+|\/+$/g, '')
  return `/${id}${id ? '/' : ''}`
}

// Preserve offsets while excluding code examples from JSX/anchor recognition.
function outsideCode(text) {
  let fence
  return text.split('\n').map((line) => {
    const marker = /^[ \t]*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) {
        fence = undefined
      }
      return ' '.repeat(line.length)
    }
    if (marker) {
      fence = marker[1]
      return ' '.repeat(line.length)
    }
    return line.replace(/(`+).*?\1/g, value => ' '.repeat(value.length))
  }).join('\n')
}

function componentTags(body, filename) {
  return [...outsideCode(body).matchAll(/<\/?([A-Z]\w*)\b[^>]*>/g)].map((match) => {
    assert.ok(customComponents.has(match[1]), `${filename}: add an export check for custom component ${match[1]}`)
    return { name: match[1], markup: body.slice(match.index, match.index + match[0].length), start: match.index, end: match.index + match[0].length }
  })
}

function readableContract(body, components) {
  let plain = body
  for (const tag of components.toReversed()) {
    plain = plain.slice(0, tag.start) + plain.slice(tag.end)
  }
  return plain.split(/\n\s*\n/).map(normalizeReadable).filter(Boolean)
}

function checkReadableExport(text, source, components, label) {
  const rendered = normalizeReadable(text)
  for (const block of readableContract(source, components)) {
    assert.ok(rendered.includes(block), `${label}: source content disappeared from the readable export: ${block.slice(0, 100)}`)
  }
  for (const component of components.filter(tag => !tag.markup.startsWith('</'))) {
    const attrs = attributes(component.markup)
    // Tabs' group label names an ARIA container; each visible Tab label is exported.
    const fields = {
      Aside: ['title'],
      ApiTable: ['title'],
      Tab: ['label'],
      Step: ['title'],
      HomeHero: ['title', 'description'],
      LinkCard: ['title', 'description'],
    }[component.name] ?? []
    for (const field of fields) {
      if (attrs[field]) {
        assert.ok(rendered.includes(normalize(attrs[field])), `${label}: missing ${component.name} ${field}: ${attrs[field]}`)
      }
    }
    if (component.name === 'Tab') {
      assert.ok(attrs.label && text.includes(`**${attrs.label}**`), `${label}: tab labels must remain readable`)
    }
    if (component.name === 'Step') {
      assert.ok(attrs.title && text.includes(`### ${attrs.title}`), `${label}: step headings must remain readable`)
    }
    if (component.name === 'LinkCard') {
      assert.ok(text.includes(`[${attrs.title}](${attrs.href})`), `${label}: card destinations must remain readable`)
    }
  }
  assert.doesNotMatch(outsideCode(text), /<\/?(?:Aside|ApiTable|Tabs|Tab|Steps|Step|HomeHero|CardGrid|LinkCard)\b/, `${label}: custom JSX must be converted into readable Markdown`)
}

const deployment = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'))
assert.equal(deployment.main, undefined, 'Language detection must not add a Worker script')
assert.equal(deployment.assets.run_worker_first, undefined, 'Language detection must stay in the client')
const files = (await readdir(output, { recursive: true })).map(file => file.split(path.sep).join('/'))
const fileSet = new Set(files)
const sourceFiles = (await readdir(content, { recursive: true })).filter(file => /\.mdx?$/.test(file)).map(file => file.split(path.sep).join('/'))
const documents = new Map()
for (const [file, text] of await Promise.all(sourceFiles.map(async file => [file, await readFile(new URL(file, content), 'utf8')]))) {
  if (/^draft:\s*true\s*$/m.test(frontmatter(text))) {
    continue
  }
  const route = sourceRoute(file, text)
  assert.ok(!documents.has(route), `Duplicate source route: ${route}`)
  documents.set(route, { file, text })
}
for (const chinese of [false, true]) {
  for (const route of [chinese ? '/zh/' : '/en/', ...publicRoutes.map(id => `${chinese ? '/zh' : ''}/${id}/`)]) {
    assert.ok(documents.has(route), `Published documentation route is missing: ${route}`)
  }
  const navigation = flattenNavigation(getSiteSidebar(chinese ? '/zh/get-started/' : '/get-started/', chinese))
  const localized = [...documents.keys()].filter(route => route.startsWith('/zh/') === chinese)
  assert.deepEqual(navigation.toSorted(), localized.toSorted(), 'Shared navigation must include every source once in each language')
}
const pages = files.filter(file => file.endsWith('index.html') && file !== 'index.html' && !file.startsWith('pagefind/'))
assert.deepEqual(pages.toSorted(), [...documents.keys()].map(route => `${route.slice(1)}index.html`).toSorted(), 'Published HTML must match the documentation source routes')

const htmlCache = new Map()
function readHtml(file) {
  if (!htmlCache.has(file)) {
    htmlCache.set(file, readFile(new URL(file, output), 'utf8'))
  }
  return htmlCache.get(file)
}

async function checkLink(href, current) {
  const url = new URL(decode(href), new URL(current, origin))
  if (url.origin !== origin) {
    return
  }
  const relative = decodeURIComponent(url.pathname).slice(1)
  const target = fileSet.has(relative) ? relative : `${relative.replace(/\/$/, '')}${relative ? '/' : ''}index.html`
  assert.ok(fileSet.has(target), `Missing local link ${url.href} from ${current}`)
  if (url.hash && target.endsWith('.html')) {
    assert.ok(idsIn(await readHtml(target)).includes(decodeURIComponent(url.hash.slice(1))), `Missing anchor ${url.href} from ${current}`)
  }
}

const root = await readHtml('index.html')
assert.doesNotMatch(root, /http-equiv="refresh"/i, 'The root must let the client select a language')
assert.ok(root.includes('href="/zh/"') && root.includes('href="/en/"'), 'The root must provide both languages without JavaScript')
assert.ok(root.includes('hreflang="x-default"'), 'The root is the default language selection entry')
const redirects = await readFile(new URL('_redirects', output), 'utf8')
assert.doesNotMatch(redirects, /^\/(?:index\.html)?\s+/m, 'Edge redirects must not override client language selection')
assert.match(redirects, /^\/index\.mdx\s+\/en\/index\.mdx\s+301\s*$/m, 'Keep the previous English MDX URL reachable')

const fullText = await readFile(new URL('llms-full.txt', output), 'utf8')
const markers = [...fullText.matchAll(/^Source: (\S+) · Markdown: (\S+)$/gm)]
const aiSections = new Map()
for (const [index, marker] of markers.entries()) {
  const next = markers[index + 1]
  const start = Math.max(0, fullText.lastIndexOf('\n# ', marker.index))
  const end = next ? fullText.lastIndexOf('\n# ', next.index) : fullText.length
  assert.ok(!aiSections.has(marker[1]), `Duplicate AI page: ${marker[1]}`)
  aiSections.set(marker[1], fullText.slice(start, end))
  await checkLink(marker[1], '/')
  await checkLink(marker[2], '/')
}
assert.deepEqual([...aiSections.keys()].toSorted(), [...documents.keys()].map(route => `${origin}${route}`).toSorted(), 'The full AI export must contain every published page')

let componentCount = 0
let anchorCount = 0
for (const [route, document] of documents) {
  const chinese = route.startsWith('/zh/')
  const home = route === '/zh/' || route === '/en/'
  const alternate = route === '/zh/' ? '/en/' : route === '/en/' ? '/zh/' : chinese ? route.slice(3) : `/zh${route}`
  assert.ok(documents.has(alternate), `Missing translated route: ${route}`)
  const html = await readHtml(`${route.slice(1)}index.html`)
  assert.equal(tags(html, 'html')[0]?.lang, chinese ? 'zh-CN' : 'en', `Wrong language: ${route}`)
  const links = tags(html, 'link')
  assert.deepEqual(links.filter(link => link.rel === 'canonical').map(link => link.href), [`${origin}${route}`], `Wrong canonical: ${route}`)
  assert.ok(links.some(link => link.rel === 'alternate' && link.hreflang === (chinese ? 'en' : 'zh-CN') && link.href === `${origin}${alternate}`), `Missing language alternate: ${route}`)
  const anchors = tags(html, 'a')
  assert.ok(anchors.some(link => link.class?.split(' ').includes('brand') && link.href === (chinese ? '/zh/' : '/en/')), `Wrong language homepage: ${route}`)
  const languageLinks = anchors.filter(link => link['data-language'])
  assert.equal(languageLinks.length, 1, `Expected one language switch: ${route}`)
  assert.equal(languageLinks[0].href, alternate, `Language switch must preserve the document: ${route}`)
  assert.equal(languageLinks[0]['data-language'], chinese ? 'en' : 'zh', `Wrong saved language choice: ${route}`)
  assert.equal(languageLinks[0].lang, chinese ? 'en' : 'zh-CN', `Wrong language switch metadata: ${route}`)
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, `Expected one H1: ${route}`)
  const ids = idsIn(html)
  assert.equal(new Set(ids).size, ids.length, `Duplicate HTML IDs: ${route}`)
  for (const anchor of anchors) {
    if (anchor.href) {
      await checkLink(anchor.href, route)
    }
  }
  const edits = anchors.filter(link => link.href?.startsWith(editPrefix))
  assert.ok(edits.length <= 1 && (home || edits.length === 1), `Expected a source edit link on documentation articles: ${route}`)
  for (const edit of edits) {
    assert.equal(edit.href, `${editPrefix}${document.file}`, `Edit link must point to the actual source, including directory index files: ${route}`)
    await access(new URL(document.file, content))
  }
  if (!home) {
    assert.ok(html.includes('class="breadcrumbs"'), `Missing breadcrumbs: ${route}`)
    assert.ok(html.includes('class="prev-next"'), `Missing previous/next navigation: ${route}`)
    const navigation = flattenNavigation(getSiteSidebar(route, chinese))
    for (const [surface, pattern] of [
      ['desktop', /<aside\s[^>]*class="site-rail"[^>]*>([\s\S]*?)<\/aside>/],
      ['mobile', /<dialog\s[^>]*id="mobile-navigation"[^>]*>([\s\S]*?)<\/dialog>/],
    ]) {
      const markup = pattern.exec(html)?.[1]
      assert.ok(markup, `Missing ${surface} navigation: ${route}`)
      const navigationLinks = tags(markup, 'a').filter(link => documents.has(link.href))
      assert.deepEqual(navigationLinks.map(link => link.href), navigation, `Wrong ${surface} navigation order: ${route}`)
      assert.deepEqual(navigationLinks.filter(link => link['aria-current'] === 'page').map(link => link.href), [route], `Wrong ${surface} current page: ${route}`)
    }
  }
  const body = stripFrontmatter(document.text).trim()
  const components = componentTags(body, document.file)
  componentCount += components.filter(component => !component.markup.startsWith('</')).length
  const markdown = await readFile(new URL(`${route.slice(1)}index.md`, output), 'utf8')
  const mdx = await readFile(new URL(`${route.slice(1)}index.mdx`, output), 'utf8')
  assert.ok(normalize(mdx).includes(normalize(body)), `MDX export must preserve the complete authored body: ${route}`)
  checkReadableExport(markdown, body, components, `${route}index.md`)
  checkReadableExport(aiSections.get(`${origin}${route}`), body, components, `${route} in llms-full.txt`)
  for (const { id } of tags(outsideCode(body), 'a').filter(anchor => anchor.id)) {
    assert.ok(ids.includes(id), `Source anchor is missing from HTML: ${route}#${id}`)
    assert.ok(tags(outsideCode(markdown), 'a').some(anchor => anchor.id === id), `Source anchor is missing from Markdown: ${route}#${id}`)
    assert.ok(tags(outsideCode(mdx), 'a').some(anchor => anchor.id === id), `Source anchor is missing from MDX: ${route}#${id}`)
    anchorCount++
  }
}

const visitedIndexes = new Set()
const indexedMarkdown = new Set()
async function checkIndex(file) {
  if (visitedIndexes.has(file)) {
    return
  }
  visitedIndexes.add(file)
  const text = await readFile(new URL(file, output), 'utf8')
  for (const [href] of text.matchAll(/https:\/\/stylex\.weapp\.dev\/[^\s)>\]]+/g)) {
    await checkLink(href, '/')
    const url = new URL(href)
    if (url.pathname.endsWith('/llms.txt')) {
      await checkIndex(url.pathname.slice(1))
    }
    if (url.pathname.endsWith('/index.md')) {
      indexedMarkdown.add(url.href)
      if (file === 'zh/llms.txt') {
        assert.ok(url.pathname.startsWith('/zh/'), 'Chinese AI index must not point to English content')
      }
    }
  }
}
await checkIndex('llms.txt')
await checkIndex('zh/llms.txt')
for (const route of documents.keys()) {
  assert.ok(indexedMarkdown.has(`${origin}${route}index.md`), `Page is missing from AI indexes: ${route}`)
}
for (const file of ['robots.txt', 'sitemap-index.xml', 'pagefind/pagefind.js', '404.html']) {
  await access(new URL(file, output))
}
for (const file of ['.well-known/ard.json', '.well-known/ai-catalog.json']) {
  const discovery = JSON.parse(await readFile(new URL(file, output), 'utf8'))
  assert.equal(discovery.host.identifier, `${origin}/`, `Wrong discovery host: ${file}`)
  assert.ok(discovery.entries.some(entry => entry.url === `${origin}/llms.txt`), `Missing documentation index: ${file}`)
  assert.ok(discovery.entries.some(entry => entry.url === `${origin}/index.md`), `Missing homepage Markdown: ${file}`)
  for (const entry of discovery.entries) {
    assert.equal(new URL(entry.url).origin, origin, `Unexpected discovery origin: ${file}`)
    await checkLink(entry.url, '/')
  }
}
const headers = await readFile(new URL('_headers', output), 'utf8')
const ownerHeaders = await readFile(new URL('../public/_headers', import.meta.url), 'utf8')
assert.ok(headers.includes(ownerHeaders.trim()), 'Generated headers must retain the site security and caching rules')
assert.ok(headers.includes(`<${origin}/.well-known/ard.json>; rel="ard"`), 'Missing homepage discovery Link header')
console.log(`Verified ${documents.size} pages: source routes, both navigation surfaces, edit links, language metadata, local links, ${anchorCount} source anchors, ${componentCount} custom components, Markdown/MDX, AI indexes and search/discovery assets.`)
