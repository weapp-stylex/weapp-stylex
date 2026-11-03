import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire, isBuiltin } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { runInNewContext } from 'node:vm'

const root = fileURLToPath(new URL('..', import.meta.url))
const run = promisify(execFile)
const expected = {
  'node-forge': { major: 1, version: '1.4.2' },
  'source-map-js': { major: 1, version: '1.2.2' },
  'zod': { major: 4, version: '4.6.7' },
  'undici': { versions: { 6: '6.29.1', 7: '7.30.1', 8: '8.12.3' } },
  'body-parser': { major: 1, version: '1.20.9' },
  'path-to-regexp': { line: '0.1.', version: '0.1.13' },
  'follow-redirects': { major: 1, version: '1.16.2' },
  'joi': { major: 17, version: '17.13.9' },
  'lodash': { major: 4, version: '4.18.1' },
  'lodash-es': { major: 4, version: '4.18.1' },
  'decode-uri-component': { line: '0.5.', version: '0.5.1' },
  'ws': { major: 8, version: '8.22.1' },
  'js-yaml': { major: 5, version: '5.5.0' },
  'glob': { major: 10, version: '10.5.0' },
  'mkdirp': { line: '0.5.', version: '0.5.6' },
  'debug': { major: 4, version: '4.4.3' },
  'postcss-selector-parser': { major: 6, version: '6.1.5' },
  'qs': { major: 6, version: '6.16.1' },
  'fast-uri': { major: 3, version: '3.1.9' },
  'ip-address': { major: 10, version: '10.7.5' },
  'seroval': { line: '1.6.', version: '1.6.11' },
  '@babel/core': { major: 7, version: '7.29.7' },
  '@intlify/core-base': { line: '9.1.', version: '9.1.11' },
  '@intlify/message-resolver': { line: '9.1.', version: '9.1.11' },
  '@intlify/message-compiler': { line: '9.1.', version: '9.1.10' },
  '@intlify/runtime': { line: '9.1.', version: '9.1.10' },
  '@intlify/shared': { line: '9.1.', version: '9.1.10' },
  '@intlify/devtools-if': { line: '9.1.', version: '9.1.10' },
  '@intlify/vue-devtools': { line: '9.1.', version: '9.1.10' },
}

async function manifestAt(directory) {
  try {
    const filename = path.join(directory, 'package.json')
    return { filename, value: JSON.parse(await readFile(filename, 'utf8')) }
  }
  catch (error) {
    if (error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

// Follow real installed package edges. Resolving directly from the virtual
// store root would miss a framework still consuming its own vulnerable copy.
const consumers = [await manifestAt(root)]
const workspaceManifests = new Set([consumers[0].filename])
for (const group of ['packages', 'examples', 'apps', 'templates']) {
  const directories = await readdir(path.join(root, group), { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  })
  for (const entry of directories) {
    if (entry.isDirectory()) {
      const manifest = await manifestAt(path.join(root, group, entry.name))
      if (manifest) {
        consumers.push(manifest)
        workspaceManifests.add(manifest.filename)
      }
    }
  }
}

const packages = new Map()
const expressContexts = new Map()
const dcloudIntlifyContexts = new Map()
const visited = new Set()
for (let index = 0; index < consumers.length; index++) {
  const consumer = consumers[index]
  if (visited.has(consumer.filename)) {
    continue
  }
  visited.add(consumer.filename)
  const requireConsumer = createRequire(consumer.filename)
  const dependencies = {
    ...consumer.value.peerDependencies,
    ...consumer.value.dependencies,
    ...consumer.value.optionalDependencies,
    ...(workspaceManifests.has(consumer.filename) ? consumer.value.devDependencies : {}),
  }
  for (const dependency of Object.keys(dependencies)) {
    if (isBuiltin(dependency)) {
      continue
    }
    // Package exports may hide package.json or be import-only. Resolve the
    // physical dependency edge using the actual consumer's Node lookup paths.
    let directory
    for (const modules of requireConsumer.resolve.paths(dependency) ?? []) {
      try {
        directory = await realpath(path.join(modules, dependency))
        break
      }
      catch (error) {
        if (error.code !== 'ENOENT') {
          throw error
        }
      }
    }
    // Frameworks can supply runtime code through peers (for example Taro's
    // Solid components). Follow installed peers, while leaving absent host
    // peers outside the physical graph instead of inventing dependencies.
    if (!directory && (consumer.value.optionalDependencies?.[dependency] || consumer.value.peerDependencies?.[dependency])) {
      continue
    }
    assert.ok(directory, `Missing installed dependency for ${consumer.value.name} -> ${dependency}`)
    const target = await manifestAt(directory)
    assert.ok(target, `Missing installed manifest for ${consumer.value.name} -> ${dependency}`)
    consumers.push(target)
    if (dependency === 'express') {
      expressContexts.set(directory, { directory, requireConsumer })
      continue
    }
    if (consumer.value.name === '@dcloudio/uni-cli-shared' && dependency.startsWith('@intlify/')) {
      dcloudIntlifyContexts.set(path.dirname(consumer.filename), { directory: path.dirname(consumer.filename), version: consumer.value.version, requireConsumer })
    }
    const rule = expected[dependency]
    if (!rule) {
      continue
    }
    const major = Number(target.value.version.split('.')[0])
    const version = rule.versions?.[major] ?? (rule.major === major || target.value.version.startsWith(rule.line ?? '\0') ? rule.version : undefined)
    if (!version) {
      continue
    }
    assert.equal(target.value.version, version, `${consumer.value.name} consumes an unexpected ${dependency} version`)
    const key = `${dependency}:${directory}`
    if (!packages.has(key)) {
      packages.set(key, { name: dependency, version, directory, requireConsumer, consumers: [] })
    }
    packages.get(key).consumers.push(`${consumer.value.name}@${consumer.value.version}`)
  }
}

async function load(target) {
  const manifest = (await manifestAt(target.directory)).value
  if (manifest.type !== 'module' && target.name !== 'lodash-es' && target.name !== 'decode-uri-component') {
    return target.requireConsumer(target.name)
  }
  const exports = manifest.exports
  const main = typeof exports === 'string' ? exports : exports?.['.']?.import ?? exports?.import ?? manifest.module ?? manifest.main ?? 'index.js'
  const entry = typeof main === 'string' ? main : main.default
  return import(pathToFileURL(path.resolve(target.directory, entry)).href)
}

async function withServer(handler, callback) {
  const server = createServer(handler)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    await callback(`http://127.0.0.1:${server.address().port}`)
  }
  finally {
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

for (const target of packages.values()) {
  const loaded = await load(target)
  const api = loaded.default ?? loaded
  switch (target.name) {
    case 'node-forge': {
      assert.equal(api.md.sha256.create().update('stylex').digest().toHex(), createHash('sha256').update('stylex').digest('hex'))
      const keys = api.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 })
      const certificate = api.pki.createCertificate()
      certificate.publicKey = keys.publicKey
      certificate.serialNumber = '01'
      certificate.validity.notBefore = new Date('2026-01-01')
      certificate.validity.notAfter = new Date('2027-01-01')
      certificate.setSubject([{ name: 'commonName', value: 'localhost' }])
      certificate.setIssuer(certificate.subject.attributes)
      certificate.sign(keys.privateKey, api.md.sha256.create())
      assert.equal(api.pki.certificateFromPem(api.pki.certificateToPem(certificate)).verify(certificate), true)
      break
    }
    case 'source-map-js': {
      const generator = new api.SourceMapGenerator({ file: 'generated.js' })
      generator.addMapping({ generated: { line: 1, column: 0 }, original: { line: 3, column: 2 }, source: 'source.ts' })
      const consumer = new api.SourceMapConsumer(generator.toJSON())
      assert.deepEqual(consumer.originalPositionFor({ line: 1, column: 0 }), { source: 'source.ts', line: 3, column: 2, name: null })
      break
    }
    case 'zod': {
      const schema = api.object({ port: api.coerce.number().int().min(1), target: api.enum(['weapp', 'web']) })
      assert.deepEqual(schema.parse({ port: '5173', target: 'weapp' }), { port: 5173, target: 'weapp' })
      assert.equal(schema.safeParse({ port: 0, target: 'invalid' }).success, false)
      break
    }
    case 'undici': {
      const dispatcher = new api.MockAgent()
      try {
        dispatcher.disableNetConnect()
        dispatcher.get('https://stylex.test').intercept({ path: '/config', method: 'GET' }).reply(200, { target: 'weapp' })
        const response = await api.request('https://stylex.test/config', { dispatcher })
        assert.equal(response.statusCode, 200)
        assert.deepEqual(await response.body.json(), { target: 'weapp' })
        dispatcher.assertNoPendingInterceptors()
      }
      finally {
        await dispatcher.close()
      }
      break
    }
    case 'body-parser': {
      const middleware = api.json()
      await withServer((request, response) => middleware(request, response, (error) => {
        response.statusCode = error ? error.status : 200
        response.end(JSON.stringify(error ? { error: error.type } : request.body))
      }), async (origin) => {
        const value = await fetch(origin, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"target":"weapp"}' })
        assert.deepEqual(await value.json(), { target: 'weapp' })
        const invalid = await fetch(origin, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })
        assert.equal(invalid.status, 400)
      })
      break
    }
    case 'path-to-regexp': {
      const keys = []
      const regexp = api('/pages/:page/:id?', keys)
      assert.deepEqual(regexp.exec('/pages/detail/42').slice(1), ['detail', '42'])
      assert.deepEqual(keys.map(key => key.name), ['page', 'id'])
      break
    }
    case 'follow-redirects': {
      await withServer((request, response) => {
        if (request.url === '/start') {
          response.writeHead(302, { location: '/end' }).end()
        }
        else {
          response.end('redirected')
        }
      }, origin => new Promise((resolve, reject) => {
        api.http.get(`${origin}/start`, (response) => {
          let body = ''
          response.setEncoding('utf8')
          response.on('data', chunk => body += chunk)
          response.on('error', reject)
          response.on('end', () => {
            try {
              assert.equal(response.statusCode, 200)
              assert.equal(body, 'redirected')
              resolve()
            }
            catch (error) {
              reject(error)
            }
          })
        }).on('error', reject)
      }))
      break
    }
    case 'joi': {
      const schema = api.object({ target: api.string().valid('weapp', 'web').required(), count: api.number().integer().min(1) })
      assert.deepEqual(schema.validate({ target: 'weapp', count: '10' }).value, { target: 'weapp', count: 10 })
      assert.ok(schema.validate({ target: 'other' }).error)
      break
    }
    case 'lodash':
    case 'lodash-es': {
      assert.deepEqual(api.merge({}, { tokens: { color: 'red' } }, { tokens: { padding: 16 } }), { tokens: { color: 'red', padding: 16 } })
      assert.deepEqual(api.uniq(['app', 'page', 'app']), ['app', 'page'])
      assert.equal(api.get({ route: { path: '/index' } }, 'route.path'), '/index')
      break
    }
    case 'decode-uri-component': {
      assert.equal(api('%E4%BD%A0%E5%A5%BD'), '你好')
      assert.equal(api('plain%20value'), 'plain value')
      break
    }
    case 'ws': {
      const server = new api.WebSocketServer({ host: '127.0.0.1', port: 0 })
      let client
      try {
        await once(server, 'listening')
        server.on('connection', socket => socket.on('message', data => socket.send(data)))
        client = new api.WebSocket(`ws://127.0.0.1:${server.address().port}`)
        await once(client, 'open')
        const received = once(client, 'message')
        client.send('stylex-roundtrip')
        assert.equal((await received)[0].toString(), 'stylex-roundtrip')
        client.close()
        await once(client, 'close')
      }
      finally {
        client?.terminate()
        for (const socket of server.clients) {
          socket.terminate()
        }
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      }
      break
    }
    case 'js-yaml': {
      assert.deepEqual(api.load(api.dump({ target: 'weapp', tokens: [16, 'red'] })), { target: 'weapp', tokens: [16, 'red'] })
      break
    }
    case 'glob': {
      const files = api.globSync('scripts/*overrides.mjs', { cwd: root })
      assert.ok(files.includes('scripts/test-security-overrides.mjs'))
      assert.ok(files.includes('scripts/verify-dependency-overrides.mjs'))
      const manifests = await api.glob('packages/*/package.json', { cwd: root, ignore: ['packages/core/**'] })
      assert.ok(manifests.includes('packages/compiler/package.json'))
      assert.ok(!manifests.includes('packages/core/package.json'))
      break
    }
    case 'mkdirp': {
      const artifacts = path.join(root, 'artifacts/dependency-upgrade')
      await mkdir(artifacts, { recursive: true })
      const temporary = await mkdtemp(path.join(artifacts, 'mkdirp-api-'))
      try {
        const synchronous = path.join(temporary, 'sync/nested')
        api.sync(synchronous)
        assert.equal((await stat(synchronous)).isDirectory(), true)
        const asynchronous = path.join(temporary, 'async/nested')
        await new Promise((resolve, reject) => api(asynchronous, error => error ? reject(error) : resolve()))
        assert.equal((await stat(asynchronous)).isDirectory(), true)
        const cli = path.join(temporary, 'cli/nested')
        await run(process.execPath, [path.join(target.directory, 'bin/cmd.js'), '-m0750', cli], { timeout: 10000 })
        assert.equal((await stat(cli)).mode & 0o777, 0o750 & ~process.umask())
        const help = await run(process.execPath, [path.join(target.directory, 'bin/cmd.js'), '--help'], { timeout: 10000 })
        assert.match(help.stdout, /mkdirp/)
      }
      finally {
        await rm(temporary, { recursive: true, force: true })
      }
      break
    }
    case 'debug': {
      const previous = api.disable()
      try {
        const messages = []
        api.enable('stylex:security:*,-stylex:security:excluded')
        const debug = api('stylex:security:consumer')
        debug.log = (...args) => messages.push(args)
        debug('target=%s count=%d', 'weapp', 2)
        assert.equal(debug.enabled, true)
        assert.equal(api('stylex:security:excluded').enabled, false)
        assert.equal(messages.length, 1)
        assert.ok(messages[0].some(value => String(value).includes('weapp')))
        assert.equal(debug.extend('child').namespace, 'stylex:security:consumer:child')
      }
      finally {
        api.enable(previous)
      }
      break
    }
    case 'postcss-selector-parser': {
      const source = '.card\\:active[data-theme="dark"] > view:nth-child(2n+1)'
      const ast = api().astSync(source)
      const classes = []
      ast.walkClasses(node => classes.push(node.value))
      assert.deepEqual(classes, ['card:active'])
      assert.equal(ast.toString(), source)
      const transformed = api(selectors => selectors.walkClasses(node => node.value = 'renamed')).processSync(source)
      assert.match(transformed, /^\.renamed\[data-theme="dark"\]/)
      break
    }
    case 'qs': {
      const value = { theme: { color: 'blue' }, routes: ['home', 'detail'] }
      assert.deepEqual(api.parse(api.stringify(value)), value)
      assert.deepEqual(api.parse('__proto__[polluted]=yes&constructor[prototype][polluted]=yes'), {})
      assert.equal({}.polluted, undefined)
      assert.deepEqual(api.parse('a=1&a=2', { duplicates: 'first' }), { a: '1' })
      break
    }
    case 'fast-uri': {
      const parsed = api.parse('https://example.test:8443/pages/detail?theme=dark#content')
      assert.equal(parsed.scheme, 'https')
      assert.equal(parsed.host, 'example.test')
      assert.equal(parsed.path, '/pages/detail')
      assert.equal(api.resolve('https://example.test/pages/home', '../settings'), 'https://example.test/settings')
      const Ajv = target.requireConsumer('ajv')
      const ajv = new Ajv()
      ajv.addSchema({ $id: 'https://stylex.test/config.json', type: 'object', properties: { target: { enum: ['weapp', 'web'] } }, required: ['target'] })
      const validate = ajv.compile({ $ref: 'https://stylex.test/config.json' })
      assert.equal(validate({ target: 'weapp' }), true)
      assert.equal(validate({ target: 'other' }), false)
      break
    }
    case 'ip-address': {
      assert.equal(new api.Address4('127.0.0.1').correctForm(), '127.0.0.1')
      assert.equal(api.Address4.isValid('999.1.1.1'), false)
      const address = new api.Address6('2001:0db8:0000:0000:0000:0000:0000:0001')
      assert.equal(address.correctForm(), '2001:db8::1')
      assert.equal(address.isInSubnet(new api.Address6('2001:db8::/32')), true)
      assert.equal(api.Address6.isValid('2001:::1'), false)
      break
    }
    case 'seroval': {
      const source = { theme: 'dark', date: new Date('2026-11-03T00:00:00Z'), routes: new Map([['home', 1]]) }
      source.self = source
      const result = runInNewContext(api.serialize(source), {}, { timeout: 1000 })
      assert.equal(result.theme, 'dark')
      assert.equal(result.date.toISOString(), source.date.toISOString())
      assert.equal(result.routes.get('home'), 1)
      assert.equal(result.self, result)
      break
    }
    case '@babel/core': {
      const result = api.transformSync('export const square = (value) => value * value', { filename: 'security-consumer.js', configFile: false, babelrc: false, sourceMaps: true })
      assert.match(result.code, /export const square/)
      assert.equal(result.map.sources[0], 'security-consumer.js')
      const ast = api.parseSync('const identity = <T>(value: T): T => value', { filename: 'security-consumer.ts', configFile: false, babelrc: false, parserOpts: { plugins: ['typescript'] } })
      assert.equal(ast.program.body[0].declarations[0].init.type, 'ArrowFunctionExpression')
      break
    }
    case '@intlify/core-base': {
      const context = api.createCoreContext({ locale: 'en', fallbackLocale: 'en', messageCompiler: api.compileToFunction, messages: { en: { greeting: 'Hello {name}', linked: '@:greeting', count: 'no items | one item | {count} items' } } })
      assert.equal(api.translate(context, 'greeting', { name: 'weapp' }), 'Hello weapp')
      assert.equal(api.translate(context, 'linked', { name: 'weapp' }), 'Hello weapp')
      assert.equal(api.translate(context, 'count', 2), '2 items')
      assert.equal(api.resolveValue({ theme: { color: 'blue' } }, 'theme.color'), 'blue')
      assert.equal(api.handleFlatJson({ 'theme.color': 'blue' }).theme.color, 'blue')
      break
    }
    case '@intlify/message-resolver': {
      assert.equal(api.resolveValue({ routes: [{ title: 'Home' }] }, 'routes[0].title'), 'Home')
      assert.equal(api.resolveValue({}, '__proto__.polluted'), null)
      break
    }
    case '@intlify/message-compiler': {
      const result = api.baseCompile('Hello {name}')
      assert.match(result.code, /name/)
      assert.equal(result.ast.body.items.length, 2)
      break
    }
    case '@intlify/runtime': {
      const context = api.createMessageContext({ locale: 'en', named: { name: 'weapp' }, list: ['Home'] })
      assert.equal(context.named('name'), 'weapp')
      assert.equal(context.list(0), 'Home')
      assert.equal(context.normalize(['Hello ', context.interpolate(context.named('name'))]), 'Hello weapp')
      break
    }
    case '@intlify/shared': {
      assert.equal(api.isPlainObject({ theme: 'dark' }), true)
      assert.equal(api.isPlainObject([]), false)
      assert.equal(api.format('Hello {0}', 'weapp'), 'Hello weapp')
      break
    }
    case '@intlify/devtools-if': {
      assert.equal(api.IntlifyDevToolsHooks.FunctionTranslate, 'function:translate')
      break
    }
    case '@intlify/vue-devtools': {
      assert.equal(typeof api.VueDevToolsLabels['vue-i18n-timeline'], 'string')
      assert.equal(typeof api.VueDevToolsTimelineColors['vue-i18n-timeline'], 'number')
      break
    }
    default:
      assert.fail(`No API coverage for ${target.name}`)
  }
}

const dcloudIntlifyReports = []
for (const context of dcloudIntlifyContexts.values()) {
  const source = await readFile(path.join(context.directory, 'lib/vue-i18n/dist/vue-i18n.runtime.esm-bundler.js'), 'utf8')
  const imports = [...source.matchAll(/import \{([^}]+)\} from '(@intlify\/[^']+)'/g)]
  assert.ok(imports.length >= 3, 'DCloud legacy Vue I18n consumer imports were not inspected')
  const required = []
  for (const [, members, name] of imports) {
    const api = context.requireConsumer(name)
    const names = members.split(',').map(value => value.trim().split(/\s+as\s+/)[0])
    for (const member of names) {
      assert.notEqual(api[member], undefined, `DCloud ${context.version} legacy Vue I18n lost ${name}.${member}`)
    }
    required.push({ name, members: names })
  }
  dcloudIntlifyReports.push({ hostVersion: context.version, consumer: 'uni-cli-shared/lib/vue-i18n/dist/vue-i18n.runtime.esm-bundler.js', required })
}

for (const context of expressContexts.values()) {
  const express = context.requireConsumer('express')
  const app = express()
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  app.post('/pages/:page/:id?', (request, response) => response.json({ params: request.params, body: request.body }))
  await withServer(app, async (origin) => {
    const json = await fetch(`${origin}/pages/detail/42`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"active":true}' })
    assert.deepEqual(await json.json(), { params: { page: 'detail', id: '42' }, body: { active: true } })
    const form = await fetch(`${origin}/pages/settings`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'theme[color]=blue' })
    assert.deepEqual(await form.json(), { params: { page: 'settings' }, body: { theme: { color: 'blue' } } })
  })
}
for (const name of Object.keys(expected)) {
  assert.ok([...packages.values()].some(value => value.name === name), `No real installed consumer covered ${name}`)
}
for (const major of [6, 7, 8]) {
  assert.ok([...packages.values()].some(value => value.name === 'undici' && value.version.startsWith(`${major}.`)), `Undici ${major} consumer was not covered`)
}
assert.ok(expressContexts.size > 0, 'No real Express framework context was covered')
assert.ok(dcloudIntlifyContexts.size > 0, 'No real DCloud legacy Intlify consumer was covered')
const output = path.join(root, 'artifacts/dependency-upgrade/security-override-apis.json')
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify({ schemaVersion: 1, node: process.version, platform: process.platform, passed: true, packages: [...packages.values()].map(({ name, version, consumers }) => ({ name, version, consumers: [...new Set(consumers)].sort() })), expressFrameworkContexts: expressContexts.size, dcloudIntlifyContexts: dcloudIntlifyReports }, null, 2)}\n`)
console.log(`Security override APIs passed for ${packages.size} installed copies, ${Object.keys(expected).length} packages, three Undici majors and ${expressContexts.size} Express framework contexts.`)
