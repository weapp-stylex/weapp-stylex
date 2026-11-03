import type { StyleAsset, StyleBundle } from '../src/index'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MiniProgramStyleEmitter } from '../src/index'

function asset(fileName: string, source = ''): StyleAsset {
  return { type: 'asset', fileName, source }
}

function sink(bundle: StyleBundle) {
  const removed: string[] = []
  const emitted: string[] = []
  return {
    emit(fileName: string, source: string) {
      emitted.push(fileName)
      bundle[fileName] = asset(fileName, source)
    },
    remove(fileName: string) {
      removed.push(fileName)
    },
    removed,
    emitted,
  }
}

describe.each([
  ['weapp', 'wxml', 'wxss'],
  ['alipay', 'axml', 'acss'],
  ['tt', 'ttml', 'ttss'],
] as const)('%s shared stylesheet assets', (target, template, extension) => {
  it('stores rules once for 50 real page companions and retains component imports', async () => {
    const bundle: StyleBundle = { 'app.js': { type: 'chunk', fileName: 'app.js', code: '' } }
    for (let index = 0; index < 50; index++) {
      const stem = `pages/page-${index}/index`
      bundle[`${stem}.js`] = { type: 'chunk', fileName: `${stem}.js`, code: '' }
      bundle[`${stem}.${template}`] = asset(`${stem}.${template}`, '<view/>')
    }
    bundle['components/isolated/index.js'] = { type: 'chunk', fileName: 'components/isolated/index.js', code: '' }
    bundle[`components/isolated/index.${template}`] = asset(`components/isolated/index.${template}`, '<view/>')
    const emitter = new MiniProgramStyleEmitter(target)
    const css = '.sx-token{--accent:red}.sx{color:var(--accent)}'
    const output = sink(bundle)
    await emitter.generate(bundle, css, output)
    const globalAssets = Object.keys(bundle).filter(name => name.endsWith(`/stylex.${extension}`) || name === `stylex.${extension}`)
    expect(globalAssets).toEqual([`stylex.${extension}`])
    expect(bundle[`stylex.${extension}`]).toMatchObject({ source: css })
    expect(bundle[`pages/page-49/index.${extension}`]).toMatchObject({ source: `@import "../../stylex.${extension}";\n` })
    expect(bundle[`components/isolated/index.${extension}`]).toMatchObject({ source: `@import "../../stylex.${extension}";\n` })
    const first = JSON.stringify(bundle)
    await emitter.generate(bundle, css, output)
    expect(JSON.stringify(bundle)).toBe(first)
    await emitter.generate(bundle, '', output)
    expect(bundle[`stylex.${extension}`]).toBeUndefined()
    expect(bundle[`components/isolated/index.${extension}`]).toBeUndefined()
    expect(bundle[`pages/page-49/index.${extension}`]).toBeUndefined()
    expect(output.removed).toContain(`stylex.${extension}`)
  })
})

describe('shared stylesheet boundaries and ownership', () => {
  it('keeps an independent child build local when app.json and app.js are absent', async () => {
    const bundle: StyleBundle = {
      'standalone/pages/home/index.js': { type: 'chunk', fileName: 'standalone/pages/home/index.js', code: '' },
      'standalone/pages/home/index.wxml': asset('standalone/pages/home/index.wxml', '<view/>'),
    }
    await new MiniProgramStyleEmitter().generate(bundle, '.sx{}', sink(bundle))
    expect(bundle['standalone/pages/home/stylex.wxss']).toMatchObject({ source: '.sx{}' })
    expect(bundle['standalone/pages/home/index.wxss']).toMatchObject({ source: '@import "./stylex.wxss";\n' })
    expect(bundle['stylex.wxss']).toBeUndefined()
    expect(bundle['app.wxss']).toBeUndefined()
  })

  it('shares child page and component rules at their common directory and updates managed watch imports', async () => {
    const bundle: StyleBundle = {
      'child/pages/one/index.wxss': asset('child/pages/one/index.wxss', '.one{}'),
      'child/pages/two/index.wxss': asset('child/pages/two/index.wxss', '.two{}'),
    }
    const emitter = new MiniProgramStyleEmitter()
    const output = sink(bundle)
    await emitter.generate(bundle, '.sx{}', output)
    expect(bundle['child/pages/stylex.wxss']).toMatchObject({ source: '.sx{}' })
    expect(bundle['child/pages/one/index.wxss']).toMatchObject({ source: '@import "../stylex.wxss";\n.one{}' })
    bundle['child/components/card/index.js'] = { type: 'chunk', fileName: 'child/components/card/index.js', code: '' }
    bundle['child/components/card/index.wxml'] = asset('child/components/card/index.wxml', '<view/>')
    await emitter.generate(bundle, '.sx{}', output)
    expect(bundle['child/stylex.wxss']).toMatchObject({ source: '.sx{}' })
    expect(bundle['child/pages/stylex.wxss']).toBeUndefined()
    expect(bundle['child/pages/one/index.wxss']).toMatchObject({ source: '@import "../../stylex.wxss";\n.one{}' })
    expect(bundle['child/components/card/index.wxss']).toMatchObject({ source: '@import "../../stylex.wxss";\n' })
    expect(bundle['stylex.wxss']).toBeUndefined()
    expect(bundle['app.wxss']).toBeUndefined()
    await emitter.generate(bundle, '', output)
    expect(bundle['child/pages/one/index.wxss']).toMatchObject({ source: '.one{}' })
    expect(bundle['child/components/card/index.wxss']).toBeUndefined()
    expect(bundle['child/stylex.wxss']).toBeUndefined()
  })

  it('shares ordinary subpackages and keeps independent package imports inside their own boundary', async () => {
    const bundle: StyleBundle = {
      'app.js': { type: 'chunk', fileName: 'app.js', code: '' },
      'app.json': asset('app.json', JSON.stringify({ subPackages: [{ root: 'package' }, { root: 'independent', independent: true }] })),
      'pages/home/index.wxss': asset('pages/home/index.wxss', '.home{}'),
      'package/detail/index.wxss': asset('package/detail/index.wxss', '.detail{}'),
      'independent/settings/index.wxss': asset('independent/settings/index.wxss', '.settings{}'),
      'independent/components/card/index.wxss': asset('independent/components/card/index.wxss', '.card{}'),
    }
    const css = '.sx{padding:16px}'
    await new MiniProgramStyleEmitter().generate(bundle, css, sink(bundle))
    expect(Object.keys(bundle).filter(name => /(?:^|\/)stylex\.wxss$/.test(name)).sort()).toEqual(['independent/stylex.wxss', 'stylex.wxss'])
    expect(bundle['package/detail/index.wxss']).toMatchObject({ source: '@import "../../stylex.wxss";\n.detail{}' })
    for (const fileName of ['independent/settings/index.wxss', 'independent/components/card/index.wxss']) {
      const source = String((bundle[fileName] as StyleAsset).source)
      const request = source.match(/^@import "([^"]+)";/)![1]!
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fileName), request))
      expect(resolved).toBe('independent/stylex.wxss')
      expect(bundle[resolved]).toMatchObject({ source: css })
    }
  })

  it('updates owned imports and cleans obsolete assets when an independent boundary changes during watch', async () => {
    const bundle: StyleBundle = {
      'app.js': { type: 'chunk', fileName: 'app.js', code: '' },
      'app.json': asset('app.json', JSON.stringify({ subpackages: [{ root: 'independent', independent: true }] })),
      'independent/pages/home/index.wxss': asset('independent/pages/home/index.wxss', '.user{}'),
    }
    const emitter = new MiniProgramStyleEmitter()
    const output = sink(bundle)
    await emitter.generate(bundle, '.sx{}', output)
    expect(bundle['independent/pages/home/index.wxss']).toMatchObject({ source: '@import "../../stylex.wxss";\n.user{}' })
    bundle['app.json'] = asset('app.json', '{}')
    await emitter.generate(bundle, '.sx{}', output)
    expect(bundle['independent/stylex.wxss']).toBeUndefined()
    expect(output.removed).toContain('independent/stylex.wxss')
    expect(bundle['independent/pages/home/index.wxss']).toMatchObject({ source: '@import "../../../stylex.wxss";\n.user{}' })
    await emitter.generate(bundle, '', output)
    expect(bundle['independent/pages/home/index.wxss']).toMatchObject({ source: '.user{}' })
  })

  it('preserves user imports and handles a nested user stylesheet named stylex.wxss', async () => {
    const bundle: StyleBundle = {
      'pages/home/index.wxss': asset('pages/home/index.wxss', '@import "../../stylex.wxss";\n.user{}'),
      'components/stylex.wxss': asset('components/stylex.wxss', '.nested-user{}'),
    }
    const emitter = new MiniProgramStyleEmitter()
    const output = sink(bundle)
    await emitter.generate(bundle, '.sx{}', output)
    expect(bundle['pages/home/index.wxss']).toMatchObject({ source: '@import "../../stylex.wxss";\n.user{}' })
    expect(bundle['components/stylex.wxss']).toMatchObject({ source: '@import "../stylex.wxss";\n.nested-user{}' })
    await emitter.generate(bundle, '', output)
    expect(bundle['pages/home/index.wxss']).toMatchObject({ source: '@import "../../stylex.wxss";\n.user{}' })
    expect(bundle['components/stylex.wxss']).toMatchObject({ source: '.nested-user{}' })
  })

  it('keeps independent generated filename conflicts and user replacement files intact', async () => {
    const bundle: StyleBundle = {
      'app.json': asset('app.json', JSON.stringify({ subPackages: [{ root: 'standalone', independent: true }] })),
      'standalone/index.wxss': asset('standalone/index.wxss', '.local{}'),
      'standalone/stylex.wxss': asset('standalone/stylex.wxss', '.user{}'),
    }
    const emitter = new MiniProgramStyleEmitter()
    const output = sink(bundle)
    await expect(emitter.generate(bundle, '.sx{}', output)).rejects.toThrow('文件名冲突')
    delete bundle['standalone/stylex.wxss']
    await emitter.generate(bundle, '.sx{}', output)
    bundle['standalone/stylex.wxss'] = asset('standalone/stylex.wxss', '.replacement{}')
    await expect(emitter.generate(bundle, '.sx{}', output)).rejects.toThrow('文件名冲突')
    await emitter.generate(bundle, '', output)
    expect(bundle['standalone/stylex.wxss']).toMatchObject({ source: '.replacement{}' })
    expect(output.removed).not.toContain('standalone/stylex.wxss')
  })

  it('uses POSIX imports for Windows consumer paths and rejects unsafe independent roots', async () => {
    const bundle: StyleBundle = { 'pages\\home\\index.wxss': asset('pages\\home\\index.wxss', '.user{}') }
    await new MiniProgramStyleEmitter().generate(bundle, '.sx{}', sink(bundle))
    expect(bundle['pages\\home\\index.wxss']).toMatchObject({ source: '@import "./stylex.wxss";\n.user{}' })
    expect(bundle['pages/home/stylex.wxss']).toMatchObject({ source: '.sx{}' })
    for (const roots of [['../escape'], ['/absolute'], ['C:\\absolute'], ['a\\b'], ['a', 'a/child'], ['a', 'a']]) {
      const invalid: StyleBundle = {
        'app.json': asset('app.json', JSON.stringify({ subPackages: roots.map(root => ({ root, independent: true })) })),
        'app.wxss': asset('app.wxss', '.user{}'),
      }
      await expect(new MiniProgramStyleEmitter().generate(invalid, '.sx{}', sink(invalid))).rejects.toThrow()
      expect(Object.keys(invalid)).toEqual(['app.json', 'app.wxss'])
    }
  })

  it('rejects a Windows authored stylesheet at the planned physical output before mutation', async () => {
    const bundle: StyleBundle = {
      'child\\pages\\home\\index.wxss': asset('child\\pages\\home\\index.wxss', '.home{}'),
      'child\\pages\\stylex.wxss': asset('child\\pages\\stylex.wxss', '.user{}'),
    }
    const before = JSON.stringify(bundle)
    const output = sink(bundle)
    await expect(new MiniProgramStyleEmitter().generate(bundle, '.sx{}', output)).rejects.toThrow('文件名冲突')
    expect(JSON.stringify(bundle)).toBe(before)
    expect(output.emitted).toEqual([])
    expect(output.removed).toEqual([])
  })

  it('rejects physical path aliases and mismatched bundle paths before mutation', async () => {
    const bundles: StyleBundle[] = [
      {
        'child/pages/index.wxss': asset('child/pages/index.wxss', '.one{}'),
        'child\\pages\\index.wxss': asset('child\\pages\\index.wxss', '.two{}'),
      },
      { 'child/pages/index.wxss': asset('other/index.wxss', '.user{}') },
    ]
    for (const bundle of bundles) {
      const before = JSON.stringify(bundle)
      const output = sink(bundle)
      await expect(new MiniProgramStyleEmitter().generate(bundle, '.sx{}', output)).rejects.toThrow(/physical output path|does not match/)
      expect(JSON.stringify(bundle)).toBe(before)
      expect(output.emitted).toEqual([])
      expect(output.removed).toEqual([])
    }
  })

  it('canonicalizes owned Windows aliases on re-emission and removes their real keys on cleanup', async () => {
    const bundle: StyleBundle = {
      'child\\pages\\home\\index.js': { type: 'chunk', fileName: 'child\\pages\\home\\index.js', code: '' },
      'child\\pages\\home\\index.wxml': asset('child\\pages\\home\\index.wxml', '<view/>'),
    }
    const emitter = new MiniProgramStyleEmitter()
    const output = sink(bundle)
    const shared = 'child/pages/home/stylex.wxss'
    const companion = 'child/pages/home/index.wxss'
    const alias = (fileName: string) => {
      const generated = bundle[fileName]!
      delete bundle[fileName]
      generated.fileName = fileName.replaceAll('/', '\\')
      bundle[generated.fileName] = generated
      return generated.fileName
    }
    await emitter.generate(bundle, '.sx{}', output)
    const sharedAlias = alias(shared)
    const companionAlias = alias(companion)
    await emitter.generate(bundle, '.sx{color:red}', output)
    expect(bundle[sharedAlias]).toBeUndefined()
    expect(bundle[companionAlias]).toBeUndefined()
    expect(bundle[shared]).toMatchObject({ source: '.sx{color:red}' })
    expect(bundle[companion]).toMatchObject({ source: '@import "./stylex.wxss";\n' })
    alias(shared)
    alias(companion)
    await emitter.generate(bundle, '', output)
    expect(bundle[sharedAlias]).toBeUndefined()
    expect(bundle[companionAlias]).toBeUndefined()
    expect(bundle[shared]).toBeUndefined()
    expect(bundle[companion]).toBeUndefined()
    expect(output.removed.sort()).toEqual([companion, shared].sort())
  })

  it('preserves a user replacement of an owned shared asset through a Windows alias', async () => {
    const bundle: StyleBundle = { 'child/pages/home/index.wxss': asset('child/pages/home/index.wxss', '.home{}') }
    const emitter = new MiniProgramStyleEmitter()
    const output = sink(bundle)
    await emitter.generate(bundle, '.sx{}', output)
    delete bundle['child/pages/home/stylex.wxss']
    bundle['child\\pages\\home\\stylex.wxss'] = asset('child\\pages\\home\\stylex.wxss', '.replacement{}')
    const before = JSON.stringify(bundle)
    await expect(emitter.generate(bundle, '.sx{}', output)).rejects.toThrow('文件名冲突')
    expect(JSON.stringify(bundle)).toBe(before)
    await emitter.generate(bundle, '', output)
    expect(bundle['child\\pages\\home\\stylex.wxss']).toMatchObject({ source: '.replacement{}' })
    expect(bundle['child/pages/home/index.wxss']).toMatchObject({ source: '.home{}' })
    expect(output.removed).toEqual([])
  })

  it('rejects malformed application package metadata before emitting or rewriting styles', async () => {
    for (const config of ['{', 'null', '[]', '{"subPackages":{}}', '{"subPackages":[],"subpackages":[]}', '{"subPackages":[{"independent":true}]}']) {
      const bundle: StyleBundle = {
        'app.json': asset('app.json', config),
        'app.wxss': asset('app.wxss', '.user{}'),
      }
      const before = JSON.stringify(bundle)
      await expect(new MiniProgramStyleEmitter().generate(bundle, '.sx{}', sink(bundle))).rejects.toThrow()
      expect(JSON.stringify(bundle)).toBe(before)
    }
  })
})
