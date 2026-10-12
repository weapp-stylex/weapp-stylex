import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer, get } from 'node:http'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { examples } from './example-matrix.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const backend = process.env.WEAPP_STYLEX_BACKEND ?? 'babel'
const artifacts = path.join(root, 'artifacts/h5', backend)
await mkdir(artifacts, { recursive: true })
const selected = examples.filter(example => example.target === 'h5'
  && (!process.env.WEAPP_STYLEX_H5_FILTER || `${example.name}/${example.builder ?? ''}`.includes(process.env.WEAPP_STYLEX_H5_FILTER)))
assert.ok(selected.length, 'No H5 examples selected')

const report = { backend, startedAt: new Date().toISOString(), browser: { headless: true }, examples: [], resources: [] }
const errors = []
const deploymentBase = '/stylex-preview/'
let servingRoot
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    assert.ok(pathname.startsWith(deploymentBase), `Asset escaped the deployment base: ${pathname}`)
    const relativePath = pathname.slice(deploymentBase.length)
    let file = path.resolve(servingRoot, relativePath)
    assert.ok(file === servingRoot || file.startsWith(`${servingRoot}${path.sep}`))
    try {
      if ((await stat(file)).isDirectory()) {
        file = path.join(file, 'index.html')
      }
    }
    catch {
      if (!path.extname(relativePath)) {
        file = path.join(servingRoot, 'index.html')
      }
    }
    const content = await readFile(file)
    response.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    response.end(content)
  }
  catch {
    response.writeHead(404)
    response.end('Not found')
  }
})

async function poll(check, description, timeout = 30000, assertRunning = () => {}) {
  const deadline = Date.now() + timeout
  let failure
  while (Date.now() < deadline) {
    assertRunning()
    try {
      const value = await check()
      if (value) {
        return value
      }
    }
    catch (error) {
      failure = error
    }
    await delay(150)
  }
  throw new Error(`Timed out: ${description}`, { cause: failure })
}

async function computed(page, selector, property) {
  return page.locator(selector).first().evaluate((element, key) => getComputedStyle(element)[key], property)
}

async function cssText(page) {
  return page.evaluate(async () => {
    const texts = []
    const visit = (scope) => {
      for (const element of scope.querySelectorAll('*')) {
        if (element.tagName === 'STYLE') {
          texts.push(element.textContent)
        }
        if (element.shadowRoot) {
          visit(element.shadowRoot)
        }
      }
    }
    visit(document)
    await Promise.all([...document.querySelectorAll('link[rel="stylesheet"]')].map(async (link) => {
      texts.push(await (await fetch(link.href)).text())
    }))
    return texts.join('\n')
  })
}

async function reLaunchWeappPage(page, url) {
  // HTML load can finish before the host's async page modules register routes.
  await page.waitForFunction(() => typeof globalThis.wx?.reLaunch === 'function'
    && typeof globalThis.getCurrentPages === 'function'
    && globalThis.getCurrentPages().length > 0)
  await page.evaluate(async (targetUrl) => {
    try {
      await globalThis.wx.reLaunch({ url: targetUrl })
    }
    catch (error) {
      if (error instanceof Error || !error || typeof error !== 'object') {
        throw error
      }
      // The host rejects failed navigation with a plain { errMsg } object.
      throw new Error(`reLaunch ${targetUrl} rejected: ${JSON.stringify(error)}`)
    }
  }, url)
}

async function interactions(page, url, example) {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto(url)
  await poll(async () => await computed(page, '#stylex-root', 'paddingTop') === '16px', `${example.name}: first StyleX paint`)
  assert.equal(await computed(page, '#stylex-meter', 'width'), '80px')
  assert.equal(await computed(page, '#stylex-meter', 'height'), '12px')
  const initialTheme = await computed(page, '#stylex-root', 'backgroundColor')
  await page.locator('#stylex-toggle').click()
  await poll(async () => Number(await computed(page, '#stylex-toggle', 'opacity')) === 0.6, 'conditional style')
  await page.locator('#stylex-grow').click()
  await poll(async () => await computed(page, '#stylex-meter', 'width') === '120px', 'dynamic official runtime value')
  await page.locator('#stylex-theme').click()
  await poll(async () => await computed(page, '#stylex-root', 'backgroundColor') !== initialTheme, 'theme switch')
  const darkTheme = await computed(page, '#stylex-root', 'backgroundColor')
  if (example.cssDelivery === 'weapp-web') {
    await poll(async () => await computed(page, '#stylex-inherited-root', 'backgroundColor') === darkTheme, 'theme inheritance through component ShadowRoot')
  }
  const cardSelector = await page.locator('#stylex-card-root').count() ? '#stylex-card-root' : '#stylex-card'
  const narrowMargin = Number.parseFloat(await computed(page, cardSelector, 'marginTop'))
  assert.ok(narrowMargin > 0, 'Static rpx produced no usable CSS')
  await page.setViewportSize({ width: 750, height: 900 })
  await poll(async () => await computed(page, '#stylex-root', 'paddingTop') === '16px', 'px identity after viewport change')
  if (example.cssDelivery !== 'weapp-web') {
    await poll(async () => Number.parseFloat(await computed(page, cardSelector, 'marginTop')) > narrowMargin, 'host responsive resize')
  }
  const wideMargin = Number.parseFloat(await computed(page, cardSelector, 'marginTop'))
  assert.ok(wideMargin > 0 && Number.isFinite(wideMargin))
  if (example.cssDelivery === 'weapp-web') {
    const containerWidth = await page.locator('#app').evaluate(element => element.getBoundingClientRect().width)
    assert.ok(Math.abs(wideMargin - containerWidth * 12 / 750) < 0.15, 'rpx differs from the host device container')
  }
  else {
    assert.ok(wideMargin > narrowMargin, 'Host responsive rpx did not follow viewport changes')
  }
  if (example.cssDelivery === 'weapp-web') {
    await reLaunchWeappPage(page, '/subpackage/detail/index')
  }
  else {
    await page.goto(`${url.replace(/\/$/, '')}/#/subpackage/detail/index`)
  }
  await poll(async () => await computed(page, '#stylex-detail', 'paddingTop') === '16px', 'subpackage route style')
  await page.goto(url, { waitUntil: 'load' })
  if (example.cssDelivery === 'weapp-web') {
    await reLaunchWeappPage(page, '/pages/index/index')
  }
  await poll(async () => await computed(page, '#stylex-root', 'paddingTop') === '16px', 'return to main route')
}

async function availablePort() {
  const probe = net.createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const { port } = probe.address()
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()))
  return port
}

function serverResponds(url) {
  return new Promise((resolve, reject) => {
    const request = get(url, { agent: false, headers: { Accept: 'text/html' } }, (response) => {
      response.resume()
      resolve(response.statusCode >= 200 && response.statusCode < 400)
    })
    request.setTimeout(1500, () => request.destroy(new Error('Server readiness request timed out')))
    request.once('error', reject)
  })
}

async function devChecks(page, example, name) {
  const port = await availablePort()
  const url = `http://127.0.0.1:${port}/`
  const log = []
  const child = spawn('corepack', ['pnpm', example.devScript], {
    cwd: path.join(root, 'examples', example.name),
    env: { ...process.env, WEAPP_STYLEX_PORT: String(port), BROWSER: 'none' },
    detached: process.platform !== 'win32',
    // Keep inherited input open throughout the development session.
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const resource = { kind: 'dev-server', name, pid: child.pid, port, closed: false }
  report.resources.push(resource)
  child.stdout.on('data', chunk => log.push(chunk.toString()))
  child.stderr.on('data', chunk => log.push(chunk.toString()))
  const exit = once(child, 'exit')
  const shared = path.join(root, 'examples', example.name, 'src/styles/shared.ts')
  const tokens = path.join(root, 'examples', example.name, 'src/styles/tokens.stylex.ts')
  const originalShared = await readFile(shared, 'utf8')
  const originalTokens = await readFile(tokens, 'utf8')
  let unloadFailure
  try {
    await poll(async () => {
      return serverResponds(url)
    }, `${name}: dev server ready`, 90000, () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Dev server exited ${child.exitCode ?? child.signalCode}: ${log.join('').slice(-12000)}`)
      }
    })
    await interactions(page, url, example)
    const modified = originalShared.replace('padding: 16,', 'padding: 17,')
    assert.notEqual(modified, originalShared)
    await writeFile(shared, modified)
    await poll(async () => await computed(page, '#stylex-root', 'paddingTop') === '17px', `${name}: development rule update`)
    await writeFile(shared, originalShared)
    await poll(async () => await computed(page, '#stylex-root', 'paddingTop') === '16px', `${name}: removed rule cleanup`)
    const changedTokens = originalTokens.replace('#4b63d3', '#123456')
    assert.notEqual(changedTokens, originalTokens)
    await writeFile(tokens, changedTokens)
    await poll(async () => (await cssText(page)).includes('#123456'), `${name}: token-only CSS update`)
    await writeFile(tokens, originalTokens)
    await poll(async () => !(await cssText(page)).includes('#123456'), `${name}: restored token CSS`)
    await page.screenshot({ path: path.join(artifacts, `${name}-dev.png`), fullPage: true })
  }
  catch (error) {
    resource.failure = await page.evaluate(async () => {
      const root = document.querySelector('#stylex-root')
      return {
        runtime: {
          reLaunch: typeof globalThis.wx?.reLaunch,
          getCurrentPages: typeof globalThis.getCurrentPages,
          routes: typeof globalThis.getCurrentPages === 'function'
            ? globalThis.getCurrentPages().map(page => page.route)
            : [],
        },
        root: root?.outerHTML.slice(0, 3000),
        padding: root ? getComputedStyle(root).paddingTop : undefined,
        styles: await Promise.all([...document.querySelectorAll('link[data-weapp-stylex]')].map(async (link) => {
          try {
            const response = await fetch(link.href)
            return { href: link.href, status: response.status, css: await response.text() }
          }
          catch (cause) {
            return { href: link.href, error: String(cause) }
          }
        })),
      }
    }).catch(cause => ({ error: String(cause) }))
    throw error
  }
  finally {
    await writeFile(shared, originalShared)
    await writeFile(tokens, originalTokens)
    // Unload the dev client before closing its server, so reconnect errors do
    // not leak into the next artifact's browser assertions.
    try {
      await page.goto('about:blank')
    }
    catch (error) {
      unloadFailure = error
    }
    await writeFile(path.join(artifacts, `${name}-dev.log`), log.join(''))
    child.stdin.end()
    if (child.exitCode === null && child.pid) {
      if (process.platform === 'win32') {
        child.kill('SIGTERM')
      }
      else {
        process.kill(-child.pid, 'SIGTERM')
      }
    }
    const timeout = new AbortController()
    try {
      await Promise.race([exit, delay(10000, undefined, { signal: timeout.signal }).then(() => {
        throw new Error(`Dev server ${name} did not stop`)
      })])
    }
    finally {
      timeout.abort()
    }
    await poll(async () => {
      try {
        await serverResponds(url)
        return false
      }
      catch {
        return true
      }
    }, `${name}: owned server port closed`, 10000)
    resource.closed = true
  }
  if (unloadFailure) {
    throw unloadFailure
  }
}

let browser
let context
let page
try {
  servingRoot = selected[0].project
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  report.resources.push({ kind: 'static-server', name: 'h5-matrix', port: server.address().port, closed: false })
  const base = `http://127.0.0.1:${server.address().port}${deploymentBase}`
  browser = await chromium.launch({ headless: true, ...(process.env.WEAPP_STYLEX_BROWSER_CHANNEL ? { channel: process.env.WEAPP_STYLEX_BROWSER_CHANNEL } : {}) })
  report.resources.push({ kind: 'browser', name: 'h5-matrix', headless: true, closed: false })
  context = await browser.newContext()
  page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.stack || error.message || String(error)))
  for (const example of selected) {
    const name = `${example.name}${example.builder ? `-${example.builder}` : ''}`
    servingRoot = example.project
    const entry = { name, directory: example.directory, production: 'running', development: 'pending' }
    report.examples.push(entry)
    errors.length = 0
    await interactions(page, base, example)
    assert.deepEqual(errors, [], `${name}: browser errors`)
    await page.screenshot({ path: path.join(artifacts, `${name}-production.png`), fullPage: true })
    entry.production = 'passed'
    process.stdout.write(`H5 production passed: ${name}\n`)
    if (process.env.WEAPP_STYLEX_H5_SKIP_DEV !== '1') {
      entry.development = 'running'
      await devChecks(page, example, name)
      assert.deepEqual(errors, [], `${name}: development browser errors`)
      entry.development = 'passed'
      process.stdout.write(`H5 development passed: ${name}\n`)
    }
  }
  report.status = 'passed'
}
catch (error) {
  report.status = 'failed'
  report.error = error.stack
  report.browserErrors = [...errors]
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true })
  }
  throw error
}
finally {
  try {
    if (context) {
      await context.close()
    }
  }
  finally {
    try {
      if (browser) {
        await browser.close()
        report.resources.find(resource => resource.kind === 'browser').closed = true
      }
    }
    finally {
      if (server.listening) {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        report.resources.find(resource => resource.kind === 'static-server').closed = true
      }
      report.finishedAt = new Date().toISOString()
      await writeFile(path.join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    }
  }
}
