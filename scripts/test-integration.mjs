import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const compilerOptions = { backend: process.env.WEAPP_STYLEX_BACKEND === 'auto' ? 'auto' : 'babel' }
const root = fileURLToPath(new URL('..', import.meta.url))
const adapterRequire = createRequire(
  new URL('../packages/weapp-vite/package.json', import.meta.url),
)
const taroRequire = createRequire(
  new URL('../packages/taro/package.json', import.meta.url),
)
const { createVitePlugins, createWebStylePlugins, StylexSession } = taroRequire(
  '@weapp-stylex/compiler',
)
const weappManifest = adapterRequire.resolve('weapp-vite/package.json')
const weappRequire = createRequire(weappManifest)
const { exports: entrypoints } = JSON.parse(
  await readFile(weappManifest, 'utf8'),
)
const { buildTestArtifact } = await import(
  pathToFileURL(
    path.resolve(path.dirname(weappManifest), entrypoints['./test'].import),
  ),
)
const wevuRoot = await realpath(
  path.join(path.dirname(weappManifest), '../wevu'),
)
const wevuManifest = JSON.parse(
  await readFile(path.join(wevuRoot, 'package.json'), 'utf8'),
)
const { invalidateFileCache } = await import(
  pathToFileURL(
    path.resolve(wevuRoot, wevuManifest.exports['./compiler'].import.default),
  ),
)
const { build, createServer } = await import(pathToFileURL(weappRequire.resolve('vite')))
const webpack = taroRequire('webpack')
const { StylexWebpackPlugin }
  = await import('../packages/taro/dist/webpack.mjs')
const artifacts = path.join(root, 'artifacts')
await mkdir(artifacts, { recursive: true })
const temporary = await mkdtemp(path.join(artifacts, 'integration-'))
const core = path.join(root, 'packages/core/src/index.ts')
const miniTargets = [
  { target: 'weapp', template: 'wxml', style: 'wxss' },
  { target: 'alipay', template: 'axml', style: 'acss' },
  { target: 'tt', template: 'ttml', style: 'ttss' },
]
function declaration(color) {
  return `import * as stylex from '@weapp-stylex/core';export const styles=stylex.create({root:{color:'${color}',padding:16}});export default styles;`
}
function themedDeclaration(color, extension) {
  return `import {tokens} from './tokens.stylex.${extension}';${declaration(color).replace('padding:16', 'padding:16,backgroundColor:tokens.accent')}`
}
function tokenDeclaration(color) {
  return `import * as stylex from '@weapp-stylex/core';export const tokens=stylex.defineVars({accent:'${color}'})`
}

async function compiledSfcEntrypoints() {
  const { StylexSession: EsmSession } = await import('../packages/compiler/dist/index.mjs')
  const source = `<template><view :class="sx">compiled SFC</view></template>
<script lang="ts">
import * as stylex from '@weapp-stylex/core'
export const shared = stylex.create({root:{padding:16}})
</script>
<script setup lang="ts">
import * as stylex from '@weapp-stylex/core'
const styles = stylex.create({text:{color:'red'}})
const sx = stylex.attrs(styles.text).class
</script>
<style>.local { opacity: 0.5 }</style>`
  const filename = path.join(temporary, 'compiled-entrypoints.vue')
  const host = { resolve: async () => undefined, addWatchFile() {} }
  const sessions = [new StylexSession(compilerOptions), new EsmSession(compilerOptions)]
  const [cjs, esm] = await Promise.all(
    sessions.map(session => session.transform(source, filename, host)),
  )
  assert.ok(cjs && esm, 'Both published compiler entrypoints must transform SFCs')
  assert.equal(cjs.code, esm.code, 'CJS and ESM transformations must agree')
  assert.equal(cjs.map, esm.map, 'CJS and ESM sourcemaps must agree')
  assert.ok(cjs.code.includes('<template><view :class="sx">compiled SFC</view></template>'))
  assert.ok(cjs.code.includes('<style>.local { opacity: 0.5 }</style>'))
  assert.doesNotMatch(cjs.code, /stylex\.create/)
  const map = JSON.parse(cjs.map)
  assert.deepEqual(map.sources, [filename])
  assert.deepEqual(map.sourcesContent, [source])
  assert.ok(map.mappings.length > 0)
  assert.equal(sessions[0].css(), sessions[1].css())
  assert.match(sessions[0].css(), /padding:16px/)
  assert.match(sessions[0].css(), /color:red/)
  const token = path.join(temporary, 'tokens.stylex.ts')
  const tokenHost = { resolve: async () => token, addWatchFile() {} }
  const script = `import * as stylex from '@weapp-stylex/core';import {tokens} from './tokens.stylex';const styles=stylex.create({text:{color:tokens.accent}});`
  const generated = `import * as stylex from '@weapp-stylex/core';import {tokens} from './tokens.stylex';registerWebWevuComponent({setup(){const styles=stylex.create({text:{color:tokens.accent}});return {sx:stylex.attrs(styles.text)}}},{kind:'page'});`
  for (const color of ['orange', 'purple']) {
    await writeFile(token, tokenDeclaration(color))
    const outputs = []
    for (const session of sessions) {
      session.change(token)
      await session.transform(`<script setup lang="ts">${script}</script><template><view /></template>`, filename, tokenHost)
      outputs.push(await session.transformCompiledSfcScript(generated, `${filename}?weapp-web-component`, tokenHost))
      assert.deepEqual([...session.modules.keys()], [filename], 'Generated SFC rules must keep the canonical source owner')
      assert.match(session.css(), new RegExp(`:${color}`))
      if (color === 'purple') {
        assert.doesNotMatch(session.css(), /:orange/)
      }
      assert.equal(session.getStats().swcTransforms, 0, 'SFC completion must retain the Babel binding guard')
    }
    assert.equal(outputs[0].code, outputs[1].code)
    assert.doesNotMatch(outputs[0].code, /stylex\.create/)
    assert.deepEqual(JSON.parse(outputs[0].map).sources, [filename])
    assert.equal(sessions[0].css(), sessions[1].css())
  }
  for (const session of sessions) {
    await session.transform('<script setup>const sx="local"</script><template><view /></template>', filename, tokenHost)
    await session.transformCompiledSfcScript('registerWebWevuComponent({setup(){return {sx:"local"}}},{kind:"page"});', filename, tokenHost)
    assert.equal(session.css(), '', 'Removing the last inline rule must clear generated-SFC metadata too')
  }
  process.stdout.write('CJS/ESM cached SFC completion: canonical ownership, token updates, Babel guard and final rule cleanup passed\n')
}

async function nativeBuild({ target, template, style }) {
  const cwd = path.join(temporary, `native-${target}`)
  await mkdir(path.join(cwd, 'src/pages/index'), { recursive: true })
  await mkdir(path.join(cwd, 'shared'), { recursive: true })
  await writeFile(
    path.join(cwd, 'package.json'),
    '{"name":"native-integration","type":"module"}',
  )
  await writeFile(
    path.join(cwd, 'project.config.json'),
    '{"appid":"touristappid","miniprogramRoot":"dist"}',
  )
  if (target === 'alipay') {
    await writeFile(path.join(cwd, 'mini.project.json'), '{"format":2,"compileType":"mini","miniprogramRoot":"dist","compileOptions":{"component2":true}}')
  }
  await writeFile(
    path.join(cwd, 'src/app.json'),
    '{"pages":["pages/index/index"]}',
  )
  await writeFile(path.join(cwd, 'src/app.ts'), 'App({})')
  await writeFile(path.join(cwd, 'src/pages/index/index.json'), '{}')
  await writeFile(
    path.join(cwd, `src/pages/index/index.${template}`),
    '<view class="{{sx}}">shared fixture</view><card />',
  )
  await writeFile(path.join(cwd, 'shared/tokens.stylex.ts'), tokenDeclaration('orange'))
  await writeFile(path.join(cwd, 'shared/styles.ts'), themedDeclaration('red', 'ts'))
  await writeFile(
    path.join(cwd, 'shared/index.ts'),
    'export {default,styles} from \'./styles\'',
  )
  await writeFile(
    path.join(cwd, 'shared/package.json'),
    JSON.stringify({
      name: '@fixtures/styles',
      type: 'module',
      exports: './index.ts',
    }),
  )
  await mkdir(path.join(cwd, 'node_modules/@fixtures'), { recursive: true })
  await symlink(
    path.join(cwd, 'shared'),
    path.join(cwd, 'node_modules/@fixtures/styles'),
    'junction',
  )
  await mkdir(path.join(cwd, 'src/components/card'), { recursive: true })
  const componentConsumer = 'import * as stylex from \'@weapp-stylex/core\';import {styles} from \'@fixtures/styles\';Component({data:{sx:stylex.attrs(styles.root).class}})'
  await writeFile(
    path.join(cwd, 'src/components/card/index.ts'),
    componentConsumer,
  )
  await writeFile(
    path.join(cwd, 'src/components/card/index.json'),
    '{"component":true,"options":{"styleIsolation":"isolated"}}',
  )
  await writeFile(
    path.join(cwd, `src/components/card/index.${template}`),
    '<view class="{{sx}}">workspace consumer</view>',
  )
  await writeFile(
    path.join(cwd, 'src/pages/index/index.json'),
    '{"usingComponents":{"card":"../../components/card/index"}}',
  )
  const consumer
    = 'import * as stylex from \'@weapp-stylex/core\';import styles from \'@styles/index\';Page({data:{sx:stylex.attrs(styles.root).class}})'
  await writeFile(path.join(cwd, 'src/pages/index/index.ts'), consumer)
  const config = `import {createStylex} from ${JSON.stringify(path.join(root, 'packages/weapp-vite/dist/index.js'))};
    const sx=createStylex(${JSON.stringify(compilerOptions)});export default {plugins:sx.vitePlugins,resolve:{alias:{'@weapp-stylex/core':${JSON.stringify(core)},'@styles':${JSON.stringify(path.join(cwd, 'shared'))}}},weapp:{platform:${JSON.stringify(target)},srcRoot:'src',compilerPlugins:[sx.compilerPlugin]}};`
  await writeFile(path.join(cwd, 'vite.config.mjs'), config)
  const options = { cwd, outDir: 'dist', skipNpm: true }
  await writeFile(path.join(cwd, 'src/pages/index/index.ts'), 'Page({data:{sx:""}})')
  await writeFile(path.join(cwd, 'src/components/card/index.ts'), 'Component({data:{sx:""}})')
  await buildTestArtifact(options)
  await assert.rejects(readFile(path.join(cwd, `dist/pages/index/stylex.${style}`)), { code: 'ENOENT' })
  await writeFile(path.join(cwd, 'src/pages/index/index.ts'), consumer)
  await writeFile(path.join(cwd, 'src/components/card/index.ts'), componentConsumer)
  invalidateFileCache(path.join(cwd, 'src/components/card/index.ts'))
  await buildTestArtifact(options)
  const css = await readFile(
    path.join(cwd, `dist/pages/index/stylex.${style}`),
    'utf8',
  )
  assert.match(css, /color:red/)
  assert.match(css, /(?:^|\n)page(?:\s*,[^{}]*)?\{[^}]*:orange/)
  assert.match(
    await readFile(path.join(cwd, `dist/pages/index/index.${style}`), 'utf8'),
    new RegExp(`@import "\\./stylex\\.${style}"`),
  )
  assert.match(
    await readFile(path.join(cwd, `dist/components/card/index.${style}`), 'utf8'),
    new RegExp(`@import "\\./stylex\\.${style}"`),
  )
  assert.match(await readFile(path.join(cwd, `dist/pages/index/index.${template}`), 'utf8'), /shared fixture/)
  if (target !== 'weapp') {
    await assert.rejects(readFile(path.join(cwd, 'dist/pages/index/index.wxss')), { code: 'ENOENT' })
  }
  await writeFile(path.join(cwd, 'shared/styles.ts'), themedDeclaration('blue', 'ts'))
  await buildTestArtifact(options)
  const updated = await readFile(
    path.join(cwd, `dist/pages/index/stylex.${style}`),
    'utf8',
  )
  assert.match(updated, /color:blue/)
  assert.doesNotMatch(updated, /color:red/)
  await writeFile(path.join(cwd, 'shared/tokens.stylex.ts'), tokenDeclaration('purple'))
  await buildTestArtifact(options)
  const rethemed = await readFile(path.join(cwd, `dist/pages/index/stylex.${style}`), 'utf8')
  assert.match(rethemed, /(?:^|\n)page(?:\s*,[^{}]*)?\{[^}]*:purple/)
  assert.doesNotMatch(rethemed, /orange/)
  await writeFile(
    path.join(cwd, 'src/pages/index/index.ts'),
    'Page({data:{sx:""}})',
  )
  await buildTestArtifact(options)
  assert.match(
    await readFile(path.join(cwd, `dist/pages/index/stylex.${style}`), 'utf8'),
    /color:blue/,
  )
  await writeFile(
    path.join(cwd, 'src/components/card/index.ts'),
    'Component({})',
  )
  await writeFile(path.join(cwd, 'src/pages/index/index.json'), '{}')
  // The native production compiler retains its file-read cache in a process.
  // A host watcher calls this public invalidation API; the repeated-build
  // harness must notify it too before rebuilding a changed component.
  invalidateFileCache(path.join(cwd, 'src/components/card/index.ts'))
  await buildTestArtifact(options)
  await assert.rejects(
    readFile(path.join(cwd, `dist/pages/index/stylex.${style}`)),
    { code: 'ENOENT' },
  )
}

async function viteWatch({ target, style }) {
  const cwd = path.join(temporary, `vite-${target}`)
  await mkdir(cwd)
  const tokenSource = color =>
    `import * as stylex from '@weapp-stylex/core';export const tokens=stylex.defineVars({accent:'${color}'})`
  await writeFile(path.join(cwd, 'tokens.stylex.js'), tokenSource('orange'))
  const sharedSource = color =>
    `${declaration(
      color,
    )}import {tokens} from './tokens.stylex.js';export const themed=stylex.create({root:{backgroundColor:tokens.accent}});`
  await writeFile(path.join(cwd, 'shared.js'), sharedSource('red'))
  const entry
    = 'import * as stylex from \'@weapp-stylex/core\';import {styles,themed} from \'./shared.js\';export const sx=stylex.attrs(styles.root,themed.root).class;'
  await writeFile(path.join(cwd, 'entry.js'), entry)
  const session = new StylexSession({ ...compilerOptions, target })
  const watcher = await build({
    configFile: false,
    root: cwd,
    logLevel: 'error',
    resolve: { alias: { '@weapp-stylex/core': core } },
    plugins: [
      ...createVitePlugins(session),
      {
        name: 'wxss-fixture',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: `app.${style}`,
            source: '.fixture{}',
          })
        },
      },
    ],
    build: {
      lib: {
        entry: path.join(cwd, 'entry.js'),
        formats: ['es'],
        fileName: 'entry',
      },
      outDir: 'dist',
      emptyOutDir: false,
      watch: {},
    },
  })
  let pending
  let failure
  const rebuilt = () =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending = undefined
        reject(new Error('Vite watch rebuild timed out'))
      }, 30000)
      pending = {
        resolve: () => {
          clearTimeout(timeout)
          pending = undefined
          resolve()
        },
        reject: (error) => {
          clearTimeout(timeout)
          pending = undefined
          reject(error)
        },
      }
      if (failure) {
        pending.reject(failure)
      }
    })
  watcher.on('event', (event) => {
    if (event.code === 'ERROR') {
      failure = event.error
      pending?.reject(event.error)
    }
    if (event.code === 'END') {
      pending?.resolve()
    }
  })
  try {
    await rebuilt()
    const css = () => readFile(path.join(cwd, `dist/stylex.${style}`), 'utf8')
    assert.match(await css(), /color:red/)
    let next = rebuilt()
    await writeFile(path.join(cwd, 'entry.js'), `${entry}\n// importer edit`)
    await next
    assert.match(await css(), /color:red/)
    next = rebuilt()
    await writeFile(path.join(cwd, 'shared.js'), sharedSource('blue'))
    await next
    assert.match(await css(), /color:blue/)
    assert.doesNotMatch(await css(), /color:red/)
    assert.match(await css(), /orange/)
    next = rebuilt()
    await writeFile(path.join(cwd, 'tokens.stylex.js'), tokenSource('purple'))
    await next
    assert.match(await css(), /purple/)
    assert.doesNotMatch(await css(), /orange/)
    assert.match(await css(), /color:blue/)
    next = rebuilt()
    await writeFile(path.join(cwd, 'entry.js'), 'export const sx=""')
    await next
    await assert.rejects(css(), { code: 'ENOENT' })
    assert.equal(await readFile(path.join(cwd, `dist/app.${style}`), 'utf8'), '.fixture{}')
  }
  finally {
    await watcher.close()
    assert.equal(session.modules.size, 0, 'Final watcher shutdown retained metadata')
  }
}

async function webpackCache({ target, style }) {
  const cwd = path.join(temporary, `webpack-${target}`)
  await mkdir(cwd)
  await writeFile(path.join(cwd, 'package.json'), '{"name":"webpack-cache-fixture","type":"module"}')
  await writeFile(path.join(cwd, 'tokens.stylex.js'), tokenDeclaration('orange'))
  await writeFile(path.join(cwd, 'shared.js'), themedDeclaration('red', 'js'))
  const entry
    = 'import * as stylex from \'@weapp-stylex/core\';import styles from \'./shared.js\';export const sx=stylex.attrs(styles.root).class;'
  await writeFile(path.join(cwd, 'entry.js'), entry)
  // Webpack treats freshly written timestamps as unsafe for disk snapshots.
  // Establish stable fixture times instead of relying on compilation latency.
  const stableTime = new Date(Date.now() - 10000)
  await Promise.all(['package.json', 'tokens.stylex.js', 'shared.js', 'entry.js'].map(file => utimes(path.join(cwd, file), stableTime, stableTime)))
  let emittedStyle = style
  const makeCompiler = (stylexOptions = compilerOptions, activeTarget = target) => {
    emittedStyle = miniTargets.find(profile => profile.target === activeTarget).style
    return webpack({
      mode: 'development',
      context: cwd,
      target: 'node',
      entry: './entry.js',
      output: {
        path: path.join(cwd, 'dist'),
        filename: 'entry.cjs',
        library: { type: 'commonjs2' },
      },
      cache: { type: 'filesystem', version: 'host-v1', cacheDirectory: path.join(cwd, 'cache'), buildDependencies: { fixture: [path.join(cwd, 'package.json')] } },
      resolve: {
        alias: {
          '@weapp-stylex/core': path.join(root, 'packages/core/dist/index.js'),
        },
      },
      module: {
        rules: [
          {
            test: /\.[jt]s$/,
            enforce: 'pre',
            use: [{ loader: taroRequire.resolve('@weapp-stylex/taro/loader') }],
          },
        ],
      },
      plugins: [
        new StylexWebpackPlugin({ ...stylexOptions, target: activeTarget }),
        {
          apply(host) {
            host.hooks.thisCompilation.tap('fixture', (compilation) => {
              compilation.hooks.processAssets.tap(
                {
                  name: 'fixture',
                  stage:
                    host.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
                },
                () =>
                  compilation.emitAsset(
                    `app.${emittedStyle}`,
                    new host.webpack.sources.RawSource('.fixture{}'),
                  ),
              )
            })
          },
        },
      ],
    })
  }
  let compiler = makeCompiler()
  const close = () =>
    new Promise((resolve, reject) =>
      compiler.close(error => (error ? reject(error) : resolve())),
    )
  const run = () =>
    new Promise((resolve, reject) =>
      compiler.run((error, stats) =>
        error
          ? reject(error)
          : stats.hasErrors()
            ? reject(new Error(stats.toString({ all: false, errors: true })))
            : resolve(stats),
      ),
    )
  try {
    await run()
    const css = () => readFile(path.join(cwd, `dist/stylex.${emittedStyle}`), 'utf8')
    assert.match(await css(), /color:red/)
    assert.match(await css(), /(?:^|\n)page(?:\s*,[^{}]*)?\{[^}]*:orange/)
    await close()
    compiler = makeCompiler()
    const restored = await run()
    assert.match(await css(), /color:red/)
    assert.match(await css(), /(?:^|\n)page(?:\s*,[^{}]*)?\{[^}]*:orange/)
    const shared = [...restored.compilation.modules].find(
      module => module.resource === path.join(cwd, 'shared.js'),
    )
    assert.ok(
      shared?.buildInfo.weappStylex?.rules.length,
      'Filesystem cache lost module StyleX metadata',
    )
    assert.ok(
      !restored.compilation.builtModules.has(shared),
      'Shared module was rebuilt instead of restored from filesystem cache',
    )
    await writeFile(
      path.join(cwd, 'entry.js'),
      `${entry}\n// cached shared module`,
    )
    await run()
    assert.match(await css(), /color:red/)
    await writeFile(path.join(cwd, 'shared.js'), themedDeclaration('blue', 'js'))
    await run()
    assert.match(await css(), /color:blue/)
    assert.doesNotMatch(await css(), /color:red/)
    await writeFile(path.join(cwd, 'tokens.stylex.js'), tokenDeclaration('purple'))
    await run()
    assert.match(await css(), /(?:^|\n)page(?:\s*,[^{}]*)?\{[^}]*:purple/)
    assert.doesNotMatch(await css(), /orange/)
    await close()
    compiler = makeCompiler({ ...compilerOptions, babel: { enableMinifiedKeys: false } })
    const reconfigured = await run()
    const recompiled = [...reconfigured.compilation.modules].find(module => module.resource === path.join(cwd, 'shared.js'))
    assert.ok(reconfigured.compilation.builtModules.has(recompiled), 'Compiler options change reused stale filesystem cache')
    assert.notEqual(recompiled.buildInfo.weappStylex.fingerprint, shared.buildInfo.weappStylex.fingerprint)
    assert.match(compiler.options.cache.version, /^host-v1:weapp-stylex:/, 'StyleX replaced the host cache identity')
    assert.deepEqual(compiler.options.cache.buildDependencies.fixture, [path.join(cwd, 'package.json')])
    await close()
    compiler = makeCompiler({ backend: compilerOptions.backend === 'auto' ? 'babel' : 'auto' })
    const switched = await run()
    const switchedModule = [...switched.compilation.modules].find(module => module.resource === path.join(cwd, 'shared.js'))
    assert.ok(switched.compilation.builtModules.has(switchedModule), 'Backend switch reused stale filesystem cache')
    assert.notEqual(switchedModule.buildInfo.weappStylex.fingerprint, shared.buildInfo.weappStylex.fingerprint)

    await close()
    const otherTarget = target === 'alipay' ? 'tt' : 'alipay'
    compiler = makeCompiler(compilerOptions, otherTarget)
    const retargeted = await run()
    const retargetedModule = [...retargeted.compilation.modules].find(module => module.resource === path.join(cwd, 'shared.js'))
    assert.ok(retargeted.compilation.builtModules.has(retargetedModule), 'Target switch reused stale filesystem cache')
    assert.notEqual(retargetedModule.buildInfo.weappStylex.fingerprint, shared.buildInfo.weappStylex.fingerprint)
    assert.match(await css(), /color:blue/)
    assert.match(await readFile(path.join(cwd, `dist/app.${emittedStyle}`), 'utf8'), new RegExp(`stylex\\.${emittedStyle}`))

    await writeFile(path.join(cwd, 'entry.js'), 'export const sx=""')
    await run()
    await assert.rejects(css(), { code: 'ENOENT' })
    assert.equal(await readFile(path.join(cwd, `dist/app.${emittedStyle}`), 'utf8'), '.fixture{}')
  }
  finally {
    await close()
  }
}

async function webViteLifecycle() {
  const nodeEnv = process.env.NODE_ENV
  try {
    await runWebViteLifecycle()
  }
  finally {
    if (nodeEnv === undefined) {
      delete process.env.NODE_ENV
    }
    else {
      process.env.NODE_ENV = nodeEnv
    }
  }
}

async function runWebViteLifecycle() {
  const cwd = path.join(temporary, 'web-vite')
  await mkdir(cwd)
  await writeFile(path.join(cwd, 'package.json'), '{"name":"web-lifecycle-fixture","type":"module"}')
  await writeFile(path.join(cwd, 'index.html'), '<html><head></head><body><script type="module" src="/entry.js"></script></body></html>')
  await writeFile(path.join(cwd, 'local.css'), '.application{opacity:.5}')
  await writeFile(path.join(cwd, 'tokens.stylex.js'), tokenDeclaration('orange'))
  const entry = 'import "./local.css";import {styles} from "./shared.js";document.body.dataset.sx=JSON.stringify(styles)'
  const plainEntry = 'import "./local.css";document.body.textContent="plain"'
  const shared = color => themedDeclaration(color, 'js')
  await writeFile(path.join(cwd, 'shared.js'), shared('red'))
  await writeFile(path.join(cwd, 'entry.js'), plainEntry)
  const makePlugins = session => [
    ...createVitePlugins(session, { emitStyles: false }),
    ...createWebStylePlugins(session, { transformCss: css => css, policyKey: 'integration-browser-css' }),
  ]
  const config = {
    configFile: false,
    root: cwd,
    base: '/fixtures/app/',
    logLevel: 'error',
    resolve: { alias: { '@weapp-stylex/core': core } },
    build: { outDir: 'dist', emptyOutDir: false },
  }
  const session = new StylexSession({ ...compilerOptions, target: 'web' })
  const plugins = makePlugins(session)
  const run = () => build({ ...config, plugins })
  const cssAssets = async () => (await readdir(path.join(cwd, 'dist/assets'))).filter(file => /^stylex-.*\.css$/.test(file))
  const outputHtml = () => readFile(path.join(cwd, 'dist/index.html'), 'utf8')
  await run()
  assert.deepEqual(await cssAssets(), [], 'An initial H5 build without StyleX emitted a stylesheet')
  assert.doesNotMatch(await outputHtml(), /data-weapp-stylex/)
  const userAsset = path.join(cwd, 'dist/user-owned.css')
  await writeFile(userAsset, '.user-owned{color:rebeccapurple}')
  await writeFile(path.join(cwd, 'entry.js'), entry)
  await run()
  const [firstAsset] = await cssAssets()
  assert.ok(firstAsset)
  const firstCss = await readFile(path.join(cwd, 'dist/assets', firstAsset), 'utf8')
  assert.match(firstCss, /color:red/)
  assert.match(firstCss, /padding:16px/)
  assert.match(firstCss, /:root(?:\s*,[^{}]*)?\{[^}]*orange/)
  const html = await outputHtml()
  assert.ok(html.includes(`/fixtures/app/assets/${firstAsset}`), 'H5 CSS link ignored the configured base path')
  const links = [...html.matchAll(/<link\b[^>]*>/g)].filter(match => /\brel="stylesheet"/.test(match[0]))
  assert.ok(links[0]?.[0].includes('data-weapp-stylex'), 'H5 CSS order must precede application CSS')
  await writeFile(path.join(cwd, 'shared.js'), shared('blue'))
  await run()
  const [secondAsset] = await cssAssets()
  assert.ok(secondAsset && secondAsset !== firstAsset)
  await assert.rejects(readFile(path.join(cwd, 'dist/assets', firstAsset)), { code: 'ENOENT' })
  assert.match(await readFile(path.join(cwd, 'dist/assets', secondAsset), 'utf8'), /color:blue/)
  await writeFile(path.join(cwd, 'shared.js'), 'export const styles={} // last rule removed')
  await run()
  assert.deepEqual(await cssAssets(), [], 'Removing the last H5 rule retained its asset')
  assert.doesNotMatch(await outputHtml(), /data-weapp-stylex/)
  await writeFile(path.join(cwd, 'shared.js'), shared('red'))
  await run()
  assert.equal((await cssAssets()).length, 1)
  await writeFile(path.join(cwd, 'entry.js'), plainEntry)
  await run()
  assert.equal(await readFile(path.join(cwd, 'shared.js'), 'utf8'), shared('red'))
  assert.deepEqual(await cssAssets(), [], 'An unreachable, unchanged H5 module retained its asset')
  assert.equal(await readFile(userAsset, 'utf8'), '.user-owned{color:rebeccapurple}')
  assert.equal(session.modules.size, 0, 'Production H5 close retained metadata')

  await writeFile(path.join(cwd, 'entry.js'), entry)
  const devSession = new StylexSession({ ...compilerOptions, target: 'web' })
  const server = await createServer({
    ...config,
    plugins: makePlugins(devSession),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
  })
  try {
    await server.listen()
    const address = server.httpServer.address()
    const origin = `http://127.0.0.1:${address.port}`
    const request = async (name) => {
      const response = await fetch(`${origin}${config.base}${name}`)
      assert.equal(response.status, 200, `H5 request failed: ${name}`)
      return response.text()
    }
    assert.match(await request(''), /fixtures\/app\/@id\/virtual:weapp-stylex\/web-client/)
    await request('entry.js')
    await request('shared.js')
    await request('tokens.stylex.js')
    const state = async () => JSON.parse(await request('__weapp_stylex__/state?ready=1'))
    const initial = await state()
    assert.equal(initial.empty, false)
    assert.match(initial.css, /color:red/)
    assert.match(await request('__weapp_stylex__/styles.css'), /padding:16px/)
    const waitForChange = async (file, action) => {
      const changed = new Promise((resolve, reject) => {
        let timer
        const onChange = (changedFile) => {
          if (changedFile !== path.join(cwd, file)) {
            return
          }
          clearTimeout(timer)
          server.watcher.off('change', onChange)
          resolve()
        }
        timer = setTimeout(() => {
          server.watcher.off('change', onChange)
          reject(new Error(`H5 file change timed out: ${file}`))
        }, 10000)
        server.watcher.on('change', onChange)
      })
      await action()
      await changed
      // The watcher event precedes Vite's async invalidation hooks.
      await delay(20)
    }
    await waitForChange('shared.js', () => writeFile(path.join(cwd, 'shared.js'), shared('blue')))
    await request('shared.js')
    const updated = await state()
    assert.match(updated.css, /color:blue/)
    assert.doesNotMatch(updated.css, /color:red/)
    assert.ok(updated.revision > initial.revision)
    await waitForChange('tokens.stylex.js', () => writeFile(path.join(cwd, 'tokens.stylex.js'), tokenDeclaration('purple')))
    await request('shared.js')
    await request('tokens.stylex.js')
    assert.match((await state()).css, /purple/)
    await waitForChange('entry.js', () => writeFile(path.join(cwd, 'entry.js'), plainEntry))
    await request('entry.js')
    const removed = await state()
    assert.equal(removed.empty, true, 'Dev graph retained an unchanged module after its importer dropped it')
    assert.equal(removed.css, '')
    await waitForChange('entry.js', () => writeFile(path.join(cwd, 'entry.js'), entry))
    await request('entry.js')
    await request('shared.js')
    await request('tokens.stylex.js')
    assert.equal((await state()).empty, false)
    await waitForChange('shared.js', () => writeFile(path.join(cwd, 'shared.js'), 'export const styles={}'))
    await request('shared.js')
    assert.equal((await state()).empty, true, 'Dev retained the last removed rule')
  }
  finally {
    await server.close()
    assert.equal(devSession.modules.size, 0, 'Dev server shutdown retained metadata')
  }
}

async function webpackVueBlocks() {
  // Use the public Taro registration and real Vue-loader, including its pitcher
  // requests, rather than testing only the compiler's standalone SFC transform.
  const vueRequire = createRequire(new URL('../examples/taro-vue3/package.json', import.meta.url))
  const runnerRequire = createRequire(vueRequire.resolve('@tarojs/webpack5-runner'))
  const Chain = runnerRequire('webpack-chain')
  const { VueLoaderPlugin } = vueRequire('vue-loader')
  const { stylexTaro } = taroRequire('@weapp-stylex/taro')
  const cwd = path.join(temporary, 'webpack-vue')
  await mkdir(cwd)
  await writeFile(path.join(cwd, 'package.json'), '{"name":"webpack-vue-fixture","type":"module"}')
  await writeFile(path.join(cwd, 'shared.js'), declaration('green'))
  const sfc = color => `<script>
import * as stylex from '@weapp-stylex/core'
export const normal = stylex.create({normal:{marginTop:8}})
</script>
<script setup>
import * as stylex from '@weapp-stylex/core'
import {styles} from './shared.js'
import External from './external.vue'
const inline = stylex.create({label:{color:'${color}',fontSize:14}})
const sx = stylex.attrs(styles.root, inline.label)
</script>
<template><view :class="sx.class"><External /></view></template>
<style scoped>.local { opacity: .5 }</style>
<unhandled>this custom block is deliberately not JavaScript</unhandled>`
  const component = path.join(cwd, 'entry.vue')
  await writeFile(component, sfc('red'))
  await writeFile(path.join(cwd, 'external.vue'), '<script src="./external.js"></script><template><view :class="sx.class" /></template>')
  await writeFile(path.join(cwd, 'external.js'), `import * as stylex from '@weapp-stylex/core';const s=stylex.create({root:{opacity:0.8}});export default {setup(){return {sx:stylex.attrs(s.root)}}}`)
  const cssLoader = path.join(cwd, 'local-style-loader.cjs')
  await writeFile(cssLoader, 'module.exports=function(code){this.emitFile("local.wxss",code);return "export default {}"}')
  const makeCompiler = () => {
    const chain = new Chain()
    chain.mode('development').context(cwd).target('node').devtool('source-map')
    chain.entry('entry').add('./entry.vue')
    chain.output.path(path.join(cwd, 'dist')).filename('entry.cjs').library({ type: 'commonjs2' })
    chain.resolve.alias.set('@weapp-stylex/core', path.join(root, 'packages/core/dist/index.js'))
    chain.resolve.alias.set('vue$', vueRequire.resolve('vue'))
    chain.resolve.alias.set('vue/server-renderer', vueRequire.resolve('vue/server-renderer'))
    chain.module.rule('vue').test(/\.vue$/).use('vue-loader').loader(vueRequire.resolve('vue-loader'))
    chain.module.rule('css').test(/\.css$/).use('fixture-css').loader(cssLoader)
    chain.plugin('vue').use(VueLoaderPlugin)
    chain.cache({ type: 'filesystem', cacheDirectory: path.join(cwd, 'cache') })
    const previous = process.env.TARO_ENV
    process.env.TARO_ENV = 'weapp'
    try {
      stylexTaro({ modifyViteConfig() {}, modifyWebpackChain: register => register({ chain }) }, compilerOptions)
    }
    finally {
      if (previous === undefined) {
        delete process.env.TARO_ENV
      }
      else {
        process.env.TARO_ENV = previous
      }
    }
    return webpack(chain.toConfig())
  }
  let compiler = makeCompiler()
  const close = () => new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()))
  const run = () => new Promise((resolve, reject) => compiler.run((error, stats) => error
    ? reject(error)
    : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : resolve(stats)))
  const css = () => readFile(path.join(cwd, 'dist/stylex.wxss'), 'utf8')
  const execute = async (color) => {
    const output = path.join(cwd, 'dist/entry.cjs')
    delete taroRequire.cache[output]
    const loaded = taroRequire(output)
    // A leaked create() throws here even after minification renamed the import.
    const bindings = loaded.default.setup({}, { expose() {} })
    assert.match(bindings.sx.class, /sx\w+/)
    assert.match(bindings.External.setup().sx.class, /sx\w+/)
    assert.ok(loaded.normal.normal)
    assert.match(await css(), new RegExp(`color:${color}`))
    assert.match(await css(), /margin-top:8px/)
    assert.match(await css(), /opacity:0?\.8/)
    assert.match(loaded.default.__scopeId, /^data-v-\w+$/)
    assert.match(await readFile(path.join(cwd, 'dist/local.wxss'), 'utf8'), /\.local \{ opacity: \.5 \}/)
    return bindings.sx.class
  }
  try {
    await run()
    const original = await execute('red')
    const map = JSON.parse(await readFile(path.join(cwd, 'dist/entry.cjs.map'), 'utf8'))
    assert.ok(map.sources.some(source => source.includes('entry.vue')))
    assert.ok(map.sourcesContent.some(source => source?.includes('const sx = stylex.attrs')))
    await close()
    compiler = makeCompiler()
    const restored = await run()
    assert.equal(await execute('red'), original)
    const script = [...restored.compilation.modules].find(module => module.resource?.includes('entry.vue?vue&type=script') && module.buildInfo.weappStylex)
    assert.ok(script?.buildInfo.weappStylex.rules.length, 'Cached Vue script lost inline StyleX rules')
    assert.ok(!restored.compilation.builtModules.has(script), 'Vue script was not restored from disk cache')
    await writeFile(component, sfc('blue'))
    await run()
    assert.notEqual(await execute('blue'), original)
    assert.doesNotMatch(await css(), /color:red/)
    await writeFile(component, '<script setup>const sx={class:"plain"}</script><template><view :class="sx.class" /></template><style>.local { opacity: .5 }</style>')
    await run()
    await assert.rejects(css(), { code: 'ENOENT' })
    process.stdout.write('Real Vue-loader blocks, setup execution, external scripts, custom blocks and disk cache passed\n')
  }
  finally {
    await close()
  }
}
try {
  await compiledSfcEntrypoints()
  await webViteLifecycle()
  process.stdout.write('H5 production and serve: base paths, live styles, graph pruning, reimport and owned asset cleanup passed\n')
  for (const target of miniTargets) {
    await nativeBuild(target)
    await viteWatch(target)
    await webpackCache(target)
    process.stdout.write(`${target.target}: native companion styles, watch and cross-target filesystem cache passed\n`)
  }
  await webpackVueBlocks()
  process.stdout.write(
    'CJS/ESM SFC, WeChat/Alipay/Douyin module graphs, Vite watch, Webpack cache and H5 lifecycle integration passed\n',
  )
}
finally {
  await rm(temporary, { recursive: true, force: true })
}

await import('./test-package.mjs')
