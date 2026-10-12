import type { WebModuleNode, WebServer } from '../src/web.js'
import type { StyleBundle } from '../src/wxss.js'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { StylexSession } from '../src/session.js'
import { createCssValueTransformer, createRpxOnlyPostcssTransformer } from '../src/web-units.js'
import { createWebStylePlugins, injectWebStyleLink, WEB_CSS_ID, webAssetUrl } from '../src/web.js'

const host = { resolve: async () => undefined, addWatchFile() {} }
const configuration = { root: '/project', base: '/app/', command: 'build', build: { outDir: 'dist' } }

afterEach(() => vi.unstubAllGlobals())

it.each([
  '<style>.app{padding:0}</style><link rel="stylesheet" href="app.css">',
  '<link rel=stylesheet href="app.css">',
])('preserves the host cascade by placing StyleX before %s', (styles) => {
  const html = injectWebStyleLink(`<html><head>${styles}</head></html>`, '/stylex.css')
  expect(html.indexOf('data-weapp-stylex')).toBeLessThan(html.indexOf(styles))
})

it('attaches final aggregate CSS to HTML after all modules transform', async () => {
  const session = new StylexSession({ target: 'web' })
  const [plugin] = createWebStylePlugins(session, { transformCss: css => css })
  plugin!.configResolved(configuration)
  const ids = ['/project/a.ts', '/project/b.ts']
  await session.transform('import * as stylex from \'weapp-stylex\';export const styles=stylex.create({a:{padding:16}})', ids[0]!, host)
  await session.transform('import * as stylex from \'weapp-stylex\';export const styles=stylex.create({b:{marginTop:\'12rpx\'}})', ids[1]!, host)
  const bundle: StyleBundle = { 'index.html': { type: 'asset', fileName: 'index.html', source: '<html><head><link rel="stylesheet" href="/app/main.css"></head></html>' } }
  const emitted: { fileName: string, source: string }[] = []
  const context = {
    getModuleIds: () => ids.values(),
    emitFile: (asset: { fileName: string, source: string }) => {
      emitted.push(asset)
      return 'css'
    },
    error: (message: string): never => {
      throw new Error(message)
    },
  }
  await plugin!.generateBundle.handler.call(context, {}, bundle)
  expect(emitted).toHaveLength(1)
  expect(emitted[0]!.source).toContain('padding:16px')
  expect(emitted[0]!.source).toContain('margin-top:12rpx')
  expect(String((bundle['index.html'] as { source: string }).source)).toContain(`/app/${emitted[0]!.fileName}`)
  expect(String((bundle['index.html'] as { source: string }).source).indexOf('data-weapp-stylex')).toBeLessThan(String((bundle['index.html'] as { source: string }).source).indexOf('main.css'))
})

it('keeps a first production build without StyleX unchanged', async () => {
  const [plugin] = createWebStylePlugins(new StylexSession({ target: 'web' }), { transformCss: css => css })
  plugin!.configResolved(configuration)
  const html = '<html><head></head><body></body></html>'
  const bundle: StyleBundle = { 'index.html': { type: 'asset', fileName: 'index.html', source: html } }
  const emitFile = vi.fn()
  await plugin!.generateBundle.handler.call({ getModuleIds: () => [].values(), emitFile, error: (message: string): never => {
    throw new Error(message)
  } }, {}, bundle)
  expect(emitFile).not.toHaveBeenCalled()
  expect((bundle['index.html'] as { source: string }).source).toBe(html)
})

it('does not transfer owned stylesheet filenames to another build output', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'stylex-web-ownership-'))
  try {
    const source = path.join(root, 'index.ts')
    let session = new StylexSession({ target: 'web' })
    const [plugin] = createWebStylePlugins(() => session, { transformCss: css => css })
    plugin!.configResolved({ ...configuration, root, build: { outDir: 'first', watch: {} } })
    await session.transform('import * as stylex from \'weapp-stylex\';export const styles=stylex.create({a:{padding:16}})', source, host)
    let filename = ''
    await plugin!.generateBundle.handler.call({ getModuleIds: () => [source].values(), emitFile: asset => filename = asset.fileName, error: (message): never => {
      throw new Error(message)
    } }, {}, { 'index.html': { type: 'asset', fileName: 'index.html', source: '<html><head></head></html>' } })
    const firstFile = path.join(root, 'first', filename)
    await mkdir(path.dirname(firstFile), { recursive: true })
    await writeFile(firstFile, '.generated{}')
    const userFile = path.join(root, 'second', filename)
    await mkdir(path.dirname(userFile), { recursive: true })
    await writeFile(userFile, '.user-owned{}')
    session = new StylexSession({ target: 'web' })
    plugin!.configResolved({ ...configuration, root, build: { outDir: 'second', watch: {} } })
    const html = '<html><head></head></html>'
    const bundle: StyleBundle = { 'index.html': { type: 'asset', fileName: 'index.html', source: html } }
    await plugin!.generateBundle.handler.call({ getModuleIds: () => [].values(), emitFile: () => '', error: (message): never => {
      throw new Error(message)
    } }, {}, bundle)
    expect(await readFile(userFile, 'utf8')).toBe('.user-owned{}')
    expect(bundle['index.html']).toMatchObject({ source: html })
    plugin!.configResolved({ ...configuration, root, build: { outDir: 'first', watch: {}, write: false } })
    await plugin!.generateBundle.handler.call({ getModuleIds: () => [].values(), emitFile: () => '', error: (message): never => {
      throw new Error(message)
    } }, {}, bundle)
    expect(await readFile(firstFile, 'utf8')).toBe('.generated{}')
    plugin!.configResolved({ ...configuration, root, build: { outDir: 'first', watch: {} } })
    await plugin!.generateBundle.handler.call({ getModuleIds: () => [].values(), emitFile: () => '', error: (message): never => {
      throw new Error(message)
    } }, {}, bundle)
    await expect(readFile(firstFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(userFile, 'utf8')).toBe('.user-owned{}')
    plugin!.closeWatcher()
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('fills shadow stylesheet placeholders only after the complete build graph', async () => {
  const session = new StylexSession({ target: 'web' })
  const [plugin] = createWebStylePlugins(session, { delivery: 'shadow', transformCss: css => css, transformShadowCss: css => ({ pageCss: css, componentCss: `/* component */${css}` }) })
  plugin!.configResolved(configuration)
  const loaded = plugin!.load(`\0${WEB_CSS_ID}`)!
  expect(loaded).not.toContain('padding:16px')
  await session.transform('import * as stylex from \'weapp-stylex\';export const styles=stylex.create({a:{padding:16}})', '/project/index.ts', host)
  await plugin!.renderStart.call({ getModuleIds: () => ['/project/index.ts'].values(), emitFile: () => '', error: (message: string): never => {
    throw new Error(message)
  } })
  const result = plugin!.renderChunk(loaded)!
  expect(result.code).toContain('padding:16px')
  expect(result.code).toContain('/* component */')
  expect(result.code).not.toContain('__WEAPP_STYLEX_')
  expect(plugin!.augmentChunkHash()).toBeTruthy()
})

it('uses a live dev state read for the first shadow registration', async () => {
  const [plugin] = createWebStylePlugins(new StylexSession({ target: 'web' }), { delivery: 'shadow', transformCss: css => css })
  plugin!.configResolved({ ...configuration, command: 'serve' })
  const loaded = plugin!.load(`\0${WEB_CSS_ID}`)!
  let respond!: (value: unknown) => void
  vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise((resolve) => {
    respond = resolve
  })).mockResolvedValue({ ok: true, json: async () => ({ revision: 1, hash: 'final', pageCss: '.final{}', componentCss: '.component{}' }) }))
  const imported = import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(loaded)}`)
  await vi.waitFor(() => expect(respond).toBeTypeOf('function'))
  respond({ ok: true, json: async () => ({ revision: 1, hash: 'final', pageCss: '.final{}', componentCss: '.component{}' }) })
  const module = await imported
  expect(module.pageCss).toBe('.final{}')
  expect(module.componentCss).toBe('.component{}')
})

it('keeps one owned stylesheet across overlapping updates and reconnect retries', async () => {
  interface Link { href: string, rel: string, dataset: object, load?: () => void, error?: () => void, before: (next: Link) => void, remove: () => void, addEventListener: (event: string, callback: () => void) => void }
  let links: Link[] = []
  const makeLink = (): Link => {
    const link: Link = {
      href: '',
      rel: 'stylesheet',
      dataset: {},
      before: next => links.splice(links.indexOf(link), 0, next),
      remove: () => links = links.filter(other => other !== link),
      addEventListener: (event, callback) => {
        if (event === 'load' || event === 'error') {
          link[event] = callback
        }
      },
    }
    return link
  }
  const initial = makeLink()
  links.push(initial)
  const events = new Map<string, () => void>()
  vi.stubGlobal('__stylexHot', { on: (event: string, callback: () => void) => events.set(event, callback), dispose() {} })
  vi.stubGlobal('document', { readyState: 'complete', addEventListener() {}, removeEventListener() {}, querySelectorAll: () => links, createElement: makeLink, head: { prepend: (link: Link) => links.unshift(link) } })
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ revision: 1, hash: 'first', empty: false }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ revision: 2, hash: 'second', empty: false }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ revision: 3, hash: 'retry', empty: false }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ revision: 3, hash: 'retry', empty: false }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ revision: 4, hash: 'empty', empty: true }) }))
  const [plugin] = createWebStylePlugins(new StylexSession({ target: 'web' }), { transformCss: css => css })
  plugin!.configResolved({ ...configuration, command: 'serve' })
  const loaded = plugin!.load('\0virtual:weapp-stylex/web-client')!.replaceAll('import.meta.hot', 'globalThis.__stylexHot')
  await import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(loaded)}`)
  await vi.waitFor(() => expect(links).toHaveLength(2))
  const pendingFirst = links[0]!
  events.get('weapp-stylex:styles')!()
  await vi.waitFor(() => expect(links).toHaveLength(3))
  const latest = links[0]!
  latest.load!()
  pendingFirst.load!()
  expect(links).toEqual([latest])
  events.get('weapp-stylex:styles')!()
  await vi.waitFor(() => expect(links).toHaveLength(2))
  links[0]!.error!()
  expect(links).toEqual([latest])
  events.get('vite:ws:connect')!()
  await vi.waitFor(() => expect(links).toHaveLength(2))
  expect(links[0]!.href).toContain('v=retry')
  links[0]!.load!()
  expect(links).toHaveLength(1)
  events.get('weapp-stylex:styles')!()
  await vi.waitFor(() => expect(links).toHaveLength(0))
})

it('prunes old styles when HTML removes its final module entry', async () => {
  const session = new StylexSession({ target: 'web' })
  const source = '/project/old.ts'
  await session.transform('import * as stylex from \'weapp-stylex\';export const styles=stylex.create({a:{padding:16}})', source, host)
  const [plugin] = createWebStylePlugins(session, { transformCss: css => css })
  plugin!.configResolved({ ...configuration, command: 'serve' })
  let middleware: Parameters<WebServer['middlewares']['use']>[0] | undefined
  const node: WebModuleNode = { id: source, importedModules: new Set() }
  const invalidateModule = vi.fn()
  plugin!.configureServer({ middlewares: { use: handler => middleware = handler }, ws: { send() {} }, moduleGraph: { getModuleByUrl: async () => undefined, getModuleById: id => id === source ? node : undefined, invalidateModule } })
  plugin!.transformIndexHtml('<html><head></head><body></body></html>', { path: '/app/index.html' })
  const state = await new Promise<string>((resolve) => {
    middleware!({ url: '/app/__weapp_stylex__/state?ready=1' }, { setHeader() {}, end: resolve, statusCode: 200 }, () => {})
  })
  expect(JSON.parse(state).empty).toBe(true)
  expect(session.modules.size).toBe(0)
  expect(invalidateModule).toHaveBeenCalledWith(node)
  plugin!.closeWatcher()
})

it('resolves nested HTML and rejects preexisting ownership markers', () => {
  expect(webAssetUrl('./', 'assets/stylex.css', 'pages/detail.html')).toBe('../assets/stylex.css')
  expect(webAssetUrl('https://cdn.example/app/', 'assets/stylex.css')).toBe('https://cdn.example/app/assets/stylex.css')
  expect(() => injectWebStyleLink('<head><link data-weapp-stylex></head>', 'styles.css')).toThrow('ownership conflict')
})

it('reuses Taro rpx conversion while preserving ordinary pixels, strings and URLs', async () => {
  const require = createRequire(path.resolve(import.meta.dirname, '../../../examples/taro-react/package.json'))
  const taroRequire = createRequire(require.resolve('@tarojs/vite-runner'))
  const pxtransform = taroRequire('postcss-pxtransform') as (options: object) => Parameters<typeof createRpxOnlyPostcssTransformer>[0]
  const convert = createRpxOnlyPostcssTransformer(pxtransform({ platform: 'h5', designWidth: 750, deviceRatio: { 750: 1 }, targetUnit: 'rem', mediaQuery: true }), '/project/stylex.css')
  const css = await convert('.a{padding:16px;margin:16rpx;width:calc(10rpx + 4px);content:"16rpx";background:url("16rpx.png")}@media(min-width:20rpx){.a{height:-.5rpx}}')
  expect(css).toContain('padding:16px')
  expect(css).toContain('margin:0.4rem')
  expect(css).toContain('width:calc(0.25rem + 4px)')
  expect(css).toContain('content:"16rpx"')
  expect(css).toContain('url("16rpx.png")')
  expect(css).toContain('min-width:0.5rem')
  expect(css).toContain('height:-0.0125rem')
})

it('fails explicitly when the host leaves browser-invalid rpx', async () => {
  const convert = createRpxOnlyPostcssTransformer(undefined, '/project/stylex.css')
  expect(await convert('.a{padding:16px;content:"12rpx"}')).toContain('padding:16px')
  await expect(convert('.a{padding:16rpx}')).rejects.toThrow('host rpx converter')
  const noop = createRpxOnlyPostcssTransformer({ postcssPlugin: 'postcss-pxtransform', Once() {} }, '/project/stylex.css')
  await expect(noop('.a{padding:16rpx}')).rejects.toThrow('left unsupported rpx')
  const require = createRequire(path.resolve(import.meta.dirname, '../../../examples/taro-react/package.json'))
  const taroRequire = createRequire(require.resolve('@tarojs/vite-runner'))
  const pxtransform = taroRequire('postcss-pxtransform') as (options: object) => Parameters<typeof createRpxOnlyPostcssTransformer>[0]
  const invalid = createRpxOnlyPostcssTransformer(pxtransform({ platform: 'h5', targetUnit: 'abc', designWidth: 750, deviceRatio: { 750: 1 } }), '/project/stylex.css')
  await expect(invalid('.a{padding:16rpx;transition-duration:2s}')).rejects.toThrow('invalid browser length unit: abc')
  await expect(invalid('.a{--custom:2abc;padding:16rpx}')).rejects.toThrow('invalid browser length unit: abc')
  const valid = createRpxOnlyPostcssTransformer(pxtransform({ platform: 'h5', targetUnit: 'rem', designWidth: 750, deviceRatio: { 750: 1 } }), '/project/stylex.css')
  expect(await valid('.a{--custom:2abc;padding:16rpx;transition-duration:2s}')).toContain('--custom:2abc;padding:0.4rem;transition-duration:2s')
})

it('applies a host unit-only converter without changing px', () => {
  const convert = createCssValueTransformer(value => value.replace(/([\d.]+)rpx/g, (_, number) => `${Number(number) / 32}rem`))
  expect(convert(':root{--space:16rpx}.a{padding:16px}')).toBe(':root{--space:0.5rem}.a{padding:16px}')
  expect(convert('.a{content:"16rpx";background:url("16rpx.png");width:calc(16rpx + 4px)}')).toBe('.a{content:"16rpx";background:url("16rpx.png");width:calc(0.5rem + 4px)}')
  expect(() => createCssValueTransformer(value => value)('.a{width:16rpx}')).toThrow('host unit converter left unsupported rpx')
  expect(createCssValueTransformer(value => value)('.a{content:"16rpx";background:url("16rpx.png")}')).toContain('content:"16rpx"')
  expect(() => createCssValueTransformer(() => '2abc')('.a{width:16rpx}')).toThrow('invalid browser length unit: abc')
  const functional = createCssValueTransformer(() => 'calc(2vw + var(--space, 4px))')
  expect(functional('.a{width:16rpx;padding:16px;transition-duration:2s}')).toBe('.a{width:calc(2vw + var(--space, 4px));padding:16px;transition-duration:2s}')
})
