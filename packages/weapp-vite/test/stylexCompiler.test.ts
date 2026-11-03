import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { stylexCompiler } from '../src/index'

interface TestContext {
  root: string
  srcRoot: string
  platform: string
  outputExtensions: { wxss: string, wxml: string }
  isDev: boolean
  resolvedConfig?: { root?: string, build: { outDir?: string, watch?: unknown } }
  addWatchFile: (id: string) => void
  warn: (message: string) => void
  error: (message: string) => never
  readFile: (id: string) => Promise<string>
  resolve: () => Promise<null>
  invalidate: () => void
  claimSource: () => void
  getSourceOwner: () => undefined
}

type TestBundle = Record<
  string,
  {
    type: 'asset' | 'chunk'
    fileName: string
    source?: string
    code?: string
    modules?: Record<string, unknown>
  }
>

function makeContext(overrides: Partial<TestContext> = {}): TestContext {
  return {
    root: '/project',
    srcRoot: '/project/src',
    platform: 'weapp',
    outputExtensions: { wxss: 'wxss', wxml: 'wxml' },
    isDev: false,
    addWatchFile: () => undefined,
    warn: () => undefined,
    error: (message) => {
      throw new Error(message)
    },
    readFile: async () => '',
    resolve: async () => null,
    invalidate: () => undefined,
    claimSource: () => undefined,
    getSourceOwner: () => undefined,
    ...overrides,
  }
}

async function compile(code: string, id = '/project/src/pages/index/index.ts') {
  const plugin = stylexCompiler()
  if (typeof plugin === 'function') {
    throw new TypeError('Expected a compiler provider object')
  }
  const context = makeContext()
  const controller = await plugin.create(context as never)
  const request = { id, code, kind: 'script' as const }
  expect(controller.claimSource?.(request)).toBeTruthy()
  const transformed = await controller.transformSource?.(request)
  expect(transformed).toBeTruthy()
  return { controller, transformed: transformed!, context }
}

describe('stylexCompiler', () => {
  it.each([
    ['alipay', 'axml', 'acss'],
    ['tt', 'ttml', 'ttss'],
  ])('uses the %s host extensions and generates missing style companions', async (platform, template, style) => {
    const plugin = stylexCompiler()
    if (typeof plugin === 'function') {
      throw new TypeError('Expected provider')
    }
    const context = makeContext({ platform, outputExtensions: { wxml: template!, wxss: style! } })
    const controller = await plugin.create(context as never)
    await controller.transformSource?.({
      id: '/project/src/page.ts',
      kind: 'script',
      code: `import * as stylex from '@weapp-stylex/core';export const styles=stylex.create({root:{padding:16}})`,
    })
    const bundle: TestBundle = {
      'app.js': { type: 'chunk', fileName: 'app.js', code: '' },
      'pages/index.js': { type: 'chunk', fileName: 'pages/index.js', code: '' },
      [`pages/index.${template}`]: { type: 'asset', fileName: `pages/index.${template}`, source: '<view />' },
    }
    await controller.generateBundle?.(bundle as never, context as never)
    expect(bundle[`pages/index.${style}`]?.source).toBe(`@import "../stylex.${style}";\n`)
    expect(bundle[`stylex.${style}`]?.source).toContain('padding:16px')
    expect(Object.keys(bundle).some(name => name.endsWith('.wxss'))).toBe(false)
  })

  it('rejects unsupported host targets and explicit target conflicts', () => {
    const plugin = stylexCompiler({ target: 'tt' })
    if (typeof plugin === 'function') {
      throw new TypeError('Expected provider')
    }
    expect(() => plugin.create(makeContext() as never)).toThrow('conflicts')
    expect(() => plugin.create(makeContext({ platform: 'swan' }) as never)).toThrow('Unsupported StyleX target')
  })

  it('retains rules across watch closeBundle disposal and forgets an import removed from an active module', async () => {
    const plugin = stylexCompiler()
    if (typeof plugin === 'function') {
      throw new TypeError('Expected provider')
    }
    const context = makeContext({ resolvedConfig: { build: { watch: {} } } })
    const controller = await plugin.create(context as never)
    const id = '/project/src/page.ts'
    await controller.transformSource?.({
      id,
      kind: 'script',
      code: 'import * as stylex from \'@weapp-stylex/core\'; export const styles=stylex.create({root:{color:\'red\'}})',
    })
    await controller.dispose?.()
    context.resolvedConfig = undefined
    const retained: TestBundle = {
      'page.js': {
        type: 'chunk',
        fileName: 'page.js',
        code: '',
        modules: { [id]: {} },
      },
    }
    await controller.generateBundle?.(retained as never, context as never)
    expect(retained['stylex.wxss']?.source).toContain('color:red')
    const request = { id, kind: 'script' as const, code: 'Page({})' }
    expect(controller.claimSource?.(request)).toBe(false)
    // Removal must happen when the provider declines the new source: the host
    // will never call transformSource for an unclaimed module.
    const bundle: TestBundle = {
      'page.js': {
        type: 'chunk',
        fileName: 'page.js',
        code: 'Page({})',
        modules: { [id]: {} },
      },
    }
    await controller.generateBundle?.(bundle as never, context as never)
    expect(bundle).not.toHaveProperty('stylex.wxss')
    await controller.closeWatcher?.()
  })
  it('transforms static styles and exposes attrs class strings', async () => {
    const { transformed } = await compile(`
      import * as stylex from '@weapp-stylex/core';
      const styles = stylex.create({ root: { padding: 16, backgroundColor: 'white' } });
      const sx = { root: stylex.attrs(styles.root).class };
      Page({ data: { sx } });
    `)

    expect(transformed.code).toContain('class: "sx')
    expect(transformed.code).not.toContain('stylex.create')
    expect(transformed.code).not.toContain('padding: 16')
  })

  it('compiles conditional and merged styles to deterministic class branches', async () => {
    const { transformed } = await compile(`
      import * as stylex from '@stylexjs/stylex';
      const styles = stylex.create({ root: { padding: 16 }, active: { opacity: 0.6 } });
      const sx = stylex.attrs(styles.root, active && styles.active).class;
    `)

    expect(transformed.code).toContain('sx1tamke2')
    expect(transformed.code).toContain('sx197sbye')
    expect(transformed.code).toContain('!!active')
  })

  it('shares one physical stylesheet while retaining each page and component import', async () => {
    const first = await compile(`
      import * as stylex from '@weapp-stylex/core';
      const styles = stylex.create({ root: { padding: 16 } });
      const sx = stylex.attrs(styles.root).class;
    `)
    const second = await compile(
      `
      import * as stylex from '@weapp-stylex/core';
      const styles = stylex.create({ root: { padding: 16 } });
      const sx = stylex.attrs(styles.root).class;
    `,
      '/project/src/components/card.ts',
    )

    const bundle: TestBundle = {
      'pages/index/index.js': {
        type: 'chunk' as const,
        fileName: 'pages/index/index.js',
        code: first.transformed.code,
      },
      'pages/index/index.wxss': {
        type: 'asset' as const,
        fileName: 'pages/index/index.wxss',
        source: '.page{}',
      },
      'components/card.js': {
        type: 'chunk' as const,
        fileName: 'components/card.js',
        code: second.transformed.code,
      },
      'components/card.wxss': {
        type: 'asset' as const,
        fileName: 'components/card.wxss',
        source: '.card{}',
      },
    }
    const provider = stylexCompiler()
    if (typeof provider === 'function') {
      throw new TypeError('Expected a compiler provider object')
    }
    const context = makeContext()
    const controller = await provider.create(context as never)
    const requests = [
      {
        id: '/project/src/pages/index/index.ts',
        code: `import * as stylex from '@weapp-stylex/core'; const styles = stylex.create({root:{padding:16}}); const x=stylex.attrs(styles.root).class;`,
        kind: 'script' as const,
      },
      {
        id: '/project/src/components/card.ts',
        code: `import * as stylex from '@weapp-stylex/core'; const styles = stylex.create({root:{padding:16}}); const x=stylex.attrs(styles.root).class;`,
        kind: 'script' as const,
      },
    ]
    for (const request of requests) {
      controller.claimSource?.(request)
      await controller.transformSource?.(request)
    }
    await controller.generateBundle?.(bundle as never, context as never)

    expect(Object.keys(bundle).filter(name => /(?:^|\/)stylex\.wxss$/.test(name))).toEqual(['stylex.wxss'])
    expect(String(bundle['stylex.wxss']?.source)).toContain(
      '.sx1tamke2{padding:16px}',
    )
    expect(String(bundle['stylex.wxss']?.source)).not.toContain(
      '@layer',
    )
    expect(String(bundle['pages/index/index.wxss']?.source)).toContain(
      '@import "../../stylex.wxss";',
    )
    expect(String(bundle['components/card.wxss']?.source)).toContain(
      '@import "../stylex.wxss";',
    )
    expect(
      String(bundle['stylex.wxss']?.source).match(/padding:16px/g)?.length,
    ).toBe(1)
  })

  it('writes shared styles and isolated component companions through the read-only bundle compatibility sink', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'stylex-shared-output-'))
    try {
      const plugin = stylexCompiler()
      if (typeof plugin === 'function') {
        throw new TypeError('Expected provider')
      }
      const context = makeContext({ root, resolvedConfig: { root, build: { outDir: 'dist', watch: {} } } })
      const controller = await plugin.create(context as never)
      const sources = [
        { id: `${root}/src/pages/home/index.ts`, code: `import * as stylex from '@weapp-stylex/core';const s=stylex.create({root:{color:'red'}});Page({data:{sx:stylex.attrs(s.root).class}})`, kind: 'script' as const },
        { id: `${root}/src/components/card/index.ts`, code: `import * as stylex from '@weapp-stylex/core';const s=stylex.create({root:{padding:16}});Component({options:{styleIsolation:'isolated'},data:{sx:stylex.attrs(s.root).class}})`, kind: 'script' as const },
      ]
      for (const source of sources) {
        controller.claimSource?.(source)
        await controller.transformSource?.(source)
      }
      const entries: TestBundle = {
        'app.js': { type: 'chunk', fileName: 'app.js', code: 'App({})' },
        'app.json': { type: 'asset', fileName: 'app.json', source: '{"pages":["pages/home/index"]}' },
      }
      for (const [index, name] of ['pages/home/index', 'components/card/index'].entries()) {
        entries[`${name}.js`] = { type: 'chunk', fileName: `${name}.js`, code: '', modules: { [sources[index]!.id]: {} } }
        entries[`${name}.wxml`] = { type: 'asset', fileName: `${name}.wxml`, source: '<view class="{{sx}}" />' }
      }
      const readonlyBundle = new Proxy(entries, {
        set(target, key, value) {
          if (!(key in target)) {
            throw new Error('Host bundle does not accept new asset keys')
          }
          return Reflect.set(target, key, value)
        },
      })
      await controller.generateBundle?.(readonlyBundle as never, context as never)
      const output = path.join(root, 'dist')
      const css = await readFile(path.join(output, 'stylex.wxss'), 'utf8')
      expect(css).toContain('color:red')
      expect(css).toContain('padding:16px')
      expect(await readFile(path.join(output, 'pages/home/index.wxss'), 'utf8')).toBe('@import "../../stylex.wxss";\n')
      expect(await readFile(path.join(output, 'components/card/index.wxss'), 'utf8')).toBe('@import "../../stylex.wxss";\n')
      expect(await readdir(path.join(output, 'pages/home'))).toEqual(['index.wxss'])
      expect(await readdir(path.join(output, 'components/card'))).toEqual(['index.wxss'])

      for (const source of sources) {
        expect(controller.claimSource?.({ ...source, code: 'Page({})' })).toBe(false)
      }
      await controller.generateBundle?.(readonlyBundle as never, context as never)
      for (const name of ['stylex.wxss', 'app.wxss', 'pages/home/index.wxss', 'components/card/index.wxss']) {
        await expect(readFile(path.join(output, name))).rejects.toMatchObject({ code: 'ENOENT' })
      }
      await controller.closeWatcher?.()
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps a rootless independent child bundle and its cleanup inside its output subtree', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'stylex-child-output-'))
    try {
      const context = makeContext({ root, resolvedConfig: { root, build: { outDir: 'dist', watch: {} } } })
      const create = async () => {
        const plugin = stylexCompiler()
        if (typeof plugin === 'function') {
          throw new TypeError('Expected provider')
        }
        return plugin.create(context as never)
      }
      const parent = await create()
      const child = await create()
      const transform = async (controller: Awaited<ReturnType<typeof create>>, name: string, color: string) => {
        const id = `${root}/src/${name}.ts`
        await controller.transformSource?.({ id, kind: 'script', code: `import * as stylex from '@weapp-stylex/core';const s=stylex.create({root:{color:'${color}'}});export const sx=stylex.attrs(s.root).class` })
        return id
      }
      const parentId = await transform(parent, 'pages/home/index', 'red')
      const parentBundle: TestBundle = {
        'app.js': { type: 'chunk', fileName: 'app.js', code: 'App({})' },
        'pages/home/index.js': { type: 'chunk', fileName: 'pages/home/index.js', code: '', modules: { [parentId]: {} } },
        'pages/home/index.wxml': { type: 'asset', fileName: 'pages/home/index.wxml', source: '<view />' },
      }
      await parent.generateBundle?.(parentBundle as never, context as never)
      const parentCss = await readFile(path.join(root, 'dist/stylex.wxss'), 'utf8')
      const childBundle: TestBundle = {}
      for (const [name, color] of [['independent/pages/detail/index', 'blue'], ['independent/components/card/index', 'green']] as const) {
        const id = await transform(child, name, color)
        childBundle[`${name}.js`] = { type: 'chunk', fileName: `${name}.js`, code: '', modules: { [id]: {} } }
        childBundle[`${name}.wxml`] = { type: 'asset', fileName: `${name}.wxml`, source: '<view />' }
      }
      await child.generateBundle?.(childBundle as never, context as never)
      const childCss = await readFile(path.join(root, 'dist/independent/stylex.wxss'), 'utf8')
      expect(childCss).toContain('color:blue')
      expect(childCss).toContain('color:green')
      expect(childCss).not.toContain('color:red')
      expect(await readFile(path.join(root, 'dist/stylex.wxss'), 'utf8')).toBe(parentCss)
      for (const name of ['pages/detail/index', 'components/card/index']) {
        expect(await readFile(path.join(root, 'dist/independent', `${name}.wxss`), 'utf8')).toBe('@import "../../stylex.wxss";\n')
      }
      expect(await readFile(path.join(root, 'dist/app.wxss'), 'utf8')).toBe('@import "./stylex.wxss";\n')
      for (const chunk of Object.values(childBundle)) {
        for (const id of Object.keys(chunk.modules ?? {})) {
          expect(child.claimSource?.({ id, kind: 'script', code: 'Page({})' })).toBe(false)
        }
      }
      await child.generateBundle?.(childBundle as never, context as never)
      expect(await readFile(path.join(root, 'dist/stylex.wxss'), 'utf8')).toBe(parentCss)
      await expect(readFile(path.join(root, 'dist/independent/stylex.wxss'))).rejects.toMatchObject({ code: 'ENOENT' })
      await child.closeWatcher?.()
      await parent.closeWatcher?.()
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('creates app.wxss when there is no WXSS entry', async () => {
    const { controller, transformed, context } = await compile(`
      import * as stylex from '@weapp-stylex/core';
      const styles = stylex.create({ root: { color: 'red' } });
      const sx = stylex.attrs(styles.root).class;
    `)
    const bundle: TestBundle = {
      'pages/index/index.js': {
        type: 'chunk' as const,
        fileName: 'pages/index/index.js',
        code: transformed.code,
      },
    }
    await controller.generateBundle?.(bundle as never, context as never)
    expect(bundle['stylex.wxss']).toBeTruthy()
    expect(bundle['app.wxss']?.source).toBe('@import "./stylex.wxss";\n')
  })

  it('leaves bundles unchanged when no StyleX source is present', async () => {
    const plugin = stylexCompiler()
    if (typeof plugin === 'function') {
      throw new TypeError('Expected a compiler provider object')
    }
    const controller = await plugin.create(makeContext() as never)
    const bundle: TestBundle = {
      'pages/index/index.js': {
        type: 'chunk' as const,
        fileName: 'pages/index/index.js',
        code: 'Page({});',
      },
      'pages/index/index.wxss': {
        type: 'asset' as const,
        fileName: 'pages/index/index.wxss',
        source: '.page{}',
      },
    }
    const before = JSON.stringify(bundle)
    await controller.generateBundle?.(bundle as never, makeContext() as never)
    expect(JSON.stringify(bundle)).toBe(before)
  })

  it('prunes styles no longer present in the emitted module graph', async () => {
    const plugin = stylexCompiler()
    if (typeof plugin === 'function') {
      throw new TypeError('Expected a compiler provider object')
    }
    const context = makeContext()
    const controller = await plugin.create(context as never)
    const request = {
      id: '/project/src/pages/index/index.ts',
      code: `import * as stylex from '@weapp-stylex/core'; const styles = stylex.create({root:{color:'red'}}); const x=stylex.attrs(styles.root).class;`,
      kind: 'script' as const,
    }
    controller.claimSource?.(request)
    await controller.transformSource?.(request)
    controller.buildStart?.()
    const bundle: TestBundle = {
      'pages/index/index.js': {
        type: 'chunk' as const,
        fileName: 'pages/index/index.js',
        code: 'Page({});',
        modules: { '/project/src/other.ts': {} },
      },
    }
    await controller.generateBundle?.(bundle as never, context as never)
    expect(bundle).not.toHaveProperty('stylex.wxss')
  })

  it('reports stylex.wxss filename conflicts clearly', async () => {
    const { controller, transformed, context } = await compile(`
      import * as stylex from '@weapp-stylex/core';
      const styles = stylex.create({ root: { color: 'red' } });
      const sx = stylex.attrs(styles.root).class;
    `)
    const bundle = {
      'stylex.wxss': {
        type: 'asset' as const,
        fileName: 'stylex.wxss',
        source: '.existing{}',
      },
      'pages/index/index.js': {
        type: 'chunk' as const,
        fileName: 'pages/index/index.js',
        code: transformed.code,
      },
    }
    await expect(
      controller.generateBundle?.(bundle as never, context as never),
    ).rejects.toThrow('文件名冲突')
  })
})
