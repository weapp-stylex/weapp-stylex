import assert from 'node:assert/strict'
import { cp, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { artifactSnapshot, verifyBuildProvenance } from './build-provenance.mjs'
import { names as candidateNames } from './consumers/candidates.mjs'
import { examples as artifactMatrix } from './example-matrix.mjs'
import { verifyLibraryPacks } from './library-packs.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const canonical = artifactMatrix.filter(example => example.target === 'weapp')
const key = example => `${example.name}/${example.directory}`

function snapshotEvidence(snapshot) {
  return { id: snapshot.id, project: snapshot.project, sha256: snapshot.sha256, fileCount: snapshot.files.length }
}

export async function copyVerifiedIdeProject(example, destination, expected, { copy = cp, evidence = {} } = {}) {
  evidence.expectedArtifactId = expected?.id
  evidence.status = 'running'
  try {
    assert.ok(expected?.id && Array.isArray(expected.files), `Missing verified IDE artifact: ${key(example)}`)
    const source = await artifactSnapshot(example)
    evidence.sourceBefore = snapshotEvidence(source)
    assert.equal(source.id, expected.id, `IDE source artifact changed before copy: ${key(example)}`)
    await copy(example.project, destination, {
      recursive: true,
      // Native WeChat dist also contains the other platform build roots. Copy
      // only the selected artifact whose complete file set was attested.
      filter: file => !expected.excluded.includes(path.relative(example.project, file).split(path.sep).join('/')),
    })
    const copied = await artifactSnapshot({ ...example, project: destination })
    evidence.copied = copied
    assert.deepEqual(copied.files, expected.files, `IDE copied project file set or contents differ from the verified artifact: ${key(example)}`)
    assert.equal(copied.sha256, expected.sha256, `IDE copied project digest differs from the verified artifact: ${key(example)}`)
    const sourceAfter = await artifactSnapshot(example)
    evidence.sourceAfter = snapshotEvidence(sourceAfter)
    assert.equal(sourceAfter.id, expected.id, `IDE source artifact changed while copying: ${key(example)}`)
    evidence.verifiedAt = new Date().toISOString()
    evidence.status = 'passed'
    return evidence
  }
  catch (error) {
    evidence.status = 'failed'
    evidence.error = error.message
    error.ideProjectCopy = evidence
    throw error
  }
}

export async function resolveIdeInputs({ backend, consumerManifest, verify = verifyBuildProvenance, verifyPacks = verifyLibraryPacks } = {}) {
  assert.ok(['babel', 'auto'].includes(backend), `Unsupported IDE backend: ${backend}`)
  if (!consumerManifest) {
    return { examples: canonical, sourceRoot: root, provenance: await verify(canonical, { backend }) }
  }
  const consumerManifestPath = path.resolve(consumerManifest)
  const manifest = JSON.parse(await readFile(consumerManifestPath, 'utf8'))
  assert.equal(manifest.status, 'passed', 'External consumer hosts did not finish acceptance')
  assert.ok(path.isAbsolute(manifest.sourceRoot ?? ''), 'External consumer sourceRoot must be absolute')
  assert.ok(Array.isArray(manifest.candidates), 'External consumer candidate tarballs are missing')
  assert.deepEqual(manifest.candidates.map(candidate => candidate.name).sort(), [...candidateNames].sort(), 'External consumer manifest must contain exactly six candidate tarballs')
  assert.ok(path.isAbsolute(manifest.libraryPacks?.manifestPath ?? ''), 'External consumer library build/pack attestation is missing')
  const libraryPacks = await verifyPacks(path.dirname(manifest.libraryPacks.manifestPath), { root })
  assert.equal(libraryPacks.id, manifest.libraryPacks.id, 'External consumer library pack attestation identity changed')
  assert.equal(libraryPacks.runId, manifest.libraryPacks.runId, 'External consumer library pack run changed')
  const candidateIdentity = candidates => candidates.map(({ name, version, sha256 }) => ({ name, version, sha256 })).sort((a, b) => a.name.localeCompare(b.name))
  assert.deepEqual(candidateIdentity(manifest.candidates), candidateIdentity(libraryPacks.candidates), 'External consumer candidates differ from the verified library build/pack batch')
  const builds = manifest.builds?.filter(build => build.backend === backend) ?? []
  assert.equal(builds.length, 1, `External consumer manifest requires exactly one ${backend} build`)
  const build = builds[0]
  assert.ok(path.isAbsolute(build.manifestRoot ?? ''), 'External consumer provenance root must be absolute')
  const selected = manifest.artifacts?.filter(example => example.target === 'weapp' && example.backend === backend) ?? []
  assert.deepEqual(selected.map(key).sort(), canonical.map(key).sort(), 'IDE acceptance requires all seven canonical WeChat artifacts without duplicates')
  const examples = canonical.map((expected) => {
    const actual = selected.find(example => key(example) === key(expected))
    assert.equal(actual.builder ?? null, expected.builder ?? null, `External consumer builder mismatch: ${key(expected)}`)
    assert.ok(path.isAbsolute(actual.project ?? ''), `External consumer project must be absolute: ${key(expected)}`)
    return { ...expected, project: actual.project }
  })
  const provenance = await verify(examples, {
    backend,
    manifestRoot: build.manifestRoot,
    sourceRoot: manifest.sourceRoot,
    candidates: manifest.candidates,
  })
  assert.equal(provenance.run.id, build.run?.id, 'External consumer run differs from verified build provenance')
  return { examples, sourceRoot: manifest.sourceRoot, provenance, consumerManifestPath, libraryPacks: { id: libraryPacks.id, runId: libraryPacks.runId, manifestPath: libraryPacks.manifestPath } }
}
