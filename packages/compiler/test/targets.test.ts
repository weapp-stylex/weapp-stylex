import type { StyleBundle, StylexTarget } from '../src/index'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createVitePlugins, MiniProgramStyleEmitter, resolveStylexTarget, StylexSession, WxssEmitter } from '../src/index'

const host = { resolve: async () => undefined, addWatchFile() {} }
const source = `import * as stylex from 'weapp-stylex';
export const tokens=stylex.defineVars({accent:'red'});
export const theme=stylex.createTheme(tokens,{accent:'blue'});
export const styles=stylex.create({root:{padding:16,marginTop:'12rpx'}});`

describe('platform compilation', () => {
  it('keeps official JavaScript identities across targets and selects the correct variable root', async () => {
    const results = await Promise.all((['weapp', 'alipay', 'tt', 'web'] as const).map(async (target) => {
      const session = new StylexSession({ target })
      const transformed = await session.transform(source, '/fixture/tokens.stylex.ts', host)
      return { target, transformed, css: session.css(), fingerprint: session.fingerprint }
    }))
    expect(new Set(results.map(result => result.transformed!.code)).size).toBe(1)
    expect(new Set(results.map(result => result.fingerprint)).size).toBe(4)
    for (const { target, css } of results) {
      expect(css).toContain('padding:16px')
      expect(css).toContain('margin-top:12rpx')
      expect(css).not.toMatch(/@layer|:not\(#/)
      if (target === 'web') {
        expect(css).toContain(':root')
        expect(css).not.toMatch(/(?:^|\n)page/)
      }
      else {
        expect(css).toContain('page')
        expect(css).not.toContain(':root')
      }
    }
    expect(new StylexSession().fingerprint).toBe(new StylexSession({ target: 'weapp' }).fingerprint)
  })

  it('rejects unsupported and conflicting host targets', () => {
    expect(() => new StylexSession({ target: 'unknown' as StylexTarget })).toThrow('Unsupported StyleX target')
    expect(resolveStylexTarget({ backend: 'babel' }, 'alipay')).toEqual({ backend: 'babel', target: 'alipay' })
    expect(() => resolveStylexTarget({ target: 'weapp' }, 'web')).toThrow('conflicts')
    expect(() => new MiniProgramStyleEmitter('web' as 'weapp')).toThrow('browser CSS')
  })

  it('isolates Vite emitter targets and output ownership when the host reuses plugin instances', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'stylex-targets-'))
    try {
      const id = path.join(root, 'tokens.stylex.ts')
      let session = new StylexSession({ target: 'weapp' })
      await session.transform(source, id, host)
      const output = createVitePlugins(() => session).find(plugin => plugin.name === 'weapp-stylex:output')!
      if (!output.configResolved || !output.generateBundle) {
        throw new TypeError('Expected Vite output hooks')
      }
      const context = (bundle: StyleBundle) => ({
        getModuleIds: () => [id].values(),
        emitFile(asset: { type: 'asset', fileName: string, source: string }) {
          bundle[asset.fileName] = asset
          return asset.fileName
        },
      })
      output.configResolved({ root, command: 'build', build: { outDir: 'wechat', watch: {} } })
      const wechat: StyleBundle = { 'app.js': { type: 'chunk', fileName: 'app.js', code: '' } }
      await output.generateBundle.handler.call(context(wechat) as never, {}, wechat)
      expect(wechat['stylex.wxss']).toBeDefined()

      session = new StylexSession({ target: 'alipay' })
      await session.transform(source, id, host)
      output.configResolved({ root, command: 'build', build: { outDir: 'alipay', watch: {} } })
      const alipay: StyleBundle = { 'app.js': { type: 'chunk', fileName: 'app.js', code: '' } }
      await output.generateBundle.handler.call(context(alipay) as never, {}, alipay)
      expect(alipay['stylex.acss']).toBeDefined()
      expect(alipay['stylex.wxss']).toBeUndefined()

      // A later output directory must not inherit ownership from an earlier one.
      const userStyle = path.join(root, 'empty/stylex.acss')
      await mkdir(path.dirname(userStyle), { recursive: true })
      await writeFile(userStyle, '.user-owned{}')
      session = new StylexSession({ target: 'alipay' })
      output.configResolved({ root, command: 'build', build: { outDir: 'empty', watch: {} } })
      const empty: StyleBundle = { 'app.js': { type: 'chunk', fileName: 'app.js', code: '' } }
      await output.generateBundle.handler.call(context(empty) as never, {}, empty)
      expect(await readFile(userStyle, 'utf8')).toBe('.user-owned{}')
      expect(Object.keys(empty)).toEqual(['app.js'])
      output.closeWatcher?.()
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe.each([
  ['weapp', 'wxml', 'wxss'],
  ['alipay', 'axml', 'acss'],
  ['tt', 'ttml', 'ttss'],
] as const)('%s style ownership', (target, template, extension) => {
  it('adds isolated companions, leaves other platforms alone, and removes only owned output', async () => {
    const emitter = new MiniProgramStyleEmitter(target)
    const bundle: StyleBundle = {
      'app.js': { type: 'chunk', fileName: 'app.js', code: '' },
      'components/card.js': { type: 'chunk', fileName: 'components/card.js', code: '' },
      [`components/card.${template}`]: { type: 'asset', fileName: `components/card.${template}`, source: '<view />' },
      [`pages/index.${extension}`]: { type: 'asset', fileName: `pages/index.${extension}`, source: '.local{}' },
      'unrelated.css': { type: 'asset', fileName: 'unrelated.css', source: '.untouched{}' },
    }
    const original = JSON.stringify(bundle)
    const emit = (fileName: string, text: string) => {
      bundle[fileName] = { type: 'asset', fileName, source: text }
    }
    await emitter.generate(bundle, '', { emit })
    expect(JSON.stringify(bundle)).toBe(original)
    await emitter.generate(bundle, '.sx{padding:16px}', { emit })
    expect(bundle[`components/card.${extension}`]).toMatchObject({ source: `@import "./stylex.${extension}";\n` })
    expect(bundle[`pages/index.${extension}`]).toMatchObject({ source: `@import "./stylex.${extension}";\n.local{}` })
    expect(bundle['unrelated.css']).toMatchObject({ source: '.untouched{}' })
    const first = JSON.stringify(bundle)
    await emitter.generate(bundle, '.sx{padding:16px}', { emit })
    expect(JSON.stringify(bundle)).toBe(first)
    bundle[`stylex.${extension}`] = { type: 'asset', fileName: `stylex.${extension}`, source: '.user{}' }
    await expect(emitter.generate(bundle, '.sx{}', { emit })).rejects.toThrow('文件名冲突')
    await emitter.generate(bundle, '', { emit })
    expect(bundle[`components/card.${extension}`]).toBeUndefined()
    expect(bundle[`pages/index.${extension}`]).toMatchObject({ source: '.local{}' })
    expect(bundle[`stylex.${extension}`]).toMatchObject({ source: '.user{}' })
  })
})

it('retains the original WeChat emitter entry point', () => {
  expect(new WxssEmitter()).toBeInstanceOf(MiniProgramStyleEmitter)
  expect(new WxssEmitter().extensions).toEqual({ template: 'wxml', style: 'wxss' })
})
