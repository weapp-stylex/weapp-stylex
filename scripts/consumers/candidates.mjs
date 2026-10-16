import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { buildLibraryPacks, verifyLibraryPacks } from '../library-packs.mjs'

export const run = promisify(execFile)
export const root = fileURLToPath(new URL('../..', import.meta.url))
export const names = ['@weapp-stylex/core', '@weapp-stylex/compiler', '@weapp-stylex/weapp-vite', '@weapp-stylex/taro', '@weapp-stylex/uni-app', 'weapp-stylex']
export const hosts = ['weapp-vite', '@tarojs/service', 'webpack', '@dcloudio/vite-plugin-uni']

export async function fileHash(filename) {
  return createHash('sha256').update(await readFile(filename)).digest('hex')
}

async function files(directory) {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(async entry => entry.isDirectory()
    ? files(path.join(directory, entry.name))
    : [path.join(directory, entry.name)]))).flat()
}

export async function packageRoot(require, name) {
  let directory = path.dirname(await realpath(require.resolve(name)))
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
      if (manifest.name === name) {
        return directory
      }
    }
    catch (error) {
      if (error.code !== 'ENOENT') {
        throw error
      }
    }
    const parent = path.dirname(directory)
    assert.notEqual(parent, directory, `Cannot find installed package root for ${name}`)
    directory = parent
  }
}

export async function prepareCandidates(directory = process.env.WEAPP_STYLEX_TEST_PACKS_DIR, { pack = !directory } = {}) {
  let packs = directory ? path.resolve(directory) : await mkdtemp(path.join(tmpdir(), 'weapp-stylex-candidate-packs-'))
  await mkdir(packs, { recursive: true })
  packs = await realpath(packs)
  if (pack) {
    await buildLibraryPacks({ root, packs })
  }
  const attestation = await verifyLibraryPacks(packs, { root })
  const archives = (await readdir(packs)).filter(file => file.endsWith('.tgz')).sort()
  assert.equal(archives.length, names.length, 'Candidate directory must contain exactly six package tarballs')
  const unpacked = await mkdtemp(path.join(tmpdir(), 'weapp-stylex-candidate-contents-'))
  const candidates = []
  for (const [index, archive] of archives.entries()) {
    const filename = path.join(packs, archive)
    const destination = path.join(unpacked, String(index))
    await mkdir(destination)
    await run('tar', ['-xzf', filename, '-C', destination])
    const contents = path.join(destination, 'package')
    const manifest = JSON.parse(await readFile(path.join(contents, 'package.json'), 'utf8'))
    assert.ok(names.includes(manifest.name), `Unexpected candidate ${manifest.name}`)
    assert.ok(!candidates.some(candidate => candidate.name === manifest.name), `Duplicate candidate ${manifest.name}`)
    const hashes = Object.fromEntries(await Promise.all((await files(contents)).map(async file => [path.relative(contents, file).replaceAll('\\', '/'), await fileHash(file)])))
    const sha256 = await fileHash(filename)
    const attested = attestation.candidates.find(candidate => candidate.name === manifest.name)
    assert.ok(attested && attested.version === manifest.version && attested.sha256 === sha256, `Candidate differs from its library build/pack attestation: ${manifest.name}`)
    candidates.push({ name: manifest.name, version: manifest.version, path: filename, sha256, manifest, hashes })
  }
  await verifyLibraryPacks(packs, { root })
  return { packs, unpacked, candidates, attestation: { id: attestation.id, runId: attestation.runId, manifestPath: attestation.manifestPath } }
}

export function candidateSummary(candidates) {
  return candidates.map(({ name, version, path, sha256 }) => ({ name, version, path, sha256 }))
}

export async function verifyCandidates(prepared) {
  const attestation = await verifyLibraryPacks(prepared.packs, { root })
  assert.equal(attestation.id, prepared.attestation.id, 'Library build/pack attestation changed during consumer verification')
  assert.equal(attestation.runId, prepared.attestation.runId, 'Library candidate run changed during consumer verification')
  assert.deepEqual(candidateSummary(attestation.candidates).sort((a, b) => a.name.localeCompare(b.name)), candidateSummary(prepared.candidates).sort((a, b) => a.name.localeCompare(b.name)), 'Consumer candidate set differs from its attested library build')
}

export async function installConsumer(directory, candidates, direct, { dependencies = {}, omitOptional = false, host = false } = {}) {
  assert.ok(names.includes(direct), `Unknown public entry ${direct}`)
  assert.ok(!Object.keys(dependencies).some(name => names.includes(name)), 'Consumer must declare only one StyleX package directly')
  const workspace = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const candidate = candidates.find(candidate => candidate.name === direct)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'package.json'), `${JSON.stringify({
    name: `isolated-${direct.replaceAll(/[^a-z0-9-]/g, '-')}`,
    private: true,
    type: 'module',
    packageManager: workspace.packageManager,
    dependencies: { ...dependencies, [direct]: `file:${candidate.path}` },
  }, null, 2)}\n`)
  // These overrides redirect candidate edges without declaring extra packages.
  // Host repairs reproduce the two documented upstream packaging omissions.
  await writeFile(path.join(directory, 'pnpm-workspace.yaml'), `packages: ['.']\nautoInstallPeers: false\nstrictPeerDependencies: false\n${host ? 'packageExtensions:\n  weapp-vite@7.4.0:\n    dependencies:\n      \'@babel/core\': \'^8.0.7\'\n  \'@dcloudio/uni-mp-vite@3.0.0-alpha-5030120260930001\':\n    dependencies:\n      estree-walker: 2.0.2\n' : ''}overrides:\n${candidates.map(candidate => `  ${JSON.stringify(candidate.name)}: ${JSON.stringify(`file:${candidate.path}`)}`).join('\n')}\n${host ? '  \'weapp-vite>vite\': \'8.3.4\'\n' : ''}`)
  await ensureArtifactsDirectory()
  const logs = await mkdtemp(path.join(root, 'artifacts', 'consumer-install-'))
  process.stdout.write(`Installing isolated ${direct}${omitOptional ? ' without optional dependencies' : ''}; diagnostics: ${logs}\n`)
  try {
    const output = await run('corepack', ['pnpm', 'install', '--ignore-scripts', '--registry=https://registry.npmjs.org', '--reporter=append-only', ...(omitOptional ? ['--no-optional'] : [])], { cwd: directory, timeout: 600000, maxBuffer: 8 * 1024 * 1024 })
    await writeFile(path.join(logs, 'output.log'), output.stdout + output.stderr)
  }
  catch (error) {
    await writeFile(path.join(logs, 'output.log'), (error.stdout ?? '') + (error.stderr ?? ''))
    process.stderr.write(`Consumer installation failed; diagnostics retained in ${logs}\n`)
    throw error
  }
  const installed = await verifyCandidateGraph(directory, candidates, direct)
  return { installed, logs }
}

export async function verifyCandidateGraph(directory, candidates, direct) {
  const directoryReal = await realpath(directory)
  const installed = new Map()
  const inspect = async (require, name) => {
    const candidate = candidates.find(candidate => candidate.name === name)
    const resolved = await packageRoot(require, name)
    assert.ok(resolved.startsWith(`${directoryReal}${path.sep}`), `${name} resolved outside its isolated consumer: ${resolved}`)
    assert.ok(!resolved.startsWith(`${root}${path.sep}`), `${name} resolved into the repository`)
    const manifest = JSON.parse(await readFile(path.join(resolved, 'package.json'), 'utf8'))
    assert.equal(manifest.version, candidate.version, `${name} did not resolve the candidate version`)
    for (const [file, hash] of Object.entries(candidate.hashes)) {
      assert.equal(await fileHash(path.join(resolved, file)), hash, `${name}/${file} differs from the candidate tarball`)
    }
    if (installed.has(name)) {
      assert.equal(installed.get(name), resolved, `${name} resolved to multiple candidate instances`)
      return
    }
    installed.set(name, resolved)
    const dependencyRequire = createRequire(path.join(resolved, 'package.json'))
    for (const dependency of Object.keys(manifest.dependencies ?? {}).filter(name => names.includes(name))) {
      await inspect(dependencyRequire, dependency)
    }
  }
  await inspect(createRequire(path.join(directory, 'package.json')), direct)
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
  assert.deepEqual(Object.keys(manifest.dependencies).filter(name => names.includes(name)), [direct])
  return installed
}

export async function assertHostsAbsent(directory, installed) {
  for (const [name, location] of [['consumer', directory], ...installed]) {
    const require = createRequire(path.join(location, 'package.json'))
    for (const host of hosts) {
      assert.throws(() => require.resolve(host), { code: 'MODULE_NOT_FOUND' }, `${name} unexpectedly installed optional host ${host}`)
    }
  }
}

export async function ensureArtifactsDirectory() {
  await mkdir(path.join(root, 'artifacts'), { recursive: true })
}
