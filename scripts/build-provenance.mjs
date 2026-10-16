import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, readlink, realpath, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const repository = fileURLToPath(new URL('..', import.meta.url))
const schemaVersion = 1
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'artifacts', 'coverage', '.turbo', '.vite', '.weapp-vite'])
const templateExtensions = { weapp: 'wxml', alipay: 'axml', tt: 'ttml' }

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function identity(value) {
  return digest(JSON.stringify(value))
}

function backendName(backend = process.env.WEAPP_STYLEX_BACKEND ?? 'babel') {
  assert.ok(['babel', 'auto', 'swc'].includes(backend), `Unsupported build backend: ${backend}`)
  return backend
}

function implementationFile(file) {
  return !file.split('/').some(part => ignoredDirectories.has(part))
    && !/^(?:docs|apps\/docs|\.changeset|\.agents|\.repoctl)\//.test(file)
    && !/\.(?:md|mdx|log|tgz|tsbuildinfo)$/.test(file)
    && !/(?:^|\/)AGENTS\.md$/.test(file)
    && !/(?:^|\/)pnpm-lock\.yaml$/.test(file)
}

async function fileDigest(file) {
  const before = await lstat(file)
  const sha256 = before.isSymbolicLink()
    ? digest(`symlink:${await readlink(file)}`)
    : digest(await readFile(file))
  const after = await lstat(file)
  assert.ok(before.size === after.size && before.mtimeMs === after.mtimeMs, `File changed while hashing: ${file}`)
  return { sha256, bytes: before.size }
}

async function optionalDigest(file) {
  try {
    return { path: file, ...await fileDigest(file) }
  }
  catch (error) {
    if (error.code === 'ENOENT') {
      return { path: file, sha256: null }
    }
    throw error
  }
}

async function sourceSnapshot(root) {
  // Include working-tree contents, staged files and new implementation files.
  // Committing an already-built tree does not change its content identity.
  const [{ stdout: listed }, { stdout: revision }] = await Promise.all([
    run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, maxBuffer: 8 * 1024 * 1024 }),
    run('git', ['rev-parse', 'HEAD'], { cwd: root }),
  ])
  const files = []
  for (const file of [...new Set(listed.split('\0').filter(Boolean))].filter(implementationFile).sort()) {
    const item = await optionalDigest(path.join(root, file))
    files.push({ path: file, sha256: item.sha256 })
  }
  return { root, revision: revision.trim(), sha256: identity(files), files }
}

async function directoryFiles(directory, { implementation = false, excluded = [] } = {}) {
  const files = []
  async function visit(current, relative = '') {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name
      if (excluded.includes(name) || (implementation && ignoredDirectories.has(entry.name))) {
        continue
      }
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!implementation || implementationFile(`${name}/placeholder`)) {
          await visit(file, name)
        }
      }
      else if (!implementation || implementationFile(name)) {
        assert.ok(implementation || !entry.isSymbolicLink(), `Artifact contains a symbolic link: ${file}`)
        files.push({ path: name, ...await fileDigest(file) })
      }
    }
  }
  await visit(directory)
  return files
}

async function installedVersions(root, source) {
  const versions = []
  for (const file of source.files.filter(file => file.sha256 && /(?:^|\/)package\.json$/.test(file.path))) {
    const manifest = JSON.parse(await readFile(path.join(root, file.path), 'utf8'))
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies }
    for (const name of Object.keys(dependencies).sort()) {
      if (dependencies[name].startsWith('workspace:')) {
        continue
      }
      const location = path.join(root, path.dirname(file.path), 'node_modules', name, 'package.json')
      try {
        const installed = JSON.parse(await readFile(location, 'utf8'))
        versions.push({ workspace: path.dirname(file.path), name, version: installed.version, sha256: digest(await readFile(location)) })
      }
      catch (error) {
        if (error.code !== 'ENOENT') {
          throw error
        }
        versions.push({ workspace: path.dirname(file.path), name, version: null })
      }
    }
  }
  return versions
}

async function candidateSnapshots(candidates = []) {
  const result = []
  for (const candidate of candidates) {
    const file = typeof candidate === 'string' ? candidate : candidate.path
    const resolved = await realpath(file)
    const snapshot = await fileDigest(resolved)
    if (typeof candidate === 'object' && candidate.sha256) {
      assert.equal(snapshot.sha256, candidate.sha256, `Candidate tarball checksum changed: ${resolved}`)
    }
    result.push({
      ...(typeof candidate === 'object' ? { name: candidate.name, version: candidate.version } : {}),
      path: resolved,
      ...snapshot,
    })
  }
  return result.sort((a, b) => a.path.localeCompare(b.path))
}

function inputIdentity(inputs) {
  return identity({
    backend: inputs.backend,
    source: inputs.source.sha256,
    externalSource: inputs.externalSource?.sha256 ?? null,
    lockfiles: inputs.lockfiles,
    frameworks: inputs.frameworks,
    candidates: inputs.candidates,
  })
}

export async function captureBuildInputs({ root = repository, sourceRoot, backend, candidates = [] } = {}) {
  root = await realpath(root)
  sourceRoot = sourceRoot ? await realpath(sourceRoot) : root
  const source = await sourceSnapshot(root)
  const lockPaths = [path.join(root, 'pnpm-lock.yaml'), path.join(root, 'node_modules/.pnpm/lock.yaml')]
  let externalSource
  if (sourceRoot !== root) {
    const files = await directoryFiles(sourceRoot, { implementation: true })
    externalSource = { root: sourceRoot, sha256: identity(files), files }
    lockPaths.push(path.join(sourceRoot, 'pnpm-lock.yaml'), path.join(sourceRoot, 'node_modules/.pnpm/lock.yaml'))
    for (const file of files.filter(file => /(?:^|\/)package\.json$/.test(file.path))) {
      const workspace = path.join(sourceRoot, path.dirname(file.path))
      lockPaths.push(path.join(workspace, 'pnpm-lock.yaml'), path.join(workspace, 'node_modules/.pnpm/lock.yaml'))
    }
  }
  const lockfiles = await Promise.all([...new Set(lockPaths)].map(optionalDigest))
  assert.ok(lockfiles[0].sha256, 'Build provenance requires the repository pnpm-lock.yaml')
  const inputs = {
    backend: backendName(backend),
    source,
    ...(externalSource ? { externalSource } : {}),
    lockfile: lockfiles[0],
    lockfiles,
    frameworks: [
      ...await installedVersions(root, source),
      ...(externalSource ? (await installedVersions(sourceRoot, externalSource)).map(item => ({ ...item, scope: 'external' })) : []),
    ],
    candidates: await candidateSnapshots(candidates),
    toolchain: { node: process.versions.node, platform: process.platform, arch: process.arch },
  }
  inputs.id = inputIdentity(inputs)
  return inputs
}

function artifactKey(example) {
  return `${example.name}/${example.directory}`
}

export async function artifactSnapshot(example) {
  assert.ok(example.name && example.directory && example.target && example.project, 'Incomplete build artifact descriptor')
  assert.ok(['weapp', 'alipay', 'tt', 'h5'].includes(example.target), `Unsupported artifact target: ${example.target}`)
  const project = await realpath(example.project)
  // Native/Wevu keep the other three targets below the WeChat output root.
  // These are independent artifacts and have their own recursive snapshots.
  const excluded = example.target === 'weapp' && ['wechat-native', 'wechat-wevu'].includes(example.name)
    ? ['alipay', 'tt', 'web']
    : []
  const files = await directoryFiles(project, { excluded })
  const required = example.target === 'h5'
    ? ['index.html']
    : ['app.json', 'app.js', `pages/index/index.${templateExtensions[example.target]}`]
  for (const requiredFile of required) {
    assert.ok(files.some(file => file.path === requiredFile && file.bytes > 0), `Incomplete artifact ${artifactKey(example)}: missing ${requiredFile}`)
  }
  const artifact = {
    name: example.name,
    directory: example.directory,
    target: example.target,
    builder: example.builder ?? null,
    project,
    excluded,
    sha256: identity(files),
    files,
  }
  return { ...artifact, id: identity(artifact) }
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  }
  catch (error) {
    throw new Error(`${label} is missing or unreadable: ${file}`, { cause: error })
  }
}

async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
    await rename(temporary, file)
  }
  finally {
    await rm(temporary, { force: true })
  }
}

async function existingIndex(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  }
  catch (error) {
    if (error.code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

function provenanceRoot(root, manifestRoot) {
  return path.resolve(manifestRoot ?? path.join(root, 'artifacts/build-provenance'))
}

async function checkInputs(inputs, options) {
  const current = await captureBuildInputs({
    root: options.root,
    sourceRoot: options.sourceRoot ?? inputs.externalSource?.root,
    backend: options.backend,
    candidates: options.candidates ?? inputs.candidates,
  })
  assert.equal(current.id, inputs.id, 'Build provenance is stale: implementation, lockfiles, installed versions or candidates changed')
}

export async function writeBuildProvenance(examples, { inputs, root = repository, manifestRoot, sourceRoot, backend, candidates } = {}) {
  assert.ok(inputs, 'Capture build inputs before starting the build')
  assert.ok(examples.length, 'Cannot attest an empty build')
  backend = backendName(backend ?? inputs.backend)
  assert.equal(inputs.backend, backend, 'Build input backend does not match the completed build')
  await checkInputs(inputs, { root, sourceRoot, backend, candidates })
  const artifacts = []
  for (const example of examples) {
    assert.ok(!artifacts.some(item => artifactKey(item) === artifactKey(example)), `Duplicate artifact: ${artifactKey(example)}`)
    artifacts.push(await artifactSnapshot(example))
  }
  await checkInputs(inputs, { root, sourceRoot, backend, candidates })
  const completed = { schemaVersion, nonce: randomUUID(), completedAt: new Date().toISOString(), backend, inputs, artifacts }
  const id = identity(completed)
  const location = provenanceRoot(root, manifestRoot)
  const manifestPath = path.join(location, backend, 'runs', `${id}.json`)
  const manifest = { id, ...completed }
  // Immutable snapshots preserve Babel evidence after an auto build. One atomic
  // index update publishes the complete target set only after all hashes exist.
  await atomicJson(manifestPath, manifest)
  const targetsPath = path.join(location, backend, 'targets.json')
  const targets = await existingIndex(targetsPath)
  for (const target of new Set(examples.map(example => example.target))) {
    targets[target] = id
  }
  await atomicJson(targetsPath, targets)
  const currentPath = path.join(location, 'current.json')
  const current = await existingIndex(currentPath)
  for (const artifact of artifacts) {
    current[artifact.project] = { run: id, backend, artifact: artifact.id }
  }
  await atomicJson(currentPath, current)
  return verificationResult(manifest, manifestPath, artifacts)
}

function verificationResult(manifest, manifestPath, artifacts) {
  return {
    run: {
      ...manifest.inputs,
      inputId: manifest.inputs.id,
      id: manifest.id,
      manifestPath,
      backend: manifest.backend,
      completedAt: manifest.completedAt,
    },
    artifacts,
  }
}

export async function verifyBuildProvenance(examples, { root = repository, manifestRoot, sourceRoot, backend, candidates } = {}) {
  assert.ok(examples.length, 'Cannot verify an empty artifact selection')
  backend = backendName(backend)
  const location = provenanceRoot(root, manifestRoot)
  const targets = await readJson(path.join(location, backend, 'targets.json'), 'Build provenance target index')
  const selectedTargets = [...new Set(examples.map(example => example.target))]
  const runs = selectedTargets.map(target => targets[target])
  assert.ok(runs.every(id => typeof id === 'string' && /^[a-f\d]{64}$/.test(id)), 'Build provenance is missing for one or more selected targets')
  assert.equal(new Set(runs).size, 1, 'Mixed build provenance: selected targets came from different build runs')
  const manifestPath = path.join(location, backend, 'runs', `${runs[0]}.json`)
  const { id, ...completed } = await readJson(manifestPath, 'Build provenance manifest')
  assert.equal(id, identity(completed), 'Build provenance manifest checksum is invalid')
  assert.equal(id, runs[0], 'Build provenance manifest identity does not match its index')
  assert.equal(completed.schemaVersion, schemaVersion, 'Unsupported build provenance schema')
  assert.equal(completed.backend, backend, 'Build provenance backend mismatch')
  await checkInputs(completed.inputs, { root, sourceRoot, backend, candidates })
  const expectedKeys = examples.map(artifactKey).sort()
  const builtKeys = completed.artifacts.filter(artifact => selectedTargets.includes(artifact.target)).map(artifactKey).sort()
  assert.deepEqual(expectedKeys, builtKeys, 'Incomplete or mixed build artifact selection')
  const current = await readJson(path.join(location, 'current.json'), 'Current build output ownership')
  const artifacts = []
  for (const example of examples) {
    const built = completed.artifacts.find(artifact => artifactKey(artifact) === artifactKey(example))
    const actual = await artifactSnapshot(example)
    assert.deepEqual(current[actual.project], { run: id, backend, artifact: built.id }, `Build output was replaced by another run/backend: ${artifactKey(example)}`)
    assert.equal(actual.id, built.id, `Build artifact changed or is incomplete: ${artifactKey(example)}`)
    artifacts.push(built)
  }
  await checkInputs(completed.inputs, { root, sourceRoot, backend, candidates })
  return verificationResult({ id, ...completed }, manifestPath, artifacts)
}
