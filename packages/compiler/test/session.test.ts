import type { StyleBundle, TransformHost } from '../src/index'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { StylexSession, WxssEmitter } from '../src/index'

const directories: string[] = []
async function fixture() {
  const artifacts = path.resolve(import.meta.dirname, '../artifacts')
  await mkdir(artifacts, { recursive: true })
  const root = await mkdtemp(path.join(artifacts, 'unit-'))
  directories.push(root)
  await writeFile(
    path.join(root, 'package.json'),
    '{"name":"stylex-fixture","type":"module"}',
  )
  const watched = new Set<string>()
  const host: TransformHost = {
    resolve: async source =>
      path.join(
        root,
        source.replace('@styles/', '').replace('./', '')
        + (source.endsWith('.js') ? '' : '.ts'),
      ),
    addWatchFile: (id) => {
      watched.add(id)
    },
  }
  return { root, host, watched }
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true })),
  )
})
const runtime = pathToFileURL(
  path.resolve(import.meta.dirname, '../../core/dist/index.js'),
).href
async function execute(code: string, file: string) {
  await writeFile(file, code.replaceAll('@weapp-stylex/core', runtime))
  return import(pathToFileURL(file).href)
}

describe('shared StyleX compilation', () => {
  it.each(['babel', 'auto'] as const)('preserves shared named/default/barrel exports and runtime merges (%s)', async (backend) => {
    const { root, host } = await fixture()
    const session = new StylexSession({ backend })
    const defining = await session.transform(
      `import * as stylex from '@weapp-stylex/core';
      export const styles = stylex.create({base:{color:'red',padding:16}, override:{color:'blue'}, active:{opacity:0.6}, dynamic:width=>({width})});
      export default styles;`,
      path.join(root, 'shared.js'),
      host,
    )
    expect(defining!.code).not.toContain('stylex.create')
    await execute(defining!.code, path.join(root, 'shared.js'))
    await writeFile(
      path.join(root, 'barrel.js'),
      'export { default, styles } from \'./shared.js\'',
    )
    const consumer = await session.transform(
      `import * as stylex from '@weapp-stylex/core';
      import styles from './barrel.js';
      export const base=stylex.attrs(styles.base).class;
      export const override=stylex.attrs(styles.override).class;
      export const merged=stylex.attrs(styles.base,styles.override,true&&styles.active);
      export const dynamic=stylex.attrs(styles.dynamic(80));`,
      path.join(root, 'consumer.js'),
      host,
    )
    expect(consumer!.rules).toHaveLength(0)
    const values = await execute(
      consumer!.code,
      path.join(root, 'consumer.js'),
    )
    expect(values.merged.class).toContain(values.override)
    const redClass = defining!.rules.find(rule =>
      rule[1].ltr.includes('color:red'),
    )![0]
    expect(values.merged.class.split(' ')).not.toContain(redClass)
    expect(values.merged.class).toContain('sx')
    expect(values.dynamic.style).toContain('80px')
    expect(session.css()).toContain('padding:16px')
    expect(session.css()).toContain('color:red')
    expect(session.css()).toContain('color:blue')
  })

  it('resolves aliased tokens consistently and maps default variables to page', async () => {
    const { root, host, watched } = await fixture()
    const session = new StylexSession()
    const tokenId = path.join(root, 'tokens.stylex.ts')
    const tokenSource = 'import * as stylex from \'@weapp-stylex/core\';export const tokens=stylex.defineVars({accent:\'red\'});'
    await writeFile(tokenId, tokenSource)
    const tokens = await session.transform(
      tokenSource,
      tokenId,
      host,
    )
    const useId = path.join(root, 'use.ts')
    const styles = await session.transform(
      'import * as stylex from \'@weapp-stylex/core\';import {tokens} from \'@styles/tokens.stylex\';export const styles=stylex.create({root:{color:tokens.accent}});',
      useId,
      host,
    )
    const variable = tokens!.code.match(/var\((--[^)]+)\)/)![1]
    expect(styles!.rules[0]![1].ltr).toContain(`var(${variable})`)
    expect(watched.has(tokenId)).toBe(true)
    expect(styles!.rules.some(rule => rule[1].ltr.includes(':red'))).toBe(true)
    expect(session.css()).toContain(`page`)
    expect(session.css()).not.toContain(':root')
    await session.transform(
      'import * as stylex from \'@weapp-stylex/core\';import {tokens} from \'./tokens.stylex\';export const theme=stylex.createTheme(tokens,{accent:\'blue\'});',
      path.join(root, 'themes.ts'),
      host,
    )
    expect(session.css()).toMatch(/page\.sx\w+\.sx\w+/)
    session.prune([useId, path.join(root, 'themes.ts')])
    expect(session.modules.has(tokenId)).toBe(true)
    expect(session.css()).toContain(':red')
    session.change(tokenId)
    expect(session.dirty.has(useId)).toBe(true)
  })

  it('collects erased token imports without the host transforming the definition module', async () => {
    const { root, host } = await fixture()
    const session = new StylexSession()
    const tokenId = path.join(root, 'tokens.stylex.ts')
    const useId = path.join(root, 'use.ts')
    const source = 'import * as stylex from \'@weapp-stylex/core\';import {tokens} from \'@styles/tokens.stylex\';export const styles=stylex.create({root:{color:tokens.accent}});'
    await writeFile(tokenId, 'import * as stylex from \'@weapp-stylex/core\';export const tokens=stylex.defineVars({accent:\'orange\'});')
    await session.transform(source, useId, host)
    session.prune([useId])
    expect(session.css()).toMatch(/page(?:\s*,[^{}]*)?\{[^}]*:orange/)
    await writeFile(tokenId, 'import * as stylex from \'@weapp-stylex/core\';export const tokens=stylex.defineVars({accent:\'purple\'});')
    session.change(tokenId)
    expect(session.dirty.has(useId)).toBe(true)
    await session.transform(source, useId, host)
    expect(session.css()).toMatch(/page(?:\s*,[^{}]*)?\{[^}]*:purple/)
    expect(session.css()).not.toContain('orange')
    session.prune([])
    expect(session.css()).toBe('')
  })

  it('transforms both SFC scripts, preserves template/style, and maps back to the SFC', async () => {
    const { root, host } = await fixture()
    const session = new StylexSession()
    const id = path.join(root, 'Page.vue')
    const source = `<script lang="ts">
import * as stylex from '@weapp-stylex/core'
export const base=stylex.create({root:{color:'red'}})
</script>
<script setup lang="ts">
import * as sx from '@weapp-stylex/core'
const styles=sx.create({active:{opacity:0.6}})
const label='mapped line'
</script>
<template><view>{{ label }}</view></template>
<style scoped>.local { color: blue }</style>`
    const result = await session.transform(source, id, host)
    expect(result!.code).not.toMatch(/(?:stylex|sx)\.create\(/)
    expect(result!.code).toContain(
      '<template><view>{{ label }}</view></template>',
    )
    expect(result!.code).toContain(
      '<style scoped>.local { color: blue }</style>',
    )
    const map = JSON.parse(result!.map!)
    expect(map.sources).toContain(id)
    expect(map.sourcesContent).toContain(source)
    expect(session.modules.get(id)!.rules).toHaveLength(2)
    expect(
      await session.transform('generated JS', `${id}?vue&type=script`, host),
    ).toBeNull()
    expect(session.modules.get(id)!.rules).toHaveLength(2)
  })

  it('retains cached rules, replaces edited rules, and prunes unreachable/deleted modules', async () => {
    const { root, host } = await fixture()
    const session = new StylexSession()
    const id = path.join(root, 'shared.ts')
    const source
      = 'import * as stylex from \'@weapp-stylex/core\';export const styles=stylex.create({root:{color:\'red\'}})'
    await session.transform(source, id, host)
    session.prune([id])
    expect(session.css()).toContain('color:red')
    session.change(id)
    await session.transform(source.replace('red', 'blue'), id, host)
    expect(session.css()).not.toContain('color:red')
    expect(session.css()).toContain('color:blue')
    await session.transform(source, id, host)
    session.prune([])
    expect(session.css()).toBe('')
    await session.transform(source, id, host)
    session.change(id, true)
    expect(session.css()).toBe('')
  })

  it('deduplicates declarations while preserving explicit rpx and disabling browser selectors', async () => {
    const { root, host } = await fixture()
    const session = new StylexSession()
    const source
      = 'import * as stylex from \'@weapp-stylex/core\';export const styles=stylex.create({root:{padding:16,marginTop:\'12rpx\'}})'
    await session.transform(source, path.join(root, 'a.ts'), host)
    await session.transform(source, path.join(root, 'b.ts'), host)
    expect(session.css().match(/padding:16px/g)).toHaveLength(1)
    expect(session.css()).toContain('margin-top:12rpx')
    expect(session.css()).not.toMatch(/@layer|:not\(#|:root/)
  })
})

describe('WXSS ownership', () => {
  it('preserves new user companion styles and rejects collisions introduced during watch', async () => {
    const emitter = new WxssEmitter()
    const bundle: StyleBundle = {
      'app.js': { type: 'chunk', fileName: 'app.js', code: '' },
    }
    const emit = (fileName: string, source: string) => {
      bundle[fileName] = { type: 'asset', fileName, source }
    }
    await emitter.generate(bundle, '.sx{}', { emit })
    bundle['app.wxss'] = {
      type: 'asset',
      fileName: 'app.wxss',
      source: '.new-user{}',
    }
    await emitter.generate(bundle, '.sx{}', { emit })
    expect(bundle['app.wxss']).toMatchObject({
      source: '@import "./stylex.wxss";\n.new-user{}',
    })
    bundle['stylex.wxss'] = { type: 'asset', fileName: 'stylex.wxss', source: '.sx{}' }
    await expect(emitter.generate(bundle, '.sx{}', { emit })).rejects.toThrow('文件名冲突')
    bundle['stylex.wxss'] = {
      type: 'asset',
      fileName: 'stylex.wxss',
      source: '.user{}',
    }
    await expect(emitter.generate(bundle, '.sx{}', { emit })).rejects.toThrow(
      '文件名冲突',
    )
    await emitter.generate(bundle, '', { emit })
    expect(bundle['app.wxss']).toMatchObject({ source: '.new-user{}' })
    expect(bundle['stylex.wxss']).toMatchObject({ source: '.user{}' })
  })
  it('creates isolated component companions, is idempotent, and removes only owned output', async () => {
    const emitter = new WxssEmitter()
    const bundle: StyleBundle = {
      'app.js': { type: 'chunk', fileName: 'app.js', code: '' },
      'components/card.js': {
        type: 'chunk',
        fileName: 'components/card.js',
        code: '',
      },
      'components/card.wxml': {
        type: 'asset',
        fileName: 'components/card.wxml',
        source: '<view />',
      },
      'pages/index.wxss': {
        type: 'asset',
        fileName: 'pages/index.wxss',
        source: '.user{}',
      },
    }
    const emit = (fileName: string, source: string) => {
      bundle[fileName] = { type: 'asset', fileName, source }
    }
    await emitter.generate(bundle, '.sx{padding:16px}', { emit })
    expect(bundle['components/card.wxss']).toMatchObject({
      source: '@import "./stylex.wxss";\n',
    })
    expect(bundle['components/stylex.wxss']).toBeDefined()
    const initial = JSON.stringify(bundle)
    await emitter.generate(bundle, '.sx{padding:16px}', { emit })
    expect(JSON.stringify(bundle)).toBe(initial)
    await emitter.generate(bundle, '', { emit })
    expect(bundle['components/card.wxss']).toBeUndefined()
    expect(bundle['app.wxss']).toBeUndefined()
    expect(bundle['pages/index.wxss']).toMatchObject({ source: '.user{}' })
  })
  it('does not mutate a build without StyleX and rejects a user filename collision', async () => {
    const bundle: StyleBundle = {
      'app.wxss': { type: 'asset', fileName: 'app.wxss', source: '.user{}' },
    }
    const emitter = new WxssEmitter()
    const original = JSON.stringify(bundle)
    await emitter.generate(bundle, '', {
      emit: () => {
        throw new Error('Unexpected emission')
      },
    })
    expect(JSON.stringify(bundle)).toBe(original)
    bundle['stylex.wxss'] = {
      type: 'asset',
      fileName: 'stylex.wxss',
      source: '.user-owned{}',
    }
    await expect(
      emitter.generate(bundle, '.sx{}', { emit: () => {} }),
    ).rejects.toThrow('文件名冲突')
    expect(bundle['stylex.wxss']).toMatchObject({ source: '.user-owned{}' })
    await expect(
      new WxssEmitter().generate(
        {
          'stylex.js': { type: 'chunk', fileName: 'stylex.js', code: '' },
          'stylex.wxml': {
            type: 'asset',
            fileName: 'stylex.wxml',
            source: '<view />',
          },
        },
        '.sx{}',
        { emit: () => {} },
      ),
    ).rejects.toThrow('文件名冲突')
  })
})
