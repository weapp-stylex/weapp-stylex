import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const compilerOptions = { backend: process.env.WEAPP_STYLEX_BACKEND === 'auto' ? 'auto' : 'babel' }
const root = fileURLToPath(new URL('..', import.meta.url))
const adapterRequire = createRequire(
  new URL('../packages/weapp-vite/package.json', import.meta.url),
)
const taroRequire = createRequire(
  new URL('../packages/taro/package.json', import.meta.url),
)
const { createVitePlugins, StylexSession } = taroRequire(
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
const { build } = await import(pathToFileURL(weappRequire.resolve('vite')))
const webpack = taroRequire('webpack')
const { StylexWebpackPlugin }
  = await import('../packages/taro/dist/webpack.mjs')
const artifacts = path.join(root, 'artifacts')
await mkdir(artifacts, { recursive: true })
const temporary = await mkdtemp(path.join(artifacts, 'integration-'))
const core = path.join(root, 'packages/core/src/index.ts')
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
}

async function nativeBuild() {
  const cwd = path.join(temporary, 'native')
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
  await writeFile(
    path.join(cwd, 'src/app.json'),
    '{"pages":["pages/index/index"]}',
  )
  await writeFile(path.join(cwd, 'src/app.ts'), 'App({})')
  await writeFile(path.join(cwd, 'src/pages/index/index.json'), '{}')
  await writeFile(
    path.join(cwd, 'src/pages/index/index.wxml'),
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
  await writeFile(
    path.join(cwd, 'src/components/card/index.ts'),
    'import * as stylex from \'@weapp-stylex/core\';import {styles} from \'@fixtures/styles\';Component({data:{sx:stylex.attrs(styles.root).class}})',
  )
  await writeFile(
    path.join(cwd, 'src/components/card/index.json'),
    '{"component":true,"options":{"styleIsolation":"isolated"}}',
  )
  await writeFile(
    path.join(cwd, 'src/components/card/index.wxml'),
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
    const sx=createStylex(${JSON.stringify(compilerOptions)});export default {plugins:sx.vitePlugins,resolve:{alias:{'@weapp-stylex/core':${JSON.stringify(core)},'@styles':${JSON.stringify(path.join(cwd, 'shared'))}}},weapp:{srcRoot:'src',compilerPlugins:[sx.compilerPlugin]}};`
  await writeFile(path.join(cwd, 'vite.config.mjs'), config)
  const options = { cwd, outDir: 'dist', skipNpm: true }
  await buildTestArtifact(options)
  const css = await readFile(
    path.join(cwd, 'dist/pages/index/stylex.wxss'),
    'utf8',
  )
  assert.match(css, /color:red/)
  assert.match(css, /(?:^|\n)page(?:\s*,[^{}]*)?\{[^}]*:orange/)
  assert.match(
    await readFile(path.join(cwd, 'dist/pages/index/index.wxss'), 'utf8'),
    /@import "\.\/stylex.wxss"/,
  )
  await writeFile(path.join(cwd, 'shared/styles.ts'), themedDeclaration('blue', 'ts'))
  await buildTestArtifact(options)
  const updated = await readFile(
    path.join(cwd, 'dist/pages/index/stylex.wxss'),
    'utf8',
  )
  assert.match(updated, /color:blue/)
  assert.doesNotMatch(updated, /color:red/)
  await writeFile(path.join(cwd, 'shared/tokens.stylex.ts'), tokenDeclaration('purple'))
  await buildTestArtifact(options)
  const rethemed = await readFile(path.join(cwd, 'dist/pages/index/stylex.wxss'), 'utf8')
  assert.match(rethemed, /(?:^|\n)page(?:\s*,[^{}]*)?\{[^}]*:purple/)
  assert.doesNotMatch(rethemed, /orange/)
  await writeFile(
    path.join(cwd, 'src/pages/index/index.ts'),
    'Page({data:{sx:""}})',
  )
  await writeFile(path.join(cwd, 'src/pages/index/index.json'), '{}')
  await buildTestArtifact(options)
  assert.match(
    await readFile(path.join(cwd, 'dist/pages/index/stylex.wxss'), 'utf8'),
    /color:blue/,
  )
  await writeFile(
    path.join(cwd, 'src/components/card/index.ts'),
    'Component({})',
  )
  // The native production compiler retains its file-read cache in a process.
  // A host watcher calls this public invalidation API; the repeated-build
  // harness must notify it too before rebuilding a changed component.
  invalidateFileCache(path.join(cwd, 'src/components/card/index.ts'))
  await buildTestArtifact(options)
  await assert.rejects(
    readFile(path.join(cwd, 'dist/pages/index/stylex.wxss')),
    { code: 'ENOENT' },
  )
}

async function viteWatch() {
  const cwd = path.join(temporary, 'vite')
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
  const session = new StylexSession(compilerOptions)
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
            fileName: 'app.wxss',
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
    const css = () => readFile(path.join(cwd, 'dist/stylex.wxss'), 'utf8')
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
  }
  finally {
    await watcher.close()
    assert.equal(session.modules.size, 0, 'Final watcher shutdown retained metadata')
  }
}

async function webpackCache() {
  const cwd = path.join(temporary, 'webpack')
  await mkdir(cwd)
  await writeFile(path.join(cwd, 'package.json'), '{"name":"webpack-cache-fixture","type":"module"}')
  await writeFile(path.join(cwd, 'tokens.stylex.js'), tokenDeclaration('orange'))
  await writeFile(path.join(cwd, 'shared.js'), themedDeclaration('red', 'js'))
  const entry
    = 'import * as stylex from \'@weapp-stylex/core\';import styles from \'./shared.js\';export const sx=stylex.attrs(styles.root).class;'
  await writeFile(path.join(cwd, 'entry.js'), entry)
  const makeCompiler = (stylexOptions = compilerOptions) =>
    webpack({
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
        new StylexWebpackPlugin(stylexOptions),
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
                    'app.wxss',
                    new host.webpack.sources.RawSource('.fixture{}'),
                  ),
              )
            })
          },
        },
      ],
    })
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
    const css = () => readFile(path.join(cwd, 'dist/stylex.wxss'), 'utf8')
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

    await writeFile(path.join(cwd, 'entry.js'), 'export const sx=""')
    await run()
    await assert.rejects(css(), { code: 'ENOENT' })
  }
  finally {
    await close()
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
  await nativeBuild()
  await viteWatch()
  await webpackCache()
  await webpackVueBlocks()
  process.stdout.write(
    'CJS/ESM SFC, native module graph, Vite watch and Webpack cache integration passed\n',
  )
}
finally {
  await rm(temporary, { recursive: true, force: true })
}

await import('./test-package.mjs')
