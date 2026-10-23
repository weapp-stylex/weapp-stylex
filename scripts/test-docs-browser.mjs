import assert from 'node:assert/strict'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { resolveDeploymentContext } from '../apps/docs/scripts/deployment-context.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = path.join(root, 'apps/docs/dist')
const deployment = resolveDeploymentContext()
const artifacts = path.join(root, 'artifacts/docs-browser', deployment.channel)
const report = { node: process.versions.node, channel: deployment.channel, headless: true, checks: [], errors: [], resources: [] }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    let file = path.resolve(output, `.${pathname}`)
    assert.ok(file.startsWith(`${output}${path.sep}`) || file === output)
    if ((await stat(file)).isDirectory()) {
      file = path.join(file, 'index.html')
    }
    response.setHeader('Content-Type', types[path.extname(file)] ?? 'text/plain; charset=utf-8')
    response.end(await readFile(file))
  }
  catch {
    response.statusCode = 404
    response.end('Not found')
  }
})
let browser
let context
await mkdir(artifacts, { recursive: true })
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  report.resources.push({ kind: 'server', origin, owned: true, closed: false })
  browser = await chromium.launch({ headless: true })
  report.resources.push({ kind: 'browser', owned: true, closed: false })
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  for (const [route, language, query] of [['/get-started/', 'en', 'StyleX'], ['/zh/get-started/', 'zh-CN', '样式']]) {
    await page.goto(`${origin}${route}`)
    await page.locator('[data-search-open]').waitFor({ state: 'visible' })
    assert.equal(await page.locator('html').getAttribute('lang'), language)
    assert.equal(await page.locator('h1').count(), 1)
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), `${deployment.origin}${route}`)
    assert.equal(await page.locator('[data-docs-preview]').count(), deployment.preview ? 1 : 0)
    if (deployment.preview) {
      assert.equal(await page.locator('[data-docs-preview]').isVisible(), true)
      assert.equal(await page.locator('[data-docs-preview] a').getAttribute('href'), `${deployment.stableOrigin}${route}`)
      assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex, nofollow')
    }
    await page.locator('[data-theme-select]').selectOption('dark')
    await page.reload()
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
    assert.equal(await page.locator('[data-theme-select]').inputValue(), 'dark')
    await page.locator('[data-theme-select]').focus()
    await page.keyboard.press('ControlOrMeta+k')
    await page.locator('#docs-search-dialog').waitFor({ state: 'visible' })
    assert.equal(await page.locator('#docs-search-dialog input').evaluate(element => element === document.activeElement), true)
    await page.locator('#docs-search-dialog input').fill(query)
    await page.locator('.search-results a').first().waitFor({ state: 'visible' })
    const results = await page.locator('.search-results a').evaluateAll(elements => elements.map(element => new URL(element.href).pathname))
    assert.ok(results.length)
    assert.ok(results.every(result => result.startsWith('/zh/') === (language === 'zh-CN')), 'Search crossed language boundaries')
    await page.keyboard.press('Escape')
    await page.locator('#docs-search-dialog').waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.matches('[data-theme-select]'))
    const code = page.locator('pre code').first()
    await page.locator('.code-copy').first().click()
    await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), await code.textContent())
    const alternate = await page.locator('a[data-language]').getAttribute('href')
    await page.locator('a[data-language]').click()
    await page.waitForURL(`${origin}${alternate}`)
    assert.equal(await page.locator('html').getAttribute('lang'), language === 'en' ? 'zh-CN' : 'en')
    await page.goto(`${origin}${route}`)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await page.screenshot({ path: path.join(artifacts, `${language}-desktop.png`), fullPage: true })
    report.checks.push(`${language}: production Pagefind, keyboard/focus, copy, theme persistence, language routes and desktop layout`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${origin}/zh/get-started/`)
  await page.locator('[data-menu-open]').click()
  await page.locator('#mobile-navigation').waitFor({ state: 'visible' })
  await page.locator('#mobile-navigation a[href="/zh/configuration/"]').click()
  await page.waitForURL(`${origin}/zh/configuration/`)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.screenshot({ path: path.join(artifacts, 'zh-mobile.png'), fullPage: true })
  report.checks.push('Mobile navigation and layout')
  await context.close()
  context = await browser.newContext({ javaScriptEnabled: false })
  const plain = await context.newPage()
  await plain.goto(`${origin}/get-started/`)
  assert.ok((await plain.locator('main').textContent()).includes('StyleX'))
  assert.ok(await plain.locator('pre code').count())
  assert.ok(await plain.locator('a[data-language]').isVisible())
  report.checks.push('Content, code and language links remain available without JavaScript')
  assert.deepEqual(report.errors, [])
  report.passed = true
  process.stdout.write(`Documentation ${deployment.channel} browser checks passed (Node ${report.node}, headless)\n`)
}
finally {
  await context?.close()
  await browser?.close()
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  server.closeAllConnections()
  for (const resource of report.resources) {
    resource.closed = true
  }
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
}
