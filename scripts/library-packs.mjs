import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, open, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { captureBuildInputs } from './build-provenance.mjs'

const execute = promisify(execFile)
const repository = fileURLToPath(new URL('..', import.meta.url))
const directories = ['core', 'compiler', 'weapp-vite', 'taro', 'uni-app', 'weapp-stylex']
const manifestName = 'library-packs.json'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function identity(value) {
  return sha256(JSON.stringify(value))
}

async function files(directory, prefix = '') {
  const result = []
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    assert.ok(!entry.isSymbolicLink(), `Library output contains a symbolic link: ${path.join(directory, entry.name)}`)
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    const location = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      result.push(...await files(location, relative))
    }
    else {
      assert.ok(entry.isFile(), `Unexpected library output: ${location}`)
      const content = await readFile(location)
      result.push({ path: relative, bytes: content.length, sha256: sha256(content) })
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path))
}

function exportFiles(value) {
  if (typeof value === 'string') {
    return [value]
  }
  return value && typeof value === 'object' ? Object.values(value).flatMap(exportFiles) : []
}

async function packagesAt(root) {
  return Promise.all(directories.map(async (directory) => {
    const project = path.join(root, 'packages', directory)
    const manifest = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'))
    assert.equal(manifest.name, directory === 'weapp-stylex' ? directory : `@weapp-stylex/${directory}`, 'Unexpected library package name')
    assert.notEqual(manifest.private, true, `Cannot pack a private library: ${manifest.name}`)
    return { directory, project, manifest }
  }))
}

function publishedManifest(manifest, packages) {
  const result = structuredClone(manifest)
  // pnpm 12 strips publishing hooks from the archive manifest after running
  // them; application install/runtime scripts remain part of the contract.
  for (const script of ['prepack', 'postpack', 'prepare', 'prepublishOnly', 'postpublish']) {
    if (result.scripts) {
      delete result.scripts[script]
    }
  }
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(result[field] ?? {})) {
      if (!version.startsWith('workspace:')) {
        continue
      }
      const workspace = packages.find(candidate => candidate.manifest.name === name)
      assert.ok(workspace, `Unknown packed workspace dependency: ${name}`)
      const range = version.slice('workspace:'.length)
      result[field][name] = range === '*' ? workspace.manifest.version : ['^', '~'].includes(range) ? `${range}${workspace.manifest.version}` : range
    }
  }
  return result
}

async function distSnapshot(packages) {
  const result = []
  for (const library of packages) {
    const contents = await files(path.join(library.project, 'dist'))
    assert.ok(contents.length, `Library build produced no files: ${library.manifest.name}`)
    const required = exportFiles(library.manifest.exports)
      .concat(['main', 'module', 'types'].flatMap(field => library.manifest[field] ? [library.manifest[field]] : []))
    for (const file of required.filter(file => file !== './package.json')) {
      assert.ok(file.startsWith('./dist/') && contents.some(item => `./dist/${item.path}` === file), `Library build missed public output: ${library.manifest.name}/${file}`)
    }
    result.push({ name: library.manifest.name, version: library.manifest.version, directory: library.directory, sha256: identity(contents), files: contents })
  }
  return result
}

async function archiveContents(archive) {
  const { stdout } = await execute('tar', ['-tzf', archive], { maxBuffer: 8 * 1024 * 1024 })
  const names = stdout.trim().split('\n').filter(name => name && !name.endsWith('/'))
  assert.equal(new Set(names).size, names.length, `Duplicate tarball paths: ${archive}`)
  assert.ok(names.every(name => name.startsWith('package/') && !name.split('/').includes('..')), `Invalid tarball paths: ${archive}`)
  const contents = []
  // Read exact members to stdout; no supplied archive is extracted onto disk.
  for (const name of names.sort()) {
    const { stdout } = await execute('tar', ['-xOzf', archive, name], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
    contents.push({ path: name.slice('package/'.length), bytes: stdout.length, sha256: sha256(stdout) })
  }
  const manifest = await execute('tar', ['-xOzf', archive, 'package/package.json'])
  return { manifest: JSON.parse(manifest.stdout), files: contents }
}

async function validateArchive(archive, library, output, packages) {
  const contents = await archiveContents(archive)
  assert.deepEqual(contents.manifest, publishedManifest(library.manifest, packages), `Packed package manifest differs from the source: ${library.manifest.name}`)
  assert.deepEqual(contents.files.filter(file => file.path.startsWith('dist/')).map(file => ({ ...file, path: file.path.slice('dist/'.length) })).sort((a, b) => a.path.localeCompare(b.path)), output.files, `Packed files differ from the completed library build: ${library.manifest.name}`)
  return contents
}

async function currentInputs(root) {
  // Library compilation does not select an example backend. Producer Node is
  // recorded, while content/lock identities remain reusable on supported floors.
  return captureBuildInputs({ root, backend: 'babel' })
}

async function assertInputs(root, inputs) {
  assert.equal((await currentInputs(root)).id, inputs.id, 'Library packs are stale: implementation, lockfiles or installed dependencies changed')
}

function result(manifest, packs) {
  return {
    packs,
    manifestPath: path.join(packs, manifestName),
    id: manifest.id,
    runId: manifest.runId,
    candidates: manifest.candidates.map(candidate => ({ ...candidate, path: path.join(packs, candidate.archive) })),
    manifest,
  }
}

export async function buildLibraryPacks({ root = repository, packs } = {}) {
  root = await realpath(root)
  assert.ok(packs, 'Specify a fresh directory for the candidate library packs')
  packs = path.resolve(packs)
  await mkdir(packs, { recursive: true })
  assert.ok(!(await readdir(packs)).some(file => file.endsWith('.tgz') || file === manifestName), 'Build library packs into a fresh directory; preserve previous candidate evidence')
  const artifacts = path.join(root, 'artifacts')
  await mkdir(artifacts, { recursive: true })
  const lockPath = path.join(artifacts, 'library-build.lock')
  const lock = await open(lockPath, 'wx')
  let temporary
  try {
    const inputs = await currentInputs(root)
    const libraries = await packagesAt(root)
    const runId = randomUUID()
    await lock.writeFile(JSON.stringify({ pid: process.pid, runId, packs }))
    // A successful no-op build cannot attest a leftover compiler dist.
    for (const library of libraries) {
      await rm(path.join(library.project, 'dist'), { recursive: true, force: true })
    }
    const built = await execute('corepack', ['pnpm', '--filter', './packages/*', 'build'], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    await writeFile(path.join(packs, 'build.log'), built.stdout + built.stderr)
    await assertInputs(root, inputs)
    const dist = await distSnapshot(libraries)
    temporary = await mkdtemp(path.join(packs, '.packing-'))
    const candidates = []
    for (const [index, library] of libraries.entries()) {
      const destination = path.join(temporary, library.directory)
      await mkdir(destination)
      await execute('corepack', ['pnpm', 'pack', '--pack-destination', destination], { cwd: library.project, maxBuffer: 4 * 1024 * 1024 })
      const archives = (await readdir(destination)).filter(file => file.endsWith('.tgz'))
      assert.equal(archives.length, 1, `Expected exactly one archive for ${library.manifest.name}`)
      const archive = path.join(destination, archives[0])
      const contents = await validateArchive(archive, library, dist[index], libraries)
      candidates.push({ runId, name: library.manifest.name, version: library.manifest.version, archive: archives[0], sha256: sha256(await readFile(archive)), dist: dist[index], files: contents.files })
    }
    await assertInputs(root, inputs)
    assert.deepEqual(await distSnapshot(libraries), dist, 'Library dist changed during packing')
    for (const candidate of candidates) {
      await rename(path.join(temporary, candidate.dist.directory, candidate.archive), path.join(packs, candidate.archive))
    }
    const completed = { schemaVersion: 1, runId, completedAt: new Date().toISOString(), inputs, candidates }
    const manifest = { id: identity(completed), ...completed }
    const staging = path.join(packs, `${manifestName}.${runId}.tmp`)
    await writeFile(staging, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
    await rename(staging, path.join(packs, manifestName))
    return result(manifest, packs)
  }
  finally {
    if (temporary) {
      await rm(temporary, { recursive: true, force: true })
    }
    await lock.close()
    await rm(lockPath)
  }
}

export async function verifyLibraryPacks(packs, { root = repository } = {}) {
  root = await realpath(root)
  packs = await realpath(packs)
  let manifest
  try {
    manifest = JSON.parse(await readFile(path.join(packs, manifestName), 'utf8'))
  }
  catch (error) {
    throw new Error(`Missing or unreadable library build/pack attestation: ${packs}`, { cause: error })
  }
  const { id, ...completed } = manifest
  assert.equal(id, identity(completed), 'Library pack attestation checksum is invalid')
  assert.equal(completed.schemaVersion, 1, 'Unsupported library pack attestation schema')
  assert.ok(typeof completed.runId === 'string' && completed.runId, 'Missing library pack run identity')
  await assertInputs(root, completed.inputs)
  const libraries = await packagesAt(root)
  const dist = await distSnapshot(libraries)
  assert.equal(completed.candidates.length, libraries.length, 'Incomplete candidate library pack batch')
  const archives = (await readdir(packs)).filter(file => file.endsWith('.tgz')).sort()
  assert.deepEqual(archives, completed.candidates.map(candidate => candidate.archive).sort(), 'Candidate tarball set changed')
  for (const [index, library] of libraries.entries()) {
    const candidate = completed.candidates[index]
    assert.equal(candidate.runId, completed.runId, 'Mixed library pack runs')
    assert.equal(candidate.name, library.manifest.name, 'Mixed candidate library identity')
    assert.equal(candidate.version, library.manifest.version, 'Candidate library version changed')
    assert.ok(candidate.archive === path.basename(candidate.archive) && candidate.archive.endsWith('.tgz'), 'Invalid candidate archive filename')
    assert.deepEqual(candidate.dist, dist[index], `Library dist changed after packing: ${candidate.name}`)
    const archive = path.join(packs, candidate.archive)
    assert.equal(sha256(await readFile(archive)), candidate.sha256, `Candidate tarball changed: ${candidate.name}`)
    const contents = await validateArchive(archive, library, dist[index], libraries)
    assert.deepEqual(contents.files, candidate.files, `Candidate tarball contents changed: ${candidate.name}`)
  }
  await assertInputs(root, completed.inputs)
  assert.deepEqual(await distSnapshot(libraries), dist, 'Library dist changed during candidate verification')
  return result(manifest, packs)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const built = await buildLibraryPacks({ packs: process.argv[2] })
  process.stdout.write(`Library build/pack attestation: ${built.id}\n${built.manifestPath}\n`)
}
