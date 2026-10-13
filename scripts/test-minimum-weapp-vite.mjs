import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { waitForWatchedSources } from './watcher-ready.mjs'

const run = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const backend = process.env.WEAPP_STYLEX_BACKEND === 'auto' ? 'auto' : 'babel'
const minimumHost = '7.4.0'
const targets = [
  { target: 'weapp', template: 'wxml', style: 'wxss' },
  { target: 'alipay', template: 'axml', style: 'acss' },
  { target: 'tt', template: 'ttml', style: 'ttss' },
  { target: 'web' },
]
const tokenSource = color => `import * as stylex from '@weapp-stylex/core';export const tokens=stylex.defineVars({accent:'${color}'})`
const styleSource = `import * as stylex from '@weapp-stylex/core';import {tokens} from './tokens.stylex';
export const styles=stylex.create({root:{color:'red',backgroundColor:tokens.accent,padding:16,margin:'16rpx'}});
export const dark=stylex.createTheme(tokens,{accent:'black'});`

async function fixture(directory, kind, profile) {
  const cwd = path.join(directory, `${kind}-${profile.target}`)
  const page = path.join(cwd, 'src/pages/index')
  const card = path.join(cwd, 'src/components/card')
  await Promise.all([mkdir(page, { recursive: true }), mkdir(card, { recursive: true })])
  const files = {
    'package.json': JSON.stringify({ name: `minimum-${kind}-${profile.target}`, private: true, type: 'module', ...(kind === 'wevu' ? { dependencies: { wevu: minimumHost } } : {}) }),
    'project.config.json': '{"appid":"touristappid","miniprogramRoot":"dist"}',
    'src/app.json': '{"pages":["pages/index/index"]}',
    'src/app.ts': 'App({})',
    'index.html': '<!doctype html><html><head><meta charset="UTF-8"><title>Minimum host</title></head><body><div id="app"></div><script type="module" src="/@weapp-vite/web/entry"></script></body></html>',
    'src/tokens.stylex.ts': tokenSource('orange'),
    'src/styles.ts': styleSource,
    'src/plain.ts': `import * as stylex from '@weapp-stylex/core';export const plain=stylex.create({root:{borderRadius:6}})`,
    'vite.config.mjs': `import {createStylex} from '@weapp-stylex/weapp-vite';
const sx=createStylex({backend:${JSON.stringify(backend)}});
export default {base:'/minimum/',logLevel:'error',plugins:sx.vitePlugins,
server:{host:'127.0.0.1',port:0,watch:{useFsEvents:false,awaitWriteFinish:{stabilityThreshold:50,pollInterval:10}}},
weapp:{platform:${JSON.stringify(profile.target === 'web' ? 'weapp' : profile.target)},srcRoot:'src',compilerPlugins:[sx.compilerPlugin]}};`,
  }
  if (profile.target === 'alipay') {
    files['mini.project.json'] = '{"format":2,"compileType":"mini","miniprogramRoot":"dist","compileOptions":{"component2":true}}'
  }
  if (kind === 'native') {
    files['src/pages/index/index.json'] = '{"usingComponents":{"card":"../../components/card/index"}}'
    files[`src/pages/index/index.${profile.template ?? 'wxml'}`] = '<view class="{{sx.class}}" style="{{sx.style}}">minimum native</view><card />'
    files['src/pages/index/index.ts'] = `import * as stylex from '@weapp-stylex/core';import {styles,dark} from '../../styles';import {plain} from '../../plain';Page({data:{sx:stylex.attrs(styles.root,plain.root,dark)}})`
    files['src/components/card/index.json'] = '{"component":true}'
    files[`src/components/card/index.${profile.template ?? 'wxml'}`] = '<view class="{{sx.class}}">inherited card</view>'
    files['src/components/card/index.ts'] = `import * as stylex from '@weapp-stylex/core';import {styles} from '../../styles';Component({data:{sx:stylex.attrs(styles.root)}})`
  }
  else {
    files['src/pages/index/index.vue'] = `<script setup lang="ts">
import * as stylex from '@weapp-stylex/core'
import {computed,ref} from 'wevu'
import {styles,dark} from '../../styles'
import {plain} from '../../plain'
definePageJson({usingComponents:{card:'../../components/card/index'}})
const active=ref(false)
const inline=stylex.create({label:{fontSize:14}})
const sx=computed(()=>stylex.attrs(styles.root,plain.root,active.value&&dark))
const label=stylex.attrs(inline.label)
</script><template><view :class="sx.class" :style="sx.style" @tap="active=!active">minimum Wevu</view><view :class="label.class">inline SFC</view><card /></template>`
    files['src/components/card/index.vue'] = `<script setup lang="ts">
import * as stylex from '@weapp-stylex/core'
import {styles} from '../../styles'
defineComponentJson({component:true})
const inline=stylex.create({label:{fontWeight:700}})
const sx=stylex.attrs(styles.root,inline.label)
</script><template><view :class="sx.class" :style="sx.style">inherited card</view></template>`
  }
  await Promise.all(Object.entries(files).map(([name, content]) => writeFile(path.join(cwd, name), content)))
  return cwd
}

async function outputFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const result = await Promise.all(entries.map(async entry => entry.isDirectory()
    ? outputFiles(path.join(directory, entry.name))
    : [path.join(directory, entry.name)]))
  return result.flat()
}

function assertShadowState(state, color) {
  assert.equal(state.empty, false)
  assert.match(state.pageCss, /color:red/)
  assert.match(state.pageCss, /padding:16px/)
  assert.match(state.pageCss, /border-radius:6px/)
  assert.match(state.pageCss, /var\(--rpx\)/)
  assert.doesNotMatch(state.pageCss, /16rpx/)
  assert.match(state.pageCss, new RegExp(`:host(?:\\s*,[^{}]*)?\\{[^}]*:${color}`))
  assert.doesNotMatch(state.componentCss, new RegExp(`:host(?:\\s*,[^{}]*)?\\{[^}]*:${color}`))
  assert.match(state.componentCss, /:black/)
  assert.match(state.componentCss, /background-color:var\(/)
}

async function development(cwd, createCompilerContext, createServer) {
  let context
  let server
  try {
    context = await createCompilerContext({ cwd, isDev: true, mode: 'development', cliPlatform: 'web', preloadAppEntry: false, syncAutoImportSupportFiles: false })
    const config = context.configService.mergeWeb()
    assert.ok(config, 'Minimum host omitted its Web development configuration')
    let ready
    server = await createServer({
      ...config,
      optimizeDeps: { noDiscovery: true, include: [] },
      plugins: [...config.plugins, {
        name: 'minimum-host:watch-ready',
        configureServer({ watcher }) {
          ready = waitForWatchedSources(watcher, path.join(cwd, 'src'), ['styles.ts', 'tokens.stylex.ts'])
          void ready.catch(() => {})
        },
      }],
    })
    await ready
    await server.listen()
    const address = server.httpServer.address()
    const origin = `http://127.0.0.1:${address.port}`
    const request = async (url) => {
      const response = await fetch(new URL(url, origin), { signal: AbortSignal.timeout(30000) })
      assert.equal(response.status, 200, `Minimum host request failed: ${url}`)
      return response.text()
    }
    // Follow the real host-generated entry and registration modules, including
    // lazy page/SFC requests. Browser interaction is covered by test:h5.
    const seen = new Set()
    const loadGraph = async (url) => {
      if (seen.has(url)) {
        return
      }
      seen.add(url)
      const code = await request(url)
      assert.doesNotMatch(code, /stylex\.create\(/, `Uncompiled StyleX in ${url}`)
      for (const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)) {
        const imported = match[1]
        if (imported.startsWith('/') && !/\/(?:node_modules|@vite)\//.test(imported)) {
          await loadGraph(imported)
        }
      }
      if (url.endsWith('/')) {
        for (const match of code.matchAll(/<script\b[^>]+\bsrc=["']([^"']+)["']/g)) {
          if (!match[1].includes('/@vite/client')) {
            await loadGraph(match[1])
          }
        }
      }
    }
    await loadGraph('/minimum/')
    const state = async () => JSON.parse(await request('/minimum/__weapp_stylex__/state?ready=1'))
    const initial = await state()
    assertShadowState(initial, 'orange')
    const virtualCss = [...seen].find(url => url.includes('virtual:weapp-stylex/web-css'))
    assert.ok(virtualCss, 'Host registration metadata omitted the StyleX shadow CSS module')
    const client = await request(virtualCss)
    assert.match(client, /vite:ws:connect/)
    assert.match(client, /location\.reload\(\)/)
    assert.match(client, /readState\(\)/)
    const tokens = path.join(cwd, 'src/tokens.stylex.ts')
    const changed = new Promise((resolve, reject) => {
      let timer
      const onChange = (id) => {
        if (id === tokens) {
          clearTimeout(timer)
          server.watcher.off('change', onChange)
          resolve()
        }
      }
      timer = setTimeout(() => {
        server.watcher.off('change', onChange)
        reject(new Error('Minimum host token watcher timed out'))
      }, 10000)
      server.watcher.on('change', onChange)
    })
    await writeFile(tokens, tokenSource('purple'))
    await changed
    // File notifications precede the host's asynchronous invalidation hook.
    await delay(20)
    const styleUrl = [...seen].find(url => /\/src\/styles\.ts(?:\?|$)/.test(url))
    assert.ok(styleUrl, 'Host module graph omitted the shared StyleX module')
    await request(styleUrl)
    const updated = await state()
    assertShadowState(updated, 'purple')
    assert.doesNotMatch(updated.pageCss, /:orange/)
    assert.ok(updated.revision > initial.revision)
    assert.notEqual(updated.hash, initial.hash)
  }
  finally {
    try {
      await server?.close()
      assert.ok(!server?.httpServer?.listening, 'Minimum host retained its owned HTTP server')
    }
    finally {
      await context?.watcherService.closeAll()
    }
  }
}

async function consumer(directory) {
  const require = createRequire(path.join(directory, 'package.json'))
  const hostManifest = require.resolve('weapp-vite/package.json')
  const hostRequire = createRequire(hostManifest)
  const adapterRoot = path.join(directory, 'node_modules/@weapp-stylex/weapp-vite')
  assert.equal(require('weapp-vite/package.json').version, minimumHost)
  assert.equal(JSON.parse(await readFile(path.join(directory, 'node_modules/wevu/package.json'), 'utf8')).version, minimumHost)
  assert.ok(!(await realpath(adapterRoot)).startsWith(path.join(root, 'packages')), 'Minimum host test used a workspace adapter instead of a tarball')
  const adapterManifest = JSON.parse(await readFile(path.join(adapterRoot, 'package.json'), 'utf8'))
  assert.equal(adapterManifest.peerDependencies['weapp-vite'], '>=7.4.0 <8')
  assert.match(hostRequire('@babel/core').version, /^8\./)
  const compilerRequire = createRequire(await realpath(path.join(directory, 'node_modules/@weapp-stylex/compiler/package.json')))
  assert.match(compilerRequire('@babel/core').version, /^7\./)
  const adapterRequire = createRequire(await realpath(path.join(adapterRoot, 'package.json')))
  assert.equal(await realpath(adapterRequire.resolve('@weapp-stylex/compiler')), await realpath(require.resolve('@weapp-stylex/compiler')), 'Adapter resolved a registry compiler instead of the packed compiler')
  const host = JSON.parse(await readFile(hostManifest, 'utf8'))
  const { createCompilerContext } = await import(pathToFileURL(path.resolve(path.dirname(hostManifest), host.exports['.'].import)))
  const { buildTestArtifact } = await import(pathToFileURL(path.resolve(path.dirname(hostManifest), host.exports['./test'].import)))
  const { build, createServer } = await import(pathToFileURL(hostRequire.resolve('vite')))
  await writeFile(path.join(directory, 'consumer-types.mts'), `import {createStylex, type StylexTarget} from '@weapp-stylex/weapp-vite';
import {defineConfig} from 'weapp-vite/config';
const sx=createStylex({backend:'auto'});
export const target:StylexTarget='alipay';
export default defineConfig({plugins:sx.vitePlugins,weapp:{platform:target,compilerPlugins:[sx.compilerPlugin]}});`)
  await run(process.execPath, [hostRequire.resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', 'true', '--module', 'NodeNext', '--target', 'ES2022', 'consumer-types.mts'], { cwd: directory, maxBuffer: 2 * 1024 * 1024 })
  process.stdout.write(`Packed minimum host ${minimumHost}: public adapter/host configuration types passed\n`)
  for (const kind of ['native', 'wevu']) {
    for (const profile of targets) {
      const cwd = await fixture(directory, kind, profile)
      if (profile.target === 'web') {
        let context
        try {
          context = await createCompilerContext({ cwd, isDev: false, mode: 'production', cliPlatform: 'web', preloadAppEntry: false, syncAutoImportSupportFiles: false })
          const config = context.configService.mergeWeb()
          assert.ok(config, 'Minimum host omitted its Web build configuration')
          await build(config)
          const files = await outputFiles(path.join(cwd, 'dist'))
          const scripts = await Promise.all(files.filter(file => /\.[cm]?js$/.test(file)).map(file => readFile(file, 'utf8')))
          const code = scripts.join('\n')
          assert.match(code, /color:red/)
          assert.match(code, /padding:16px/)
          assert.match(code, /border-radius:6px/)
          assert.match(code, /var\(--rpx\)/)
          assert.doesNotMatch(code, /__WEAPP_STYLEX_(?:PAGE|COMPONENT)_CSS|stylex\.create\(/)
          if (kind === 'wevu') {
            assert.match(code, /font-size:14px/)
            assert.match(code, /font-weight:700/)
          }
        }
        finally {
          await context?.watcherService.closeAll()
        }
        await development(cwd, createCompilerContext, createServer)
      }
      else {
        await buildTestArtifact({ cwd, outDir: 'dist', skipNpm: true })
        const css = await readFile(path.join(cwd, `dist/pages/index/stylex.${profile.style}`), 'utf8')
        assert.match(css, /color:red/)
        assert.match(css, /padding:16px/)
        assert.match(css, /border-radius:6px/)
        assert.match(css, /margin:16rpx/)
        assert.match(css, /page(?:\s*,[^{}]*)?\{[^}]*:orange/)
        assert.doesNotMatch(css, /:root\{/)
        assert.match(await readFile(path.join(cwd, `dist/pages/index/index.${profile.style}`), 'utf8'), new RegExp(`@import "\\./stylex\\.${profile.style}"`))
        assert.match(await readFile(path.join(cwd, `dist/components/card/index.${profile.style}`), 'utf8'), new RegExp(`@import "\\./stylex\\.${profile.style}"`))
        assert.ok((await readFile(path.join(cwd, `dist/pages/index/index.${profile.template}`), 'utf8')).includes(`minimum ${kind === 'native' ? 'native' : 'Wevu'}`))
        if (kind === 'wevu') {
          assert.match(css, /font-size:14px/)
          assert.match(css, /font-weight:700/)
        }
      }
      process.stdout.write(`Packed minimum host ${minimumHost}: ${kind}/${profile.target} (${backend}) passed\n`)
    }
  }
}

if (process.argv[2] === '--consumer') {
  await consumer(path.resolve(process.argv[3]))
}
else {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'weapp-stylex-minimum-host-')))
  try {
    const packs = path.join(directory, 'packs')
    await mkdir(packs)
    const packages = ['core', 'compiler', 'weapp-vite']
    for (const name of packages) {
      await run('corepack', ['pnpm', 'pack', '--pack-destination', packs], { cwd: path.join(root, 'packages', name) })
    }
    const tarballs = (await readdir(packs)).filter(file => file.endsWith('.tgz'))
    assert.equal(tarballs.length, packages.length)
    const dependencies = Object.fromEntries(await Promise.all(packages.map(async (name) => {
      const manifest = JSON.parse(await readFile(path.join(root, 'packages', name, 'package.json'), 'utf8'))
      const basename = manifest.name.replace(/^@/, '').replace('/', '-')
      const archive = tarballs.find(file => file.startsWith(`${basename}-`))
      assert.ok(archive, `Missing packed ${manifest.name}`)
      return [manifest.name, `file:./packs/${archive}`]
    })))
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({
      name: 'packed-minimum-weapp-vite-consumer',
      private: true,
      type: 'module',
      packageManager: manifest.packageManager,
      dependencies: { ...dependencies, 'weapp-vite': minimumHost, 'wevu': minimumHost },
    }))
    // Match the workspace's audited host-only fixes. Never apply Babel 8 or
    // Vite 8 globally to the StyleX compiler or other framework adapters.
    const packedOverrides = Object.entries(dependencies).map(([name, archive]) => `  '${name}': '${archive}'`).join('\n')
    await writeFile(path.join(directory, 'pnpm-workspace.yaml'), `packages: ['.']\npackageExtensions:\n  weapp-vite@7.4.0:\n    dependencies:\n      '@babel/core': '^8.0.7'\noverrides:\n${packedOverrides}\n  'weapp-vite>vite': '8.3.4'\n`)
    await run('corepack', ['pnpm', 'install', '--ignore-scripts', '--registry=https://registry.npmjs.org'], { cwd: directory, timeout: 300000, maxBuffer: 4 * 1024 * 1024 })
    const { stdout, stderr } = await run(process.execPath, [fileURLToPath(import.meta.url), '--consumer', directory], { cwd: directory, timeout: 300000, maxBuffer: 8 * 1024 * 1024 })
    process.stdout.write(stdout)
    process.stderr.write(stderr)
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}
