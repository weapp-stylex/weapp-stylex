import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
// Root infrastructure tests run directly in Node, outside workspace Vitest.
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { buildLibraryPacks, verifyLibraryPacks } from './library-packs.mjs'

const run = promisify(execFile)
const directories = ['core', 'compiler', 'weapp-vite', 'taro', 'uni-app', 'weapp-stylex']
const packageManager = JSON.parse(await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).packageManager
async function put(root, file, value) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true })
  await writeFile(path.join(root, file), value)
}

async function fixture(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'stylex-library-packs-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await put(root, '.gitignore', 'artifacts/\nnode_modules/\ndist/\n')
  await put(root, 'package.json', JSON.stringify({ name: 'library-pack-fixture', private: true, packageManager }))
  await put(root, 'pnpm-workspace.yaml', 'packages: ["packages/*"]\n')
  await put(root, 'pnpm-lock.yaml', 'lockfileVersion: "9.0"\nimporters: {}\n')
  for (const directory of directories) {
    const name = directory === 'weapp-stylex' ? directory : `@weapp-stylex/${directory}`
    await put(root, `packages/${directory}/package.json`, JSON.stringify({
      name,
      version: '0.1.0',
      ...(directory !== 'core' ? { private: false } : {}),
      type: 'module',
      files: ['dist'],
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      scripts: { build: 'node build.mjs' },
      ...(directory !== 'core' ? { dependencies: { '@weapp-stylex/core': 'workspace:*' } } : {}),
    }))
    await put(root, `packages/${directory}/src/index.js`, `export const version = '${directory}-source-v1'\n`)
    await put(root, `packages/${directory}/build.mjs`, `import {mkdir,readFile,writeFile} from 'node:fs/promises';await mkdir('dist',{recursive:true});await writeFile('dist/index.js',await readFile('src/index.js'));await writeFile('dist/index.d.ts','export declare const version: string;');`)
    await put(root, `packages/${directory}/dist/stale.js`, 'old output must be removed')
  }
  // Corepack needs a network lookup for the configured manager when the CI
  // metadata mirror is cold; the fixture itself has no registry dependencies.
  await run('corepack', ['pnpm', 'install', '--ignore-scripts'], { cwd: root, maxBuffer: 4 * 1024 * 1024 })
  await run('git', ['init', '--quiet'], { cwd: root })
  await run('git', ['add', '.'], { cwd: root })
  await run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture'], { cwd: root })
  const packs = path.join(root, 'artifacts/candidates')
  return { root, packs, build: (extra = {}) => buildLibraryPacks({ root, packs, ...extra }) }
}

describe('source-bound library candidate batches', () => {
  it('builds and packs public libraries with explicit or omitted private flags, binds exact files and reuses the batch', async (context) => {
    const { root, packs, build } = await fixture(context)
    const built = await build()
    const verified = await verifyLibraryPacks(packs, { root })
    assert.equal(verified.id, built.id)
    assert.equal(verified.candidates.length, 6)
    assert.equal(new Set(verified.candidates.map(candidate => candidate.runId)).size, 1)
    assert.ok(verified.candidates.every(candidate => candidate.runId === verified.runId))
    assert.equal(verified.candidates[1].version, '0.1.0')
    assert.ok(verified.candidates[0].dist.files.every(file => file.path !== 'stale.js'))
    const coreManifest = JSON.parse((await run('tar', ['-xOzf', verified.candidates[0].path, 'package/package.json'])).stdout)
    assert.equal(Object.hasOwn(coreManifest, 'private'), false)
    const archive = verified.candidates[1].path
    const packedManifest = JSON.parse((await run('tar', ['-xOzf', archive, 'package/package.json'])).stdout)
    assert.equal(packedManifest.dependencies['@weapp-stylex/core'], '0.1.0')
    const before = await readFile(path.join(root, 'packages/core/dist/index.js'), 'utf8')
    await verifyLibraryPacks(packs, { root })
    assert.equal(await readFile(path.join(root, 'packages/core/dist/index.js'), 'utf8'), before)
    await assert.rejects(build(), /fresh directory/)
  })

  it('rejects an explicitly private library before building or packing', async (context) => {
    const { root, packs, build } = await fixture(context)
    const filename = path.join(root, 'packages/core/package.json')
    const manifest = JSON.parse(await readFile(filename, 'utf8'))
    manifest.private = true
    await writeFile(filename, JSON.stringify(manifest))
    await assert.rejects(build(), /Cannot pack a private library/)
    assert.deepEqual(await readdir(packs), [])
    assert.equal(await readFile(path.join(root, 'packages/core/dist/stale.js'), 'utf8'), 'old output must be removed')
  })

  it('rejects old packs without build evidence and a successful no-op build with leftover dist', async (context) => {
    const { root, packs, build } = await fixture(context)
    await mkdir(packs, { recursive: true })
    await assert.rejects(verifyLibraryPacks(packs, { root }), /Missing or unreadable.*attestation/)
    for (const directory of directories) {
      await put(root, `packages/${directory}/build.mjs`, '// successful no-op build\n')
    }
    await assert.rejects(build(), /ENOENT|no files/)
    await assert.rejects(verifyLibraryPacks(packs, { root }), /Missing or unreadable.*attestation/)
  })

  it('rejects source changes even when versions and built dist are unchanged', async (context) => {
    const { root, packs, build } = await fixture(context)
    await build()
    await put(root, 'packages/compiler/src/index.js', 'export const fixed = true')
    await assert.rejects(verifyLibraryPacks(packs, { root }), /Library packs are stale/)
  })

  it('rejects changed dist contents and extra or missing output files', async (context) => {
    const { root, packs, build } = await fixture(context)
    await build()
    const file = path.join(root, 'packages/core/dist/index.js')
    const original = await readFile(file)
    await writeFile(file, 'changed built output')
    await assert.rejects(verifyLibraryPacks(packs, { root }), /dist changed after packing/)
    await writeFile(file, original)
    await put(root, 'packages/core/dist/extra.js', 'extra output')
    await assert.rejects(verifyLibraryPacks(packs, { root }), /dist changed after packing/)
    await rm(path.join(root, 'packages/core/dist/extra.js'))
    await rm(file)
    await assert.rejects(verifyLibraryPacks(packs, { root }), /missed public output/)
  })

  it('rejects changed tarballs and replacing one same-version tarball from an older batch', async (context) => {
    const { root, packs, build } = await fixture(context)
    const first = await build()
    const archive = first.candidates[0].path
    const original = await readFile(archive)
    await writeFile(archive, 'changed archive')
    await assert.rejects(verifyLibraryPacks(packs, { root }), /Candidate tarball changed/)
    await writeFile(archive, original)
    await put(root, 'packages/core/src/index.js', 'export const fixed = true')
    const next = await build({ packs: path.join(root, 'artifacts/next') })
    await cp(archive, next.candidates[0].path)
    await assert.rejects(verifyLibraryPacks(next.packs, { root }), /Candidate tarball changed/)
  })

  it('does not publish evidence when prepack changes already-built dist', async (context) => {
    const { root, packs, build } = await fixture(context)
    const filename = path.join(root, 'packages/core/package.json')
    const manifest = JSON.parse(await readFile(filename, 'utf8'))
    manifest.scripts.prepack = 'node prepack.mjs'
    await writeFile(filename, JSON.stringify(manifest))
    await put(root, 'packages/core/prepack.mjs', 'import {writeFile} from \'node:fs/promises\';await writeFile(\'dist/index.js\',\'changed during packing\')')
    await assert.rejects(build(), /Packed files differ|dist changed during packing/)
    await assert.rejects(verifyLibraryPacks(packs, { root }), /Missing or unreadable.*attestation/)
  })

  it('rejects mixed run records, while consumer Node identity is not a freshness requirement', async (context) => {
    const { root, packs, build } = await fixture(context)
    const built = await build()
    const manifest = JSON.parse(await readFile(built.manifestPath, 'utf8'))
    const reseal = async () => {
      const { id: _id, ...completed } = manifest
      manifest.id = createHash('sha256').update(JSON.stringify(completed)).digest('hex')
      await writeFile(built.manifestPath, JSON.stringify(manifest))
    }
    manifest.inputs.toolchain.node = '24.11.0'
    await reseal()
    await verifyLibraryPacks(packs, { root })
    manifest.candidates[0].runId = 'different-build-run'
    await reseal()
    await assert.rejects(verifyLibraryPacks(packs, { root }), /Mixed library pack runs/)
  })

  it('preserves prior evidence and refuses concurrent library construction', async (context) => {
    const { root, packs, build } = await fixture(context)
    await put(root, 'artifacts/library-build.lock', '{"pid":123}')
    await assert.rejects(build(), { code: 'EEXIST' })
    assert.equal((await readdir(packs)).length, 0)
    assert.equal(await readFile(path.join(root, 'artifacts/library-build.lock'), 'utf8'), '{"pid":123}')
  })
})
