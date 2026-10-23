import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { assertHostsAbsent, installConsumer, run } from './candidates.mjs'

const contracts = {
  '@weapp-stylex/core': {
    api: `assert.equal(typeof entry.attrs,'function'); assert.equal(typeof entry.props,'function'); assert.match(entry.attrs({$$css:true,color:'sx-test'}).class,/sx-test/)`,
    types: `import * as stylex from '@weapp-stylex/core'; const styles=stylex.create({root:{padding:16}}); export const attrs=stylex.attrs(styles.root);`,
  },
  '@weapp-stylex/compiler': {
    api: `assert.equal(typeof entry.StylexSession,'function'); const session=new entry.StylexSession(); const result=await session.transform("import * as stylex from '@stylexjs/stylex';export const styles=stylex.create({root:{padding:16}})",new URL('styles.js',import.meta.url).pathname,{resolve:async()=>undefined,addWatchFile(){}});assert.ok(result);assert.match(session.css(),/padding:16px/);assert.ok(!Object.keys(require.cache).some(file=>file.includes('@stylexswc')),'Default Babel loaded the native addon')`,
    types: `import {StylexSession, MiniProgramStyleEmitter, type StylexCompilerOptions} from '@weapp-stylex/compiler'; export const options:StylexCompilerOptions={target:'web',backend:'auto'}; export const session=new StylexSession(options); export const emitter=new MiniProgramStyleEmitter('alipay');\n// @ts-expect-error Unsupported targets remain rejected.\nnew StylexSession({target:'swan'});`,
  },
  '@weapp-stylex/weapp-vite': {
    api: `assert.equal(entry.default,entry.stylexCompiler);assert.equal(entry.createStylex({target:'web'}).compilerPlugin.name,'weapp-stylex')`,
    types: `import {createStylex} from '@weapp-stylex/weapp-vite'; export const native=createStylex({target:'alipay',backend:'auto'}); export const web=createStylex({target:'web'}); export const {vitePlugins,compilerPlugin}=createStylex();\n// @ts-expect-error Unsupported targets remain rejected.\ncreateStylex({target:'swan'});`,
  },
  '@weapp-stylex/taro': {
    api: `assert.equal(entry.default,entry.stylexTaro);assert.equal(entry.taroStylexTarget('h5'),'web');for(const loader of [await import('@weapp-stylex/taro/loader'),require('@weapp-stylex/taro/loader')]){assert.equal(loader.default,loader.stylexLoader);assert.equal(typeof loader.default,'function')}`,
    types: `import {stylexTaro,taroStylexTarget} from '@weapp-stylex/taro';import loader from '@weapp-stylex/taro/loader';export const plugin:typeof stylexTaro=stylexTaro;export const options:NonNullable<Parameters<typeof stylexTaro>[1]>={target:'tt'};export const target=taroStylexTarget('h5');export const webpackLoader:typeof loader=loader;`,
  },
  '@weapp-stylex/uni-app': {
    api: `assert.equal(entry.default,entry.stylexUniApp);assert.equal(typeof entry.stylexUniApp,'function');assert.equal(entry.uniStylexTarget('mp-alipay'),'alipay')`,
    types: `import {stylexUniApp,uniStylexTarget} from '@weapp-stylex/uni-app';export const uniPlugins=stylexUniApp({target:'web'});export const spreadPlugins=[...stylexUniApp()];export const target=uniStylexTarget('mp-alipay');\n// @ts-expect-error Unsupported targets remain rejected.\nstylexUniApp({target:'qq'});`,
  },
}

export async function testIndependentEntries(candidates, { testNode, tooling }) {
  for (const [name, contract] of Object.entries(contracts)) {
    const directory = await mkdtemp(path.join(tmpdir(), 'weapp-stylex-single-entry-'))
    try {
      const { installed } = await installConsumer(directory, candidates, name, { dependencies: { typescript: tooling('typescript/package.json').version } })
      await assertHostsAbsent(directory, installed)
      const expected = name === '@weapp-stylex/core' ? [name] : name === '@weapp-stylex/compiler' ? [name] : [name, '@weapp-stylex/compiler']
      assert.deepEqual([...installed.keys()].sort(), expected.sort(), `${name} installed unrelated StyleX packages`)
      await writeFile(path.join(directory, 'entry.mjs'), `import assert from 'node:assert/strict'
import {createRequire,registerHooks} from 'node:module'
const require=createRequire(import.meta.url)
const runtime=${JSON.stringify(name === '@weapp-stylex/core')}
const forbidden=['@babel/','@stylexswc/','@weapp-stylex/compiler','@weapp-stylex/weapp-vite','@weapp-stylex/taro','@weapp-stylex/uni-app','weapp-vite','@tarojs/','webpack','@dcloudio/']
const hook=registerHooks({resolve(specifier,context,next){assert.ok(!specifier.startsWith('@stylexswc/'),'Import/default Babel attempted to load the native addon');if(runtime)assert.ok(!forbidden.some(prefix=>specifier.startsWith(prefix)),'Runtime attempted to resolve '+specifier);return next(specifier,context)}})
try {const entry=process.argv[2]==='cjs'?require(${JSON.stringify(name)}):await import(${JSON.stringify(name)});${contract.api}} finally {hook?.deregister()}
`)
      for (const format of ['esm', 'cjs']) {
        await run(testNode, ['entry.mjs', format], { cwd: directory })
      }
      for (const extension of ['mts', 'cts']) {
        await writeFile(path.join(directory, `types.${extension}`), contract.types)
        await run(testNode, [tooling.resolve('typescript/bin/tsc'), '--declaration', '--emitDeclarationOnly', '--strict', '--skipLibCheck', String(!['@weapp-stylex/core', '@weapp-stylex/compiler'].includes(name)), '--module', 'NodeNext', '--target', 'ES2022', '--outDir', 'types', `types.${extension}`], { cwd: directory })
      }
      if (name === '@weapp-stylex/compiler') {
        await testCompilerWithoutAddon(directory, candidates, testNode)
      }
      process.stdout.write(`Independent ${name}: ESM/CJS, public types, candidate dependency graph and optional host isolation passed\n`)
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
}

async function testCompilerWithoutAddon(source, candidates, testNode) {
  const directory = await mkdtemp(path.join(tmpdir(), 'weapp-stylex-single-no-addon-'))
  try {
    const { installed } = await installConsumer(directory, candidates, '@weapp-stylex/compiler', { omitOptional: true })
    await assertHostsAbsent(directory, installed)
    const require = createRequire(path.join(installed.get('@weapp-stylex/compiler'), 'package.json'))
    assert.throws(() => require.resolve('@stylexswc/rs-compiler'), { code: 'MODULE_NOT_FOUND' })
    await writeFile(path.join(directory, 'entry.mjs'), await readFile(path.join(source, 'entry.mjs'), 'utf8'))
    for (const format of ['esm', 'cjs']) {
      await run(testNode, ['entry.mjs', format], { cwd: directory })
    }
    await writeFile(path.join(directory, 'missing.mjs'), `import assert from 'node:assert/strict';import {StylexSession} from '@weapp-stylex/compiler';const source="import * as stylex from '@stylexjs/stylex';export const styles=stylex.create({root:{padding:16}})";const hooks={resolve:async()=>undefined,addWatchFile(){}};const file=new URL('styles.js',import.meta.url).pathname;const auto=new StylexSession({backend:'auto'});await auto.transform(source,file,hooks);assert.equal(auto.getStats().babelTransforms,1);assert.equal(auto.getStats().swcTransforms,0);await assert.rejects(new StylexSession({backend:'swc'}).transform(source,file,hooks),/unavailable/);`)
    await run(testNode, ['missing.mjs'], { cwd: directory })
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}
