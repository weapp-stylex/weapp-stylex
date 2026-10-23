import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
// Root infrastructure tests run directly in Node, outside workspace Vitest.
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { promisify } from 'node:util'
import { captureBuildInputs, verifyBuildProvenance, writeBuildProvenance } from './build-provenance.mjs'

const run = promisify(execFile)

async function put(root, file, content) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true })
  await writeFile(path.join(root, file), content)
}

async function fixture(test) {
  const root = await mkdtemp(path.join(tmpdir(), 'stylex-provenance-'))
  test.after(() => rm(root, { recursive: true, force: true }))
  await put(root, '.gitignore', 'artifacts/\nnode_modules/\ndist/\n')
  await put(root, 'package.json', JSON.stringify({ name: 'fixture', dependencies: { vue: '^3.5.0' } }))
  await put(root, 'packages/compiler/src/index.ts', 'export const compiled = 1\n')
  await put(root, 'pnpm-lock.yaml', 'root lock')
  await put(root, 'node_modules/.pnpm/lock.yaml', 'actual installed graph')
  await put(root, 'node_modules/vue/package.json', '{"name":"vue","version":"3.5.44"}')
  await run('git', ['init', '--quiet'], { cwd: root })
  await run('git', ['add', '.'], { cwd: root })
  await run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture'], { cwd: root })
  const examples = [
    { name: 'native-fixture', directory: 'dist/weapp', target: 'weapp', project: path.join(root, 'examples/native-fixture/dist/weapp') },
    { name: 'native-fixture', directory: 'dist/h5', target: 'h5', builder: 'vite', project: path.join(root, 'examples/native-fixture/dist/h5') },
  ]
  for (const example of examples) {
    if (example.target === 'h5') {
      await put(example.project, 'index.html', '<html>built</html>')
      await put(example.project, 'assets/index.js', 'console.log("built")')
    }
    else {
      await put(example.project, 'app.json', '{"pages":["pages/index/index"]}')
      await put(example.project, 'app.js', 'App({})')
      await put(example.project, 'pages/index/index.wxml', '<view>built</view>')
      await put(example.project, 'pages/index/index.wxss', '.sx { color: red }')
    }
  }
  const options = { root, backend: 'babel' }
  async function build(selected = examples, extra = {}) {
    const inputs = await captureBuildInputs({ ...options, ...extra })
    return writeBuildProvenance(selected, { ...options, ...extra, inputs })
  }
  return { root, examples, options, build }
}

describe('build provenance acceptance', () => {
  it('records dirty implementation contents, actual installed graph, versions and recursive artifact hashes', async (test) => {
    const { root, examples, options, build } = await fixture(test)
    await put(root, 'packages/compiler/src/index.ts', 'export const compiled = 2\n')
    await put(root, 'scripts/new-build-fix.mjs', 'export const fixed = true\n')
    const built = await build()
    const verified = await verifyBuildProvenance(examples, options)
    assert.equal(verified.run.id, built.run.id)
    assert.match(verified.run.id, /^[a-f\d]{64}$/)
    assert.equal(JSON.parse(await readFile(verified.run.manifestPath, 'utf8')).id, verified.run.id)
    assert.equal(verified.run.lockfiles.length, 2)
    assert.equal(verified.run.frameworks.find(item => item.name === 'vue').version, '3.5.44')
    assert.ok(verified.run.source.files.some(item => item.path === 'scripts/new-build-fix.mjs'))
    assert.ok(verified.artifacts[0].files.some(item => item.path === 'pages/index/index.wxss' && /^[a-f\d]{64}$/.test(item.sha256)))
    await put(root, 'docs/acceptance-report.md', 'new report after verification')
    await put(root, 'README.md', 'updated documentation')
    await put(root, 'artifacts/ide/report.json', '{"status":"passed"}')
    assert.equal((await verifyBuildProvenance(examples, options)).run.id, built.run.id)
  })

  for (const [label, file, content] of [
    ['tracked source', 'packages/compiler/src/index.ts', 'export const compiled = 3\n'],
    ['new implementation', 'scripts/late-fix.mjs', 'export const late = true\n'],
    ['repository lock', 'pnpm-lock.yaml', 'changed root lock'],
    ['installed lock graph', 'node_modules/.pnpm/lock.yaml', 'changed graph'],
    ['actual framework version', 'node_modules/vue/package.json', '{"name":"vue","version":"3.5.45"}'],
  ]) {
    it(`rejects changed ${label}`, async (test) => {
      const { root, examples, options, build } = await fixture(test)
      await build()
      await put(root, file, content)
      await assert.rejects(verifyBuildProvenance(examples, options), /provenance is stale/)
    })
  }

  it('does not publish provenance when inputs change during the build', async (test) => {
    const { root, examples, options } = await fixture(test)
    const inputs = await captureBuildInputs(options)
    await put(root, 'packages/compiler/src/index.ts', 'changed during build')
    await assert.rejects(writeBuildProvenance(examples, { ...options, inputs }), /provenance is stale/)
    await assert.rejects(verifyBuildProvenance(examples, options), /missing or unreadable/)
  })

  it('rejects missing evidence, missing required outputs and changed nested or extra files', async (test) => {
    const { examples, options, build } = await fixture(test)
    await assert.rejects(verifyBuildProvenance(examples, options), /missing or unreadable/)
    await assert.rejects(writeBuildProvenance(examples, options), /before starting/)
    await build()
    await put(examples[0].project, 'pages/index/index.wxss', '.sx { color: blue }')
    await assert.rejects(verifyBuildProvenance(examples, options), /artifact changed/)
    await build()
    await put(examples[0].project, 'stale.js', 'old chunk')
    await assert.rejects(verifyBuildProvenance(examples, options), /artifact changed/)
    await rm(path.join(examples[0].project, 'app.js'))
    await assert.rejects(build(), /Incomplete artifact.*app.js/)
  })

  it('retains separate backend snapshots and rejects overwritten output even when bytes match', async (test) => {
    const { examples, options, build } = await fixture(test)
    const babel = await build()
    const auto = await build(examples, { backend: 'auto' })
    assert.notEqual(auto.run.id, babel.run.id)
    assert.ok(babel.run.manifestPath.includes(`${path.sep}babel${path.sep}`))
    assert.ok(auto.run.manifestPath.includes(`${path.sep}auto${path.sep}`))
    assert.ok(await readFile(babel.run.manifestPath, 'utf8'))
    await assert.rejects(verifyBuildProvenance(examples, options), /replaced by another run\/backend/)
    assert.equal((await verifyBuildProvenance(examples, { ...options, backend: 'auto' })).run.id, auto.run.id)
  })

  it('rejects mixed target runs and incomplete target selections', async (test) => {
    const { examples, options, build } = await fixture(test)
    await build()
    await assert.rejects(verifyBuildProvenance([{ ...examples[0], directory: 'dist/other' }], options), /Incomplete or mixed/)
    await build([examples[1]])
    await assert.rejects(verifyBuildProvenance(examples, options), /different build runs/)
    await verifyBuildProvenance([examples[0]], options)
  })

  it('verifies external host sources, lockfiles, tarballs and absolute output paths with the same manifest', async (context) => {
    const { root, examples, options, build } = await fixture(context)
    const external = await mkdtemp(path.join(tmpdir(), 'stylex-external-host-'))
    context.after(() => rm(external, { recursive: true, force: true }))
    await put(external, 'examples/native-fixture/src/index.ts', 'export const host = 1')
    await put(external, 'examples/native-fixture/package.json', '{"name":"external-native-host"}')
    await put(external, 'examples/native-fixture/pnpm-lock.yaml', 'nested host lock')
    await put(external, 'examples/native-fixture/node_modules/.pnpm/lock.yaml', 'nested installed graph')
    await put(external, 'pnpm-lock.yaml', 'external lock')
    await put(root, 'artifacts/candidate.tgz', 'exact packed candidate bytes')
    const externalExample = { ...examples[1], project: path.join(external, 'examples/native-fixture/dist/h5') }
    await put(externalExample.project, 'index.html', '<html>external build</html>')
    const extra = { sourceRoot: external, manifestRoot: path.join(root, 'artifacts/external-provenance'), candidates: [path.join(root, 'artifacts/candidate.tgz')] }
    const built = await build([externalExample], extra)
    const verified = await verifyBuildProvenance([externalExample], { ...options, manifestRoot: extra.manifestRoot })
    assert.equal(verified.run.id, built.run.id)
    assert.equal(verified.artifacts[0].project, await realpath(externalExample.project))
    assert.equal(verified.run.candidates.length, 1)
    assert.ok(verified.run.externalSource.sha256)
    await put(external, 'examples/native-fixture/pnpm-lock.yaml', 'changed nested host lock')
    await assert.rejects(verifyBuildProvenance([externalExample], { ...options, manifestRoot: extra.manifestRoot }), /provenance is stale/)
    await put(external, 'examples/native-fixture/pnpm-lock.yaml', 'nested host lock')
    await put(external, 'examples/native-fixture/node_modules/.pnpm/lock.yaml', 'changed nested installed graph')
    await assert.rejects(verifyBuildProvenance([externalExample], { ...options, manifestRoot: extra.manifestRoot }), /provenance is stale/)
    await put(external, 'examples/native-fixture/node_modules/.pnpm/lock.yaml', 'nested installed graph')
    await put(root, 'artifacts/candidate.tgz', 'repacked bytes')
    await assert.rejects(verifyBuildProvenance([externalExample], { ...options, manifestRoot: extra.manifestRoot }), /Candidate tarball checksum changed/)
  })

  it('keeps native WeChat snapshots independent of nested platform output directories', async (test) => {
    const { examples, options, build } = await fixture(test)
    const native = { ...examples[0], name: 'wechat-native' }
    await put(native.project, 'alipay/app.js', 'alipay output')
    await build([native])
    await put(native.project, 'alipay/app.js', 'new independent alipay output')
    await verifyBuildProvenance([native], options)
    await put(native.project, 'pages/index/index.wxss', 'changed actual WeChat styles')
    await assert.rejects(verifyBuildProvenance([native], options), /artifact changed/)
  })

  it('rejects a modified manifest instead of accepting its edited file list', async (test) => {
    const { examples, options, build } = await fixture(test)
    const built = await build()
    const manifest = JSON.parse(await readFile(built.run.manifestPath, 'utf8'))
    manifest.artifacts[0].files = []
    await writeFile(built.run.manifestPath, JSON.stringify(manifest))
    await assert.rejects(verifyBuildProvenance(examples, options), /manifest checksum is invalid/)
  })
})
