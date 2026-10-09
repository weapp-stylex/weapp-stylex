import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const output = new URL('../dist/', import.meta.url)
const origin = 'https://stylex.weapp.dev'
const files = await readdir(output, { recursive: true })
const sources = await readdir(new URL('../src/content/docs/', import.meta.url), { recursive: true })
const pages = files.filter(file => file.endsWith('index.html') && !file.startsWith('pagefind/'))
assert.equal(pages.length, sources.filter(file => /\.mdx?$/.test(file)).length, 'Every documentation source should have a published page')

async function checkLink(href, current) {
  const url = new URL(href.replaceAll('&amp;', '&'), new URL(current, origin))
  if (url.origin !== origin) {
    return
  }
  const relative = decodeURIComponent(url.pathname).slice(1)
  const target = !relative || relative.endsWith('/') ? `${relative}index.html` : relative
  await access(new URL(target, output))
  if (url.hash && target.endsWith('.html')) {
    const html = await readFile(new URL(target, output), 'utf8')
    assert.ok(html.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`), `Missing anchor ${url.href}`)
  }
}

for (const file of pages) {
  const route = `/${file.slice(0, -'index.html'.length).split(path.sep).join('/')}`
  const chinese = route.startsWith('/zh/')
  const alternate = chinese ? route.slice(3) : `/zh${route}`
  const html = await readFile(new URL(file, output), 'utf8')
  assert.ok(html.includes(`<html lang="${chinese ? 'zh-CN' : 'en'}"`), `Wrong language: ${route}`)
  assert.ok(html.includes(`rel="canonical" href="${origin}${route}"`), `Wrong canonical: ${route}`)
  assert.ok(html.includes(`href="${origin}${alternate}"`), `Missing alternate: ${route}`)
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, `Expected one H1: ${route}`)
  for (const [, href] of html.matchAll(/<a\s[^>]*href="([^"]+)"/g)) {
    await checkLink(href, route)
  }
  for (const extension of ['md', 'mdx']) {
    const text = await readFile(new URL(`${route.slice(1)}index.${extension}`, output), 'utf8')
    assert.ok(text.length > 100, `Missing content: ${route}index.${extension}`)
  }
}

for (const file of ['llms.txt', 'zh/llms.txt', 'llms-full.txt', 'robots.txt', 'sitemap-index.xml', 'pagefind/pagefind.js', '404.html']) {
  await access(new URL(file, output))
}
const zhIndex = await readFile(new URL('zh/llms.txt', output), 'utf8')
assert.ok(zhIndex.includes(`${origin}/zh/`), 'Chinese AI index must use the canonical domain')
console.log(`Verified ${pages.length} pages: languages, canonical URLs, alternates, internal links, anchors, Markdown and search assets.`)
