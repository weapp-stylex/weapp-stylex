import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const directory = await mkdtemp(path.join(tmpdir(), 'weapp-stylex-package-'))
try {
  const registryVersion = process.env.WEAPP_STYLEX_TEST_REGISTRY_VERSION
  let packages
  if (registryVersion) {
    assert.match(registryVersion, /^\d+\.\d+\.\d+$/)
    packages = [`weapp-stylex@${registryVersion}`]
  }
  else {
    const packs = path.join(directory, 'packs')
    await mkdir(packs)
    for (const name of ['core', 'compiler', 'weapp-vite', 'taro', 'uni-app', 'weapp-stylex']) {
      await run('corepack', ['pnpm', 'pack', '--pack-destination', packs], {
        cwd: path.join(root, 'packages', name),
      })
    }
    packages = (await readdir(packs)).filter(file => file.endsWith('.tgz')).map(file => path.join(packs, file))
    assert.equal(packages.length, 6)
  }
  await writeFile(path.join(directory, 'package.json'), '{"name":"packed-facade-consumer","private":true,"type":"module"}')
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--registry=https://registry.npmjs.org', ...packages], {
    cwd: directory,
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  })
  const require = createRequire(path.join(directory, 'package.json'))
  for (const host of ['weapp-vite', '@tarojs/service', 'webpack', '@dcloudio/vite-plugin-uni']) {
    assert.throws(() => require.resolve(host), { code: 'MODULE_NOT_FOUND' }, `Installing the facade unexpectedly installed ${host}`)
  }
  await writeFile(path.join(directory, 'consumer.mjs'), `
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import * as stylex from 'weapp-stylex'
const require=createRequire(import.meta.url)
assert.equal(typeof stylex.create,'function')
assert.equal(typeof require('weapp-stylex').attrs,'function')
assert.ok(!Object.keys(require.cache).some(file=>/[/\\\\]@babel[/\\\\]|[/\\\\]compiler[/\\\\]dist/.test(file)), 'Runtime entry loaded build tools')
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
  await run(process.execPath, ['consumer.mjs'], { cwd: directory })
  if (!registryVersion) {
    await writeFile(path.join(directory, 'backend.mjs'), `
import assert from 'node:assert/strict'
import {StylexSession} from 'weapp-stylex/compiler'
const missing=process.argv[2]==='missing'
const source="import * as stylex from 'weapp-stylex';export const styles=stylex.create({root:{padding:16}})"
const host={resolve:async()=>undefined,addWatchFile(){}}
const filename=new URL('backend-style.js',import.meta.url).pathname
const session=new StylexSession({backend:'auto'})
await session.transform(source,filename,host)
assert.equal(session.getStats().swcTransforms,missing?0:1)
assert.equal(session.getStats().babelTransforms,missing?1:0)
assert.match(session.css(),/padding:16px/)
if(missing) await assert.rejects(new StylexSession({backend:'swc'}).transform(source,filename,host),/unavailable/)
`)
    await run(process.execPath, ['backend.mjs'], { cwd: directory })
    const compilerRequire = createRequire(require.resolve('@weapp-stylex/compiler'))
    const addon = path.dirname(compilerRequire.resolve('@stylexswc/rs-compiler/package.json'))
    const hidden = path.join(directory, 'optional-addon-disabled')
    await rename(addon, hidden)
    try {
      await run(process.execPath, ['consumer.mjs'], { cwd: directory })
      await run(process.execPath, ['backend.mjs', 'missing'], { cwd: directory })
    }
    finally {
      await rename(hidden, addon)
    }
  }
  await writeFile(path.join(directory, 'consumer.ts'), `import * as stylex from 'weapp-stylex';const styles=stylex.create({root:{padding:16}});const className:string|undefined=stylex.attrs(styles.root).class;void className;`)
  const tooling = createRequire(new URL('../package.json', import.meta.url))
  await run(process.execPath, [tooling.resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', 'false', '--module', 'NodeNext', '--target', 'ES2022', 'consumer.ts'], { cwd: directory })
  process.stdout.write(`${registryVersion ? `Published weapp-stylex@${registryVersion}` : 'Packed facade'}: isolated install, optional hosts, runtime isolation, ESM/CJS exports, StyleX compilation and TypeScript passed\n`)
}
finally {
  await rm(directory, { recursive: true, force: true })
}
