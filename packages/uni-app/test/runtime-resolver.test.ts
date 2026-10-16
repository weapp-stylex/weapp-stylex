import type { PluginHost } from '@weapp-stylex/compiler'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createRuntimeResolver } from '../src/runtime-resolver.js'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'stylex-uni-runtime-')))
  directories.push(directory)
  const facade = path.join(directory, 'node_modules/.pnpm/facade/node_modules/weapp-stylex')
  const core = path.join(directory, 'node_modules/.pnpm/core/node_modules/@weapp-stylex/core')
  const runtime = path.join(directory, 'node_modules/.pnpm/runtime/node_modules/@stylexjs/stylex')
  for (const [location, name] of [[facade, 'weapp-stylex'], [core, '@weapp-stylex/core'], [runtime, '@stylexjs/stylex']]) {
    await mkdir(path.join(location!, 'dist'), { recursive: true })
    await writeFile(path.join(location!, 'package.json'), JSON.stringify({ name }))
    await writeFile(path.join(location!, 'dist/index.js'), '')
  }
  const facadeLink = path.join(directory, 'node_modules/weapp-stylex')
  const coreLink = path.join(facade, '../@weapp-stylex/core')
  const runtimeLink = path.join(core, '../../@stylexjs/stylex')
  await mkdir(path.dirname(coreLink), { recursive: true })
  await mkdir(path.dirname(runtimeLink), { recursive: true })
  await symlink(facade, facadeLink, 'junction')
  await symlink(core, coreLink, 'junction')
  await symlink(runtime, runtimeLink, 'junction')
  return { directory, facade, facadeLink, core, coreLink, runtime, runtimeLink }
}

it('resolves facade and core forwarding imports from their physical pnpm package identities', async () => {
  const paths = await fixture()
  const resolve = vi.fn<PluginHost['resolve']>(async (source, importer) => {
    if (source === '@weapp-stylex/core') {
      // A host retaining the top-level facade symlink cannot see this edge.
      expect(importer).toBe(path.join(paths.facade, 'dist/index.js'))
      return { id: path.join(paths.coreLink, 'dist/index.js') }
    }
    expect(source).toBe('@stylexjs/stylex')
    expect(importer).toBe(`${path.join(paths.core, 'dist/index.js')}?runtime=1`)
    return { id: `${path.join(paths.runtimeLink, 'dist/index.js')}?runtime=1` }
  })
  const plugin = createRuntimeResolver()
  await expect(plugin.resolveId.call({ resolve }, '@weapp-stylex/core', path.join(paths.facadeLink, 'dist/index.js'))).resolves.toEqual({ id: path.join(paths.core, 'dist/index.js') })
  await expect(plugin.resolveId.call({ resolve }, '@stylexjs/stylex', `${path.join(paths.coreLink, 'dist/index.js')}?runtime=1`)).resolves.toEqual({ id: `${path.join(paths.runtime, 'dist/index.js')}?runtime=1` })
  expect(resolve.mock.calls.every(call => call[2]?.skipSelf === true)).toBe(true)
})

it('leaves application imports, host packages and external forwarding results under host control', async () => {
  const paths = await fixture()
  const resolve = vi.fn<PluginHost['resolve']>(async () => ({ id: 'external-runtime', external: true }))
  const plugin = createRuntimeResolver()
  await writeFile(path.join(paths.directory, 'package.json'), '{"name":"consumer"}')
  const source = path.join(paths.directory, 'app.js')
  await writeFile(source, '')
  for (const [request, importer] of [
    ['@weapp-stylex/core', source],
    ['vue', path.join(paths.facadeLink, 'dist/index.js')],
    ['@stylexjs/stylex/lib/stylex-inject', path.join(paths.coreLink, 'dist/index.js')],
    ['@weapp-stylex/core', '\0virtual-entry'],
  ]) {
    await expect(plugin.resolveId.call({ resolve }, request!, importer)).resolves.toBeNull()
  }
  expect(resolve).not.toHaveBeenCalled()
  await expect(plugin.resolveId.call({ resolve }, '@weapp-stylex/core', path.join(paths.facadeLink, 'dist/index.js'))).resolves.toEqual({ id: 'external-runtime', external: true })
})
