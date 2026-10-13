import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const tooling = createRequire(new URL('../package.json', import.meta.url))
const testNode = process.env.WEAPP_STYLEX_TEST_NODE_PATH ?? process.execPath
const packageNames = ['@weapp-stylex/core', '@weapp-stylex/compiler', '@weapp-stylex/weapp-vite', '@weapp-stylex/taro', '@weapp-stylex/uni-app', 'weapp-stylex']

async function installPackages(directory, packages, { omitOptional = false } = {}) {
  const artifacts = path.join(root, 'artifacts')
  await mkdir(artifacts, { recursive: true })
  const logs = await mkdtemp(path.join(artifacts, `consumer-install-${process.versions.node}-${omitOptional ? 'omitted' : 'included'}-`))
  const started = Date.now()
  process.stdout.write(`Installing consumer dependencies; npm diagnostics: ${logs}\n`)
  // Bound registry requests below the overall installation deadline. The old
  // 120s deadline killed npm before its default 300s request timeout expired.
  const args = ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--registry=https://registry.npmjs.org', '--fetch-timeout=60000', '--fetch-retries=2', '--fetch-retry-mintimeout=10000', '--fetch-retry-maxtimeout=60000', '--timing', '--loglevel=http', `--logs-dir=${logs}`, ...(omitOptional ? ['--omit=optional'] : []), ...packages]
  try {
    const result = await run('npm', args, { cwd: directory, timeout: 300000, maxBuffer: 4 * 1024 * 1024 })
    await writeFile(path.join(logs, 'output.log'), result.stdout + result.stderr)
    process.stdout.write(`Consumer dependencies installed in ${((Date.now() - started) / 1000).toFixed(1)}s\n`)
  }
  catch (error) {
    await writeFile(path.join(logs, 'output.log'), (error.stdout ?? '') + (error.stderr ?? ''))
    const timedOut = error.killed && error.code === null
    process.stderr.write(`Consumer installation ${timedOut ? 'exceeded its 300s deadline' : 'failed'}; npm diagnostics retained in ${logs}\n`)
    throw error
  }
}

async function verifyExportTargets(packageRoot, name, value, condition = 'exports') {
  if (typeof value === 'string') {
    assert.ok(value.startsWith('./'), `${name} ${condition} must refer to a package file: ${value}`)
    const file = path.resolve(packageRoot, value)
    assert.ok(file.startsWith(`${packageRoot}${path.sep}`), `${name} ${condition} escaped its package`)
    assert.ok((await stat(file)).isFile(), `${name} ${condition} target is not a file: ${value}`)
  }
  else if (value && typeof value === 'object') {
    for (const [key, target] of Object.entries(value)) {
      await verifyExportTargets(packageRoot, name, target, `${condition}.${key}`)
    }
  }
}

async function sourceMap(packageRoot, fileName) {
  const filename = path.join(packageRoot, fileName)
  const source = await readFile(filename, 'utf8')
  const reference = source.match(/\/\/# sourceMappingURL=(\S+)/)?.[1]
  if (!reference) {
    return { source }
  }
  const mapFile = path.resolve(path.dirname(filename), reference)
  assert.ok(mapFile.startsWith(`${packageRoot}${path.sep}`), `${fileName} sourcemap escaped its package`)
  const map = JSON.parse(await readFile(mapFile, 'utf8'))
  assert.equal(map.version, 3, `${fileName} sourcemap version`)
  assert.ok(map.sources.length, `${fileName} sourcemap lost its sources`)
  for (const sourcePath of map.sources) {
    assert.ok(!path.isAbsolute(sourcePath) && !/^[a-z]:|^file:/i.test(sourcePath), `${fileName} sourcemap leaked an absolute source path`)
  }
  return { source, map }
}

const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'weapp-stylex-package-')))
try {
  const registryVersion = process.env.WEAPP_STYLEX_TEST_REGISTRY_VERSION
  // Reuse the exact tarballs in another Node runtime without repacking them.
  const prepackedDirectory = process.env.WEAPP_STYLEX_TEST_PACKS_DIR
  assert.ok(!registryVersion || !prepackedDirectory, 'Choose registry packages or prepacked tarballs, not both')
  let packages
  if (registryVersion) {
    assert.match(registryVersion, /^\d+\.\d+\.\d+$/)
    packages = [`weapp-stylex@${registryVersion}`]
  }
  else {
    const packs = prepackedDirectory ? path.resolve(prepackedDirectory) : path.join(directory, 'packs')
    if (!prepackedDirectory) {
      await mkdir(packs)
      for (const name of ['core', 'compiler', 'weapp-vite', 'taro', 'uni-app', 'weapp-stylex']) {
        await run('corepack', ['pnpm', 'pack', '--pack-destination', packs], {
          cwd: path.join(root, 'packages', name),
        })
      }
    }
    packages = (await readdir(packs)).filter(file => file.endsWith('.tgz')).map(file => path.join(packs, file))
    assert.equal(packages.length, 6)
  }
  await writeFile(path.join(directory, 'package.json'), '{"name":"packed-facade-consumer","private":true,"type":"module"}')
  await installPackages(directory, [...packages, `typescript@${tooling('typescript/package.json').version}`])
  const require = createRequire(path.join(directory, 'package.json'))
  const nodeVersion = (await run(testNode, ['-p', 'process.versions.node'], { cwd: directory })).stdout.trim()
  for (const name of packageNames) {
    const packageRoot = path.join(directory, 'node_modules', name)
    const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
    assert.equal(manifest.name, name)
    assert.ok(manifest.exports, `${name} has no public export contract`)
    await verifyExportTargets(packageRoot, name, manifest.exports)
    for (const field of ['main', 'module', 'types']) {
      if (manifest[field]) {
        await verifyExportTargets(packageRoot, name, manifest[field], field)
      }
    }
    if (!registryVersion && ['@weapp-stylex/core', '@weapp-stylex/weapp-vite'].includes(name)) {
      assert.deepEqual(manifest.exports['.'], {
        types: './dist/index.d.ts',
        import: './dist/index.js',
        default: './dist/index.js',
      }, `${name} changed its ESM export contract`)
      assert.equal(require.resolve(name), path.join(packageRoot, 'dist/index.js'))
      const js = await sourceMap(packageRoot, 'dist/index.js')
      const declarations = await sourceMap(packageRoot, 'dist/index.d.ts')
      if (name === '@weapp-stylex/core') {
        // A pure external re-export has no mappings for tsdown to emit.
        assert.match(js.source, /export \* from ["']@stylexjs\/stylex["']/)
        assert.match(declarations.source, /export \* from ["']@stylexjs\/stylex["']/)
      }
      else {
        assert.ok(js.map, 'The compiled weapp-vite adapter lost its JavaScript sourcemap')
        assert.ok(declarations.map, 'The compiled weapp-vite adapter lost its declaration map')
        assert.ok(js.map.sources.some(file => file.endsWith('/src/index.ts')))
        assert.ok(js.map.sources.some(file => file.endsWith('/src/web.ts')))
        assert.equal(js.map.sourcesContent.length, js.map.sources.length)
        assert.ok(js.map.sourcesContent.some(content => content.includes('export function createStylex')))
        for (const dependency of ['@weapp-stylex/compiler', '@babel/core', 'postcss']) {
          assert.ok(js.source.includes(`from "${dependency}"`) || js.source.includes(`from '${dependency}'`), `The adapter bundled ${dependency} instead of preserving its dependency boundary`)
        }
      }
    }
  }
  for (const host of ['weapp-vite', '@tarojs/service', 'webpack', '@dcloudio/vite-plugin-uni']) {
    assert.throws(() => require.resolve(host), { code: 'MODULE_NOT_FOUND' }, `Installing the facade unexpectedly installed ${host}`)
  }
  await writeFile(path.join(directory, 'runtime-isolation.mjs'), `
import assert from 'node:assert/strict'
import {createRequire,registerHooks} from 'node:module'
const require=createRequire(import.meta.url)
const forbidden=/^(?:@weapp-stylex\\/(?:compiler|weapp-vite|taro|uni-app)(?:\\/|$)|weapp-stylex\\/(?:compiler|weapp-vite|taro|uni-app)(?:\\/|$)|@babel\\/|@stylexswc\\/|weapp-vite(?:\\/|$)|@tarojs\\/|webpack(?:\\/|$)|@dcloudio\\/)/
const seen=[]
const hook=registerHooks({resolve(specifier,context,nextResolve){
  assert.doesNotMatch(specifier,forbidden,'Runtime entry attempted to resolve a build tool')
  const result=nextResolve(specifier,context)
  seen.push(result.url)
  return result
}})
try {
  const [entry,mode]=process.argv.slice(2)
  const runtime=mode==='cjs'?require(entry):await import(entry)
  const official=await import('@stylexjs/stylex')
  assert.deepEqual(Object.keys(runtime).sort(),Object.keys(official).sort())
  assert.equal(runtime.attrs,official.attrs)
  assert.equal(runtime.props,official.props)
  assert.ok(!seen.some(url=>/\\/@(?:babel|stylexswc)\\/|\\/@weapp-stylex\\/(?:compiler|weapp-vite|taro|uni-app)\\//.test(url)), 'Runtime entry resolved build tool files')
} finally {hook.deregister()}
`)
  for (const entry of ['weapp-stylex', 'weapp-stylex/core', '@weapp-stylex/core']) {
    for (const format of ['esm', 'cjs']) {
      await run(testNode, ['runtime-isolation.mjs', entry, format], { cwd: directory })
    }
  }
  await writeFile(path.join(directory, 'consumer.mjs'), `
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import * as stylex from 'weapp-stylex'
const require=createRequire(import.meta.url)
assert.equal(typeof stylex.create,'function')
assert.equal(typeof require('weapp-stylex').attrs,'function')
assert.ok(!Object.keys(require.cache).some(file=>/[/\\\\]@babel[/\\\\]|[/\\\\]compiler[/\\\\]dist/.test(file)), 'Runtime entry loaded build tools')
assert.equal(import.meta.resolve('@weapp-stylex/core'),new URL('./node_modules/@weapp-stylex/core/dist/index.js',import.meta.url).href)
assert.equal(import.meta.resolve('@weapp-stylex/weapp-vite'),new URL('./node_modules/@weapp-stylex/weapp-vite/dist/index.js',import.meta.url).href)
for (const adapter of [await import('@weapp-stylex/weapp-vite'),require('@weapp-stylex/weapp-vite')]) {
  assert.equal(adapter.default,adapter.stylexCompiler)
  assert.equal(adapter.createStylex({target:'web'}).compilerPlugin.name,'weapp-stylex')
}
for (const [name,api] of [['weapp-vite','stylexCompiler'],['taro','stylexTaro'],['uni-app','stylexUniApp'],['taro/loader','stylexLoader']]) {
  const esm=await import('weapp-stylex/'+name)
  const cjs=require('weapp-stylex/'+name)
  assert.equal(typeof esm.default,'function',name+' ESM default')
  assert.equal(typeof cjs.default,'function',name+' CJS default')
  assert.equal(esm.default,esm[api])
  assert.equal(cjs.default,cjs[api])
}
const {StylexSession}=await import('weapp-stylex/compiler')
assert.equal(typeof require('weapp-stylex/compiler').StylexSession,'function')
const session=new StylexSession()
const result=await session.transform("import * as stylex from 'weapp-stylex';export const styles=stylex.create({root:{padding:16}});export const attrs=stylex.attrs(styles.root)",new URL('styles.mjs',import.meta.url).pathname,{resolve:async()=>undefined,addWatchFile(){}})
assert.ok(result)
assert.ok(!result.code.includes('stylex.create'))
const {writeFile}=await import('node:fs/promises')
await writeFile(new URL('styles.mjs',import.meta.url),result.code)
assert.ok(!Object.keys(require.cache).some(file=>file.includes('@stylexswc')), 'Default Babel loaded the native addon')
const {styles,attrs}=await import('./styles.mjs')
assert.match(attrs.class,/sx[a-z0-9]+/)
assert.equal(stylex.props(styles.root).className,attrs.class)
assert.equal(require('weapp-stylex/core').attrs(styles.root).class,attrs.class)
assert.match(session.css(),/padding:16px/)
`)
  await run(testNode, ['consumer.mjs'], { cwd: directory })
  if (!registryVersion) {
    await writeFile(path.join(directory, 'backend.mjs'), `
import assert from 'node:assert/strict'
import {StylexSession} from 'weapp-stylex/compiler'
const missing=process.argv[2]==='missing'
const source="import * as stylex from 'weapp-stylex';export const styles=stylex.create({root:{padding:16}})"
const host={resolve:async()=>undefined,addWatchFile(){}}
const filename=new URL('backend-style.js',import.meta.url).pathname
const session=new StylexSession({backend:'auto'})
const result=await session.transform(source,filename,host)
assert.deepEqual(await session.transform(source,filename,host),result)
assert.equal(session.getStats().swcTransforms,missing?0:1)
assert.equal(session.getStats().babelTransforms,missing?1:0)
assert.equal(session.getStats().cacheHits,1)
assert.match(session.css(),/padding:16px/)
if(missing) await assert.rejects(new StylexSession({backend:'swc'}).transform(source,filename,host),/unavailable/)
`)
    await run(testNode, ['backend.mjs'], { cwd: directory })
    const compilerRequire = createRequire(require.resolve('@weapp-stylex/compiler'))
    assert.ok(compilerRequire.resolve('@stylexswc/rs-compiler/package.json'))
    // Use a sibling install so Node cannot resolve the present addon from the
    // first consumer's parent directories. This exercises an actual omitted
    // optional dependency tree, including its native platform packages.
    const withoutOptional = await realpath(await mkdtemp(path.join(tmpdir(), 'weapp-stylex-no-optional-')))
    try {
      await writeFile(path.join(withoutOptional, 'package.json'), '{"name":"packed-facade-consumer-no-optional","private":true,"type":"module"}')
      await installPackages(withoutOptional, packages, { omitOptional: true })
      const missingRequire = createRequire(path.join(withoutOptional, 'package.json'))
      const missingCompilerRequire = createRequire(missingRequire.resolve('@weapp-stylex/compiler'))
      assert.throws(() => missingCompilerRequire.resolve('@stylexswc/rs-compiler/package.json'), { code: 'MODULE_NOT_FOUND' })
      for (const file of ['consumer.mjs', 'backend.mjs', 'runtime-isolation.mjs']) {
        await writeFile(path.join(withoutOptional, file), await readFile(path.join(directory, file), 'utf8'))
      }
      for (const entry of ['weapp-stylex', 'weapp-stylex/core', '@weapp-stylex/core']) {
        for (const format of ['esm', 'cjs']) {
          await run(testNode, ['runtime-isolation.mjs', entry, format], { cwd: withoutOptional })
        }
      }
      await run(testNode, ['consumer.mjs'], { cwd: withoutOptional })
      await run(testNode, ['backend.mjs', 'missing'], { cwd: withoutOptional })
    }
    finally {
      await rm(withoutOptional, { recursive: true, force: true })
    }
  }
  await writeFile(path.join(directory, 'consumer.ts'), `import * as stylex from 'weapp-stylex';const styles=stylex.create({root:{padding:16}});const className:string|undefined=stylex.attrs(styles.root).class;void className;`)
  await run(testNode, [tooling.resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', 'false', '--module', 'NodeNext', '--target', 'ES2022', 'consumer.ts'], { cwd: directory })
  if (!registryVersion) {
    const compilerTypes = `
import {createWebStylePlugins, MiniProgramStyleEmitter, miniProgramExtensions, StylexSession, type StylexCompilerOptions, type StylexTarget, type WebStyleOptions} from 'weapp-stylex/compiler'
export const targets: StylexTarget[] = ['weapp', 'alipay', 'tt', 'web']
export const options: StylexCompilerOptions = {target: 'web', backend: 'auto'}
export const session = new StylexSession(options)
export const compiledSfc = (code: string) => session.transformCompiledSfcScript(code, '/project/page.vue', {resolve: async () => undefined, addWatchFile() {}})
export const miniEmitter = new MiniProgramStyleEmitter('alipay', miniProgramExtensions('alipay'))
export const webOptions: WebStyleOptions = {
  delivery: 'shadow',
  transformCss: async css => css,
  transformShadowCss: css => ({pageCss: css, componentCss: css}),
  policyKey: () => 'host-units',
}
export const webPlugins = createWebStylePlugins(session, webOptions)
// @ts-expect-error Unsupported platforms must fail at the public boundary.
new StylexSession({target: 'swan'})
// @ts-expect-error H5 must use CSS delivery rather than a mini-program emitter.
new MiniProgramStyleEmitter('web')
`
    const adapterTypes = `
import {createStylex, type StylexTarget} from 'weapp-stylex/weapp-vite'
import {stylexTaro, taroStylexTarget} from 'weapp-stylex/taro'
import {stylexUniApp, uniStylexTarget} from 'weapp-stylex/uni-app'
export const nativeIntegration = createStylex({target: 'alipay', backend: 'babel'})
export const nativeWebIntegration = createStylex({target: 'web'})
export const taroPlugin: typeof stylexTaro = stylexTaro
export const taroOptions: NonNullable<Parameters<typeof stylexTaro>[1]> = {target: 'tt'}
export const taroTarget: StylexTarget = taroStylexTarget('h5')
export const uniPlugins = stylexUniApp({target: 'web'})
export const uniTarget: StylexTarget = uniStylexTarget('mp-alipay')
// @ts-expect-error Each adapter retains the shared target union.
createStylex({target: 'swan'})
// @ts-expect-error Unsupported targets are rejected by uni-app as well.
stylexUniApp({target: 'qq'})
`
    for (const extension of ['mts', 'cts']) {
      await writeFile(path.join(directory, `compiler-types.${extension}`), compilerTypes)
      await run(testNode, [tooling.resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', 'false', '--module', 'NodeNext', '--target', 'ES2022', `compiler-types.${extension}`], { cwd: directory })
      await writeFile(path.join(directory, `adapter-types.${extension}`), adapterTypes)
      // Optional host peers deliberately stay absent; check consumer types and
      // inferred declaration portability without checking those host libraries.
      await run(testNode, [tooling.resolve('typescript/bin/tsc'), '--declaration', '--emitDeclarationOnly', '--strict', '--skipLibCheck', 'true', '--module', 'NodeNext', '--target', 'ES2022', '--outDir', 'consumer-types', `adapter-types.${extension}`], { cwd: directory })
    }
  }
  process.stdout.write(`${registryVersion ? `Published weapp-stylex@${registryVersion}` : 'Packed facade'} (Node ${nodeVersion}): all package export files, optional hosts, ESM/CJS runtime isolation, StyleX compilation and TypeScript${registryVersion ? '' : ' public compiler/adapter types, ESM build maps and addon-omitted install'} passed\n`)
}
finally {
  await rm(directory, { recursive: true, force: true })
}
