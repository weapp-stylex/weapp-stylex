import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { artifactSnapshot } from './build-provenance.mjs'
import { names as candidateNames } from './consumers/candidates.mjs'
import { examples as artifactMatrix } from './example-matrix.mjs'
import { copyVerifiedIdeProject, resolveIdeInputs } from './ide-inputs.mjs'

const canonical = artifactMatrix.filter(example => example.target === 'weapp')
const runId = 'a'.repeat(64)

function consumerReport() {
  return {
    status: 'passed',
    sourceRoot: '/external/source',
    libraryPacks: { id: 'd'.repeat(64), runId: 'packed-library-run', manifestPath: '/external/packs/library-packs.json' },
    candidates: candidateNames.map(name => ({ name, version: '0.1.0', path: `/external/${name.replace('/', '-')}.tgz`, sha256: 'b'.repeat(64) })),
    builds: ['babel', 'auto'].map(backend => ({ backend, manifestRoot: '/evidence/provenance', run: { id: runId } })),
    artifacts: ['babel', 'auto'].flatMap(backend => canonical.map(example => ({ ...example, backend, project: path.join('/external/artifacts', backend, example.name, example.directory) }))),
  }
}

async function external(manifest, verify = async () => ({ run: { id: runId }, artifacts: [] }), verifyPacks = async () => ({ ...consumerReport().libraryPacks, candidates: consumerReport().candidates })) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'stylex-ide-inputs-'))
  try {
    const consumerManifest = path.join(temporary, 'manifest.json')
    await writeFile(consumerManifest, JSON.stringify(manifest))
    return await resolveIdeInputs({ backend: 'auto', consumerManifest, verify, verifyPacks })
  }
  finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

async function copyFixture(test) {
  const root = await mkdtemp(path.join(tmpdir(), 'stylex-ide-copy-'))
  test.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  const destination = path.join(root, 'owned/project')
  for (const [file, content] of [
    ['app.json', '{"pages":["pages/index/index"]}'],
    ['app.js', 'App({})'],
    ['project.config.json', '{"appid":"unchanged-fixture-id"}'],
    ['pages/index/index.wxml', '<view>verified artifact</view>'],
    ['pages/index/index.wxss', '.sx-card{padding:16px}'],
  ]) {
    const filename = path.join(source, file)
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, content)
  }
  const example = { name: 'wechat-native', target: 'weapp', directory: 'dist', project: source }
  return { source, destination, example, expected: await artifactSnapshot(example) }
}

describe('verified IDE project copies before AppID changes', () => {
  it('retains the exact complete attested file set and records both source checks', async (test) => {
    const { example, destination, expected } = await copyFixture(test)
    const evidence = await copyVerifiedIdeProject(example, destination, expected)
    assert.equal(evidence.status, 'passed')
    assert.equal(evidence.sourceBefore.id, expected.id)
    assert.equal(evidence.sourceAfter.id, expected.id)
    assert.deepEqual(evidence.copied.files, expected.files)
    assert.equal(JSON.parse(await readFile(path.join(destination, 'project.config.json'), 'utf8')).appid, 'unchanged-fixture-id')
  })

  it('rejects source output overwritten after suite verification before copying anything', async (test) => {
    const { source, example, destination, expected } = await copyFixture(test)
    await writeFile(path.join(source, 'app.js'), 'App({fromAnotherBuild:true})')
    const evidence = {}
    await assert.rejects(copyVerifiedIdeProject(example, destination, expected, {
      evidence,
      async copy() { assert.fail('A stale artifact must not be copied') },
    }), /source artifact changed before copy/)
    assert.equal(evidence.status, 'failed')
    assert.notEqual(evidence.sourceBefore.id, expected.id)
  })

  for (const damage of ['changed content', 'missing file', 'extra file']) {
    it(`rejects ${damage} in the copied project before it can be launched`, async (test) => {
      const { example, destination, expected } = await copyFixture(test)
      const evidence = {}
      await assert.rejects(copyVerifiedIdeProject(example, destination, expected, {
        evidence,
        async copy(source, target, options) {
          await cp(source, target, options)
          if (damage === 'changed content') {
            await writeFile(path.join(target, 'pages/index/index.wxss'), '.sx-card{padding:0}')
          }
          else if (damage === 'missing file') {
            await rm(path.join(target, 'pages/index/index.wxss'))
          }
          else {
            await writeFile(path.join(target, 'stale.js'), 'unattested chunk')
          }
        },
      }), /copied project file set or contents differ/)
      assert.equal(evidence.status, 'failed')
      assert.ok(evidence.copied.files.length)
      assert.equal(JSON.parse(await readFile(path.join(destination, 'project.config.json'), 'utf8')).appid, 'unchanged-fixture-id')
    })
  }

  it('rejects source mutation during copying even if the copied bytes match the original snapshot', async (test) => {
    const { example, destination, expected } = await copyFixture(test)
    const evidence = {}
    await assert.rejects(copyVerifiedIdeProject(example, destination, expected, {
      evidence,
      async copy(source, target, options) {
        await cp(source, target, options)
        await writeFile(path.join(source, 'app.js'), 'App({lateBuild:true})')
      },
    }), /source artifact changed while copying/)
    assert.deepEqual(evidence.copied.files, expected.files)
    assert.equal(evidence.status, 'failed')
  })

  it('excludes independent nested platform roots from the owned WeChat project', async (test) => {
    const { source, example, destination, expected } = await copyFixture(test)
    await mkdir(path.join(source, 'alipay'), { recursive: true })
    await writeFile(path.join(source, 'alipay/app.js'), 'Alipay independent build')
    const evidence = await copyVerifiedIdeProject(example, destination, expected)
    assert.equal(evidence.status, 'passed')
    await assert.rejects(readFile(path.join(destination, 'alipay/app.js')), { code: 'ENOENT' })
  })
})

describe('IDE build selection', () => {
  it('verifies all seven workspace artifacts when no external manifest is selected', async () => {
    let checked = false
    const inputs = await resolveIdeInputs({
      backend: 'babel',
      async verify(examples, options) {
        checked = true
        assert.deepEqual(examples, canonical)
        assert.deepEqual(options, { backend: 'babel' })
        return { run: { id: runId } }
      },
    })
    assert.equal(checked, true)
    assert.equal(inputs.examples.length, 7)
    assert.equal(inputs.consumerManifestPath, undefined)
  })

  it('selects one backend in canonical order and verifies external source and tarball identities', async () => {
    const manifest = consumerReport()
    manifest.artifacts.reverse()
    const inputs = await external(manifest, async (examples, options) => {
      assert.equal(examples.length, 7)
      assert.ok(examples.every(example => example.project.startsWith('/external/artifacts/auto/')))
      assert.deepEqual(examples.map(example => example.name), canonical.map(example => example.name))
      assert.deepEqual(options, { backend: 'auto', sourceRoot: manifest.sourceRoot, manifestRoot: manifest.builds[1].manifestRoot, candidates: manifest.candidates })
      return { run: { id: runId } }
    })
    assert.equal(inputs.sourceRoot, manifest.sourceRoot)
    assert.ok(path.isAbsolute(inputs.consumerManifestPath))
  })

  it('rejects pending or failed external runs before starting an automator', async () => {
    for (const status of ['pending', 'failed']) {
      await assert.rejects(external({ ...consumerReport(), status }), /did not finish acceptance/)
    }
  })

  it('verifies the current library build/pack batch before accepting its external consumer outputs', async () => {
    const report = consumerReport()
    let checked = false
    const result = await external(report, undefined, async (packs, options) => {
      checked = true
      assert.equal(packs, '/external/packs')
      assert.ok(path.isAbsolute(options.root))
      return { ...report.libraryPacks, candidates: report.candidates }
    })
    assert.equal(checked, true)
    assert.deepEqual(result.libraryPacks, report.libraryPacks)
  })

  it('rejects old source attestations, substituted candidates and mixed library pack runs', async () => {
    const oldSource = new Error('Library packs are stale')
    await assert.rejects(external(consumerReport(), undefined, async () => {
      throw oldSource
    }), error => error === oldSource)
    const wrongCandidate = consumerReport()
    wrongCandidate.candidates[0].sha256 = 'f'.repeat(64)
    await assert.rejects(external(wrongCandidate), /candidates differ from the verified/)
    const wrongRun = consumerReport()
    wrongRun.libraryPacks.runId = 'other-library-run'
    await assert.rejects(external(wrongRun), /library pack run changed/)
    const wrongIdentity = consumerReport()
    wrongIdentity.libraryPacks.id = 'e'.repeat(64)
    await assert.rejects(external(wrongIdentity), /attestation identity changed/)
    const missing = consumerReport()
    delete missing.libraryPacks
    await assert.rejects(external(missing), /attestation is missing/)
  })

  it('rejects missing, duplicate and incorrect-builder WeChat artifacts', async () => {
    const missing = consumerReport()
    missing.artifacts.pop()
    await assert.rejects(external(missing), /all seven canonical/)
    const duplicate = consumerReport()
    duplicate.artifacts.push(duplicate.artifacts.at(-1))
    await assert.rejects(external(duplicate), /all seven canonical/)
    const builder = consumerReport()
    builder.artifacts.find(example => example.backend === 'auto' && example.builder === 'vite').builder = 'webpack'
    await assert.rejects(external(builder), /builder mismatch/)
  })

  it('rejects missing or duplicated backend builds and incomplete candidate sets', async () => {
    const missing = consumerReport()
    missing.builds = missing.builds.filter(build => build.backend !== 'auto')
    await assert.rejects(external(missing), /exactly one auto build/)
    const duplicate = consumerReport()
    duplicate.builds.push(duplicate.builds.at(-1))
    await assert.rejects(external(duplicate), /exactly one auto build/)
    const candidates = consumerReport()
    candidates.candidates.pop()
    await assert.rejects(external(candidates), /exactly six candidate/)
  })

  it('propagates stale provenance and rejects an external manifest pointing to a different run', async () => {
    const stale = new Error('Build provenance is stale')
    await assert.rejects(external(consumerReport(), async () => {
      throw stale
    }), error => error === stale)
    await assert.rejects(external(consumerReport(), async () => ({ run: { id: 'c'.repeat(64) } })), /differs from verified build/)
  })
})
