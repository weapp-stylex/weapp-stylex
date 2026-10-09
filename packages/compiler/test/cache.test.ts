import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { StylexSession } from '../src/index'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})
const prefix = 'import * as stylex from \'@weapp-stylex/core\';'
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'stylex-cache-')))
  directories.push(root)
  await writeFile(path.join(root, 'package.json'), '{"name":"cache-fixture"}')
  const token = path.join(root, 'tokens.stylex.ts')
  await writeFile(token, `${prefix}export const tokens=stylex.defineVars({accent:'red'});`)
  const watched = new Set<string>()
  const host = { resolve: async () => token, addWatchFile: (id: string) => {
    watched.add(id)
  } }
  return { root, token, host, watched }
}
it('coalesces concurrent token reads/transforms and replays dependencies to every host', async () => {
  const { root, token, host } = await fixture()
  const session = new StylexSession()
  const code = `${prefix}import {tokens} from './tokens.stylex';export const styles=stylex.create({root:{color:tokens.accent}})`
  const watched = new Set<string>()
  await Promise.all(['a', 'b'].map(name => session.transform(code, path.join(root, `${name}.ts`), { ...host, addWatchFile: (id) => {
    watched.add(id)
  } })))
  expect(session.getStats()).toMatchObject({ tokenReads: 1, babelTransforms: 3, parses: 3 })
  expect(watched.has(token)).toBe(true)
  const before = session.getStats().babelTransforms
  await session.transform(code, path.join(root, 'a.ts'), host)
  expect(session.getStats().babelTransforms).toBe(before)
  expect(session.css()).toContain(':red')
})
it('leaves runtime dependencies to the bundler but finds imports through local constants', async () => {
  const { root, host } = await fixture()
  const session = new StylexSession()
  await session.transform(`${prefix}import {View} from '@tarojs/components';import {styles} from './shared';export const attrs=stylex.attrs(styles.root);`, path.join(root, 'runtime.ts'), { ...host, resolve: async () => {
    throw new Error('runtime imports must not be resolved')
  } })
  expect(session.getStats().resolutions).toBe(0)
  await expect(session.transform(`${prefix}import {tokens} from '@tokens';const accent=tokens.accent;export const styles=stylex.create({root:{color:accent}});`, path.join(root, 'compile.ts'), host)).rejects.toThrow('Could not resolve the path')
  expect(session.getStats().resolutions).toBe(1)
})
it('revalidates changed token files between builds even without watch events', async () => {
  const { root, token, host } = await fixture()
  const session = new StylexSession()
  const file = path.join(root, 'use.ts')
  const code = `${prefix}import {tokens} from './tokens.stylex';export const styles=stylex.create({root:{color:tokens.accent}})`
  await session.transform(code, file, host)
  await writeFile(token, `${prefix}export const tokens=stylex.defineVars({accent:'purple'});`)
  session.beginBuild()
  await session.transform(code, file, host)
  expect(session.css()).toContain(':purple')
  expect(session.css()).not.toContain(':red')
  await rm(token)
  session.beginBuild()
  await expect(session.transform(code, file, host)).rejects.toThrow()
})
it('invalidates dependents and canonical identities on manifest changes', async () => {
  const { root, host, watched } = await fixture()
  const session = new StylexSession()
  const file = path.join(root, 'use.ts')
  const code = `${prefix}import {tokens} from './tokens.stylex';export const styles=stylex.create({root:{color:tokens.accent}})`
  const before = await session.transform(code, file, host)
  const manifest = path.join(root, 'package.json')
  expect(watched.has(manifest)).toBe(true)
  await writeFile(manifest, '{"name":"renamed-fixture"}')
  session.change(manifest)
  expect(session.dirty.has(file)).toBe(true)
  const after = await session.transform(code, file, host)
  expect(after!.code).not.toBe(before!.code)
})
it('does not resurrect a deleted module when an old resolver finishes', async () => {
  const { root, host } = await fixture()
  const session = new StylexSession()
  const id = path.join(root, 'use.ts')
  let finish!: (id: string) => void
  const resolving = new Promise<string>((resolve) => {
    finish = resolve
  })
  const work = session.transform(`${prefix}import {tokens} from './tokens.stylex';export const styles=stylex.create({root:{color:tokens.accent}})`, id, { ...host, resolve: () => resolving })
  session.change(id, true)
  finish(path.join(root, 'tokens.stylex.ts'))
  await work
  expect(session.modules.has(id)).toBe(false)
  expect(session.css()).toBe('')
})
it('rejects concurrent cyclic token dependencies without deadlocking', async () => {
  const { root, host } = await fixture()
  const a = path.join(root, 'a.stylex.ts')
  const b = path.join(root, 'b.stylex.ts')
  const ac = `${prefix}import {b} from './b.stylex';export const a=stylex.defineVars({accent:b.accent});`
  const bc = `${prefix}import {a} from './a.stylex';export const b=stylex.defineVars({accent:a.accent});`
  await writeFile(a, ac)
  await writeFile(b, bc)
  const session = new StylexSession()
  const resolving = { ...host, resolve: async (source: string) => source.includes('a.stylex') ? a : b }
  const results = await Promise.allSettled([session.transform(ac, a, resolving), session.transform(bc, b, resolving)])
  expect(results.every(result => result.status === 'rejected')).toBe(true)
})
it('evicts failed work and clears caches at final shutdown', async () => {
  const { root, host } = await fixture()
  const session = new StylexSession()
  const file = path.join(root, 'use.ts')
  await expect(session.transform(`${prefix}export const styles=stylex.create({root:{color:unknown}})`, file, host)).rejects.toThrow()
  const code = `${prefix}export const styles=stylex.create({root:{color:'blue'}})`
  await session.transform(code, file, host)
  expect(session.css()).toContain('color:blue')
  const before = session.getStats().babelTransforms
  session.clear()
  await session.transform(code, file, host)
  expect(session.getStats().babelTransforms).toBe(before + 1)
})
it('coalesces identical requests and prevents removed imports from reviving old work', async () => {
  const { root, host, token } = await fixture()
  const session = new StylexSession()
  const file = path.join(root, 'shared.ts')
  const code = `${prefix}export const styles=stylex.create({root:{padding:16}})`
  await Promise.all(Array.from({ length: 8 }, () => session.transform(code, file, host)))
  expect(session.getStats()).toMatchObject({ parses: 1, babelTransforms: 1 })
  let finish!: (id: string) => void
  const pending = session.transform(`${prefix}import {tokens} from './tokens.stylex';export const styles=stylex.create({root:{color:tokens.accent}})`, file, { ...host, resolve: () => new Promise((resolve) => {
    finish = resolve
  }) })
  await session.transform('export const removed=true', file, host)
  finish(token)
  await pending
  expect(session.css()).toBe('')
})
it('retains separate caches for both SFC scripts and invalidates configuration changes', async () => {
  const { root, host } = await fixture()
  const session = new StylexSession()
  const file = path.join(root, 'Page.vue')
  const code = `<script lang="ts">${prefix}export const styles=stylex.create({root:{padding:16}})</script><script setup lang="ts">${prefix}const styles=stylex.create({root:{color:'red'}});defineProps<{active:boolean}>()</script><template><view /></template><style>.local{}</style>`
  await session.transform(code, file, host)
  session.beginBuild()
  await session.transform(code, file, host)
  expect(session.getStats()).toMatchObject({ parses: 2, babelTransforms: 2, cacheHits: 2 })
  session.change(path.join(root, 'vite.config.ts'))
  expect(session.dirty.has(file)).toBe(true)
  await session.transform(code, file, host)
  expect(session.getStats().babelTransforms).toBe(4)
})
it('refreshes a retained token owner when the host erased its runtime import', async () => {
  const { root, host, token } = await fixture()
  const session = new StylexSession({ backend: 'auto' })
  await session.transform(`${prefix}export const tokens=stylex.defineVars({accent:'red'});`, token, host)
  const file = path.join(root, 'use.ts')
  const source = `${prefix}import {tokens} from './tokens.stylex';export const styles=stylex.create({root:{color:tokens.accent}})`
  await session.transform(source, file, host)
  await writeFile(token, `${prefix}export const tokens=stylex.defineVars({accent:'purple'});`)
  session.change(token)
  await session.transform(source, file, host)
  session.prune([file])
  expect(session.css()).toContain(':purple')
  expect(session.css()).not.toContain(':red')
})
it('invalidates a source reached through a symlink after its physical file is deleted', async () => {
  const { root, host } = await fixture()
  const physical = path.join(root, 'physical.ts')
  const alias = path.join(root, 'alias.ts')
  const source = `${prefix}export const styles=stylex.create({root:{color:'red'}})`
  await writeFile(physical, source)
  await symlink(physical, alias)
  const session = new StylexSession()
  await session.transform(source, alias, host)
  await rm(physical)
  session.change(alias, true)
  expect(session.css()).toBe('')
  expect(session.modules.has(physical)).toBe(false)
})
it('reports a token syntax error at the token file, including when consumed from an SFC', async () => {
  const { root, host, token } = await fixture()
  await writeFile(token, `${prefix}\nexport const tokens = ;`)
  const file = path.join(root, 'Page.vue')
  const errors: { file: string, line?: number }[] = []
  await expect(new StylexSession({ backend: 'auto' }).transform(`<script setup lang="ts">\n${prefix}\nimport {tokens} from './tokens.stylex';\nconst styles=stylex.create({root:{color:tokens.accent}})\n</script><template><view /></template>`, file, {
    ...host,
    diagnostic: (diagnostic) => {
      if (diagnostic.level === 'error') {
        errors.push(diagnostic)
      }
    },
  })).rejects.toThrow('Unexpected token')
  expect(errors).toEqual([expect.objectContaining({ file: token, line: 2 })])
})
