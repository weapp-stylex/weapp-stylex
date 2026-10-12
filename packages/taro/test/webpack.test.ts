import type { Compiler, Stats } from 'webpack'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import webpack from 'webpack'
import { StylexWebpackPlugin } from '../src/webpack.js'

function run(compiler: Compiler, allowErrors = false): Promise<Stats> {
  return new Promise((resolve, reject) => {
    compiler.run((error, stats) => {
      if (error) {
        reject(error)
      }
      else if (!stats || (!allowErrors && stats.hasErrors())) {
        reject(new Error(stats?.toString({ all: false, errors: true }) ?? 'Missing Webpack stats'))
      }
      else {
        resolve(stats)
      }
    })
  })
}

function close(compiler: Compiler): Promise<void> {
  return new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()))
}

it('delivers H5 CSS through HTML, refreshes CSS-only token changes, and restores cached module metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stylex-webpack-web-'))
  const require = createRequire(path.resolve(import.meta.dirname, '../../../examples/taro-react/package.json'))
  const taroRequire = createRequire(require.resolve('@tarojs/vite-runner'))
  const pxtransform = taroRequire('postcss-pxtransform') as (options: object) => object
  const coreRequire = createRequire(path.resolve(import.meta.dirname, '../../core/package.json'))
  const facade = coreRequire.resolve('@stylexjs/stylex')
  const tokens = path.join(root, 'tokens.stylex.js')
  const entry = path.join(root, 'index.js')
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'stylex-webpack-fixture' }))
  await writeFile(tokens, 'import * as stylex from "weapp-stylex";export const tokens=stylex.defineVars({color:"red"});')
  await writeFile(entry, 'import * as stylex from "weapp-stylex";import {tokens} from "./tokens.stylex.js";const styles=stylex.create({root:{color:tokens.color,padding:16,marginTop:"16rpx"}});globalThis.result=stylex.props(styles.root);')
  const removedOutputs: string[] = []
  let simulateBuildError = false
  const createCompiler = () => {
    const compiler = webpack({
      context: root,
      mode: 'development',
      entry,
      output: { path: path.join(root, 'dist'), filename: '[name].js', publicPath: '/app/' },
      resolve: { alias: { 'weapp-stylex': facade } },
      cache: { type: 'filesystem', cacheDirectory: path.join(root, 'cache'), version: 'host-cache', buildDependencies: { host: [path.join(root, 'package.json')] } },
      infrastructureLogging: { level: 'error' },
      module: {
        rules: [
          { test: /\.js$/, enforce: 'pre', use: [{ loader: path.resolve(import.meta.dirname, '../dist/loader.cjs') }] },
          { test: /\.css$/, use: [{ loader: 'postcss-loader', options: { postcssOptions: { plugins: [pxtransform({ platform: 'h5', designWidth: 750, deviceRatio: { 750: 1 } })] } } }] },
        ],
      },
      plugins: [
        new StylexWebpackPlugin({ target: 'web' }, { policyKey: 'test-host-rpx' }),
        { apply(compiler) {
          compiler.hooks.thisCompilation.tap('fixture-html', (compilation) => {
            compilation.hooks.processAssets.tap({ name: 'fixture-html', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, () => {
              compilation.emitAsset('index.html', new webpack.sources.RawSource('<html><head></head><body></body></html>'))
            })
            compilation.hooks.processAssets.tap({ name: 'fixture-error', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT }, () => {
              if (simulateBuildError) {
                compilation.errors.push(new webpack.WebpackError('fixture build error'))
              }
            })
          })
        } },
      ],
    })
    const filesystem = compiler.outputFileSystem!
    compiler.outputFileSystem = { ...filesystem, unlink: (filename, callback) => {
      removedOutputs.push(String(filename))
      filesystem.unlink!(filename, callback)
    } }
    return compiler
  }
  let compiler = createCompiler()
  try {
    const first = await run(compiler)
    const firstManifest = JSON.parse(await readFile(path.join(root, 'dist/__weapp_stylex__/manifest.json'), 'utf8')) as { fileName: string, hash: string }
    const firstCss = await readFile(path.join(root, 'dist', firstManifest.fileName), 'utf8')
    expect(firstCss).toContain('padding:16px')
    expect(firstCss).toContain('margin-top:0.4rem')
    expect(firstCss).toContain(':root')
    expect(firstCss).toContain(':red')
    expect(await readFile(path.join(root, 'dist/index.html'), 'utf8')).toContain(`/app/${firstManifest.fileName}`)
    const requested: string[] = []
    const browserErrors: unknown[] = []
    let browserManifest: { hash: string, fileName: string | null, errors?: boolean } = { hash: 'empty', fileName: null }
    const stylesheetLoads: string[] = []
    const stylesheetErrors: (() => void)[] = []
    const windowEvents = new Map<string, (event: { source: unknown, data: unknown }) => void>()
    const browserWindow = {
      addEventListener: (type: string, listener: (event: { source: unknown, data: unknown }) => void) => windowEvents.set(type, listener),
      removeEventListener: (type: string) => windowEvents.delete(type),
    }
    runInNewContext(await readFile(path.join(root, 'dist/main.js'), 'utf8'), {
      fetch: async (url: string) => {
        requested.push(url)
        return { ok: true, json: async () => browserManifest }
      },
      document: {
        querySelectorAll: () => [],
        createElement: () => ({ href: '', dataset: {}, remove() {}, addEventListener(type: string, listener: () => void) {
          if (type === 'error') {
            stylesheetErrors.push(listener)
          }
        } }),
        head: { prepend: (link: { href: string }) => stylesheetLoads.push(link.href) },
      },
      window: browserWindow,
      console: { error: (error: unknown) => browserErrors.push(error) },
    })
    await new Promise(resolve => setImmediate(resolve))
    expect(browserErrors).toEqual([])
    expect(requested).toEqual(['/app/__weapp_stylex__/manifest.json'])
    windowEvents.get('message')!({ source: {}, data: 'webpackHotUpdate-other-frame' })
    windowEvents.get('message')!({ source: browserWindow, data: 'unrelated-message' })
    windowEvents.get('message')!({ source: browserWindow, data: { type: 'webpackErrors' } })
    await new Promise(resolve => setImmediate(resolve))
    expect(requested).toHaveLength(1)
    windowEvents.get('message')!({ source: browserWindow, data: 'webpackHotUpdate-successful-build-hash' })
    await new Promise(resolve => setImmediate(resolve))
    expect(requested).toEqual(['/app/__weapp_stylex__/manifest.json', '/app/__weapp_stylex__/manifest.json'])
    expect(browserErrors).toEqual([])
    browserManifest = { hash: 'invalid', fileName: 'css/invalid.css', errors: true }
    windowEvents.get('message')!({ source: browserWindow, data: { type: 'webpackWarnings' } })
    await new Promise(resolve => setImmediate(resolve))
    expect(stylesheetLoads).toEqual([])
    expect(compiler.options.cache && compiler.options.cache.type === 'filesystem' && compiler.options.cache.version).toContain('host-cache:weapp-stylex:')
    expect(compiler.options.cache && compiler.options.cache.type === 'filesystem' && compiler.options.cache.version).toContain('test-host-rpx')
    await close(compiler)
    compiler = createCompiler()
    const cached = await run(compiler)
    expect(cached.hash).toBe(first.hash)
    expect(await readFile(path.join(root, 'dist', firstManifest.fileName), 'utf8')).toBe(firstCss)
    await writeFile(tokens, 'import * as stylex from "weapp-stylex";export const tokens=stylex.defineVars({color:"blue"});')
    const second = await run(compiler)
    const nextManifest = JSON.parse(await readFile(path.join(root, 'dist/__weapp_stylex__/manifest.json'), 'utf8')) as { fileName: string, hash: string }
    expect(second.hash).not.toBe(first.hash)
    expect(nextManifest.hash).not.toBe(firstManifest.hash)
    expect(await readFile(path.join(root, 'dist', nextManifest.fileName), 'utf8')).toContain(':blue')
    browserManifest = nextManifest
    windowEvents.get('message')!({ source: browserWindow, data: { type: 'webpackOk' } })
    await new Promise(resolve => setImmediate(resolve))
    const nextStylesheet = `/app/${nextManifest.fileName}?v=${nextManifest.hash}`
    expect(stylesheetLoads).toEqual([nextStylesheet])
    stylesheetErrors[0]!()
    windowEvents.get('message')!({ source: browserWindow, data: { type: 'webpackStillOk' } })
    await new Promise(resolve => setImmediate(resolve))
    expect(stylesheetLoads).toEqual([nextStylesheet, nextStylesheet])
    expect(browserErrors).toEqual([])
    expect(await readdir(path.join(root, 'dist/css'))).not.toContain(path.basename(firstManifest.fileName))
    expect(removedOutputs).toContain(path.join(root, 'dist', firstManifest.fileName))
    simulateBuildError = true
    await writeFile(tokens, 'import * as stylex from "weapp-stylex";export const tokens=stylex.defineVars({color:"green"});')
    const failed = await run(compiler, true)
    expect(failed.hasErrors()).toBe(true)
    expect(JSON.parse(await readFile(path.join(root, 'dist/__weapp_stylex__/manifest.json'), 'utf8')).errors).toBe(true)
    expect(await readFile(path.join(root, 'dist', nextManifest.fileName), 'utf8')).toContain(':blue')
    expect(removedOutputs).not.toContain(path.join(root, 'dist', nextManifest.fileName))
    simulateBuildError = false
    await writeFile(entry, 'globalThis.result=1;')
    await run(compiler)
    expect(await readFile(path.join(root, 'dist/index.html'), 'utf8')).not.toContain('data-weapp-stylex')
    expect(JSON.parse(await readFile(path.join(root, 'dist/__weapp_stylex__/manifest.json'), 'utf8')).fileName).toBeNull()
    expect(removedOutputs).toContain(path.join(root, 'dist', nextManifest.fileName))
  }
  finally {
    await close(compiler)
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
