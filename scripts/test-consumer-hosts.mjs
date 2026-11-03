import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { captureBuildInputs, verifyBuildProvenance, writeBuildProvenance } from './build-provenance.mjs'
import { candidateSummary, ensureArtifactsDirectory, fileHash, installConsumer, packageRoot, prepareCandidates, root, run, supportedUniHostVersions, verifyCandidateGraph, verifyCandidates } from './consumers/candidates.mjs'
import { examples, targets } from './example-matrix.mjs'

const tooling = createRequire(new URL('../package.json', import.meta.url))
const { parse } = tooling('yaml')
const uniHostPackages = ['uni-app', 'uni-components', 'uni-h5', 'uni-mp-alipay', 'uni-mp-toutiao', 'uni-mp-weixin', 'vite-plugin-uni']
const requestedTarget = process.env.WEAPP_STYLEX_TARGET
const requestedBackend = process.env.WEAPP_STYLEX_BACKEND
const requestedNames = process.env.WEAPP_STYLEX_CONSUMER_NAMES?.split(',')
const requestedUniHostVersion = process.env.WEAPP_STYLEX_UNI_HOST_VERSION
const entry = process.env.WEAPP_STYLEX_CONSUMER_ENTRY ?? 'facade'
assert.ok(['facade', 'adapter'].includes(entry), 'WEAPP_STYLEX_CONSUMER_ENTRY must be facade or adapter')
assert.ok(!requestedTarget || Object.hasOwn(targets, requestedTarget), 'WEAPP_STYLEX_TARGET must be weapp, alipay, tt or h5')
assert.ok(!requestedBackend || ['babel', 'auto'].includes(requestedBackend), 'WEAPP_STYLEX_BACKEND must be babel or auto')
assert.ok(!requestedUniHostVersion || supportedUniHostVersions.includes(requestedUniHostVersion), `WEAPP_STYLEX_UNI_HOST_VERSION must be ${supportedUniHostVersions.join(' or ')}`)
assert.ok(!requestedUniHostVersion || !requestedNames || requestedNames.every(name => name === 'uni-vue3'), 'WEAPP_STYLEX_UNI_HOST_VERSION selects only the uni-vue3 consumer')
const matrix = examples.filter(example => (!requestedTarget || example.target === requestedTarget) && (!requestedNames || requestedNames.includes(example.name)) && (!requestedUniHostVersion || example.name === 'uni-vue3'))
assert.ok(matrix.length, 'Consumer host selection is empty')
if (requestedNames) {
  assert.ok(requestedNames.every(name => matrix.some(example => example.name === name)), 'Unknown consumer host name')
}
const backends = requestedBackend ? [requestedBackend] : ['babel', 'auto']
await ensureArtifactsDirectory()
const evidence = await mkdtemp(path.join(root, 'artifacts', 'consumer-hosts-'))
// Keep this outside the checkout: an ancestor node_modules or a workspace link
// must never rescue a candidate with a missing published dependency.
const workspace = await realpath(await mkdtemp(path.join(tmpdir(), 'weapp-stylex-consumer-hosts-')))
const sourceRoot = path.join(workspace, 'source')
const prepared = await prepareCandidates(process.env.WEAPP_STYLEX_TEST_PACKS_DIR ?? path.join(workspace, 'artifacts', 'packs'), { pack: !process.env.WEAPP_STYLEX_TEST_PACKS_DIR })
const candidates = candidateSummary(prepared.candidates)
const manifestPath = path.join(evidence, 'manifest.json')
const report = { checkedAt: new Date().toISOString(), status: 'pending', entry, requestedUniHostVersion, workspace, sourceRoot, libraryPacks: prepared.attestation, candidates, consumers: [], builds: [], artifacts: [] }
const save = () => writeFile(manifestPath, `${JSON.stringify(report, null, 2)}\n`)
await save()
try {
  const lock = parse(await readFile(path.join(root, 'node_modules/.pnpm/lock.yaml'), 'utf8'))
  const fixtureNames = [...new Set(matrix.map(example => example.name))]
  await mkdir(path.join(sourceRoot, 'scripts/taro'), { recursive: true })
  for (const file of ['tsconfig.base.json', 'scripts/project-config.mjs', 'scripts/taro/vite-compat.mjs', 'scripts/taro/vite-compat.d.mts']) {
    await cp(path.join(root, file), path.join(sourceRoot, file))
  }
  for (const name of fixtureNames) {
    const source = path.join(root, 'examples', name)
    const consumer = path.join(sourceRoot, 'examples', name)
    await cp(source, consumer, {
      recursive: true,
      filter: file => !['node_modules', 'dist', '.weapp-vite', '.turbo', 'test'].includes(path.basename(file)),
    })
    const original = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'))
    const adapter = `@weapp-stylex/${name.startsWith('wechat-') ? 'weapp-vite' : name.startsWith('taro-') ? 'taro' : 'uni-app'}`
    const directPackage = entry === 'adapter' ? adapter : 'weapp-stylex'
    const importer = lock.importers[`examples/${name}`]
    assert.ok(importer, `Installed lockfile has no ${name} importer; install the workspace before testing consumers`)
    const dependencies = {}
    for (const dependency of Object.keys({ ...original.dependencies, ...original.devDependencies }).filter(name => name !== 'weapp-stylex')) {
      const resolved = importer.dependencies?.[dependency] ?? importer.devDependencies?.[dependency]
      assert.ok(resolved?.version && !resolved.version.startsWith('link:'), `No locked external version for ${name}/${dependency}`)
      dependencies[dependency] = resolved.version.split('(')[0]
    }
    const uniHostVersion = name === 'uni-vue3' ? requestedUniHostVersion ?? dependencies['@dcloudio/vite-plugin-uni'] : undefined
    if (name === 'uni-vue3') {
      assert.ok(supportedUniHostVersions.includes(uniHostVersion), `Unsupported locked uni-app host version: ${uniHostVersion}`)
      for (const dependency of uniHostPackages) {
        const packageName = `@dcloudio/${dependency}`
        assert.ok(Object.hasOwn(dependencies, packageName), `The uni-app consumer must declare ${packageName}`)
        dependencies[packageName] = uniHostVersion
      }
      assert.equal(dependencies.vite, '5.2.8', 'The evaluated uni-app channels require Vite 5.2.8')
      assert.equal(dependencies.vue, '3.4.21', 'The evaluated uni-app channels require Vue 3.4.21')
    }
    if (entry === 'adapter') {
      dependencies['@stylexjs/stylex'] = prepared.candidates.find(candidate => candidate.name === '@weapp-stylex/core').manifest.dependencies['@stylexjs/stylex']
      await useAdapterEntry(consumer)
    }
    const { installed, logs } = await installConsumer(consumer, prepared.candidates, directPackage, { dependencies, host: true, uniHostVersion })
    const uniHost = name === 'uni-vue3' ? await verifyUniHost(consumer, uniHostVersion) : undefined
    report.consumers.push({ name, entry, directPackage, directory: consumer, logs, dependencies, uniHost, candidatePackages: Object.fromEntries(installed), lockfile: { path: path.join(consumer, 'pnpm-lock.yaml'), sha256: await fileHash(path.join(consumer, 'pnpm-lock.yaml')) } })
    await save()
  }
  for (const backend of backends) {
    await verifyCandidates(prepared)
    const inputs = await captureBuildInputs({ root, sourceRoot, backend, candidates })
    const artifacts = []
    for (const example of matrix) {
      const consumer = path.join(sourceRoot, 'examples', example.name)
      const directPackage = report.consumers.find(consumer => consumer.name === example.name).directPackage
      await verifyCandidateGraph(consumer, prepared.candidates, directPackage)
      const env = { ...process.env, NODE_PATH: '', NODE_ENV: 'production', WEAPP_STYLEX_BACKEND: backend }
      let command
      if (example.name.startsWith('wechat-')) {
        command = ['weapp-vite', 'build', '-p', example.target === 'h5' ? 'web' : example.target, '--outDir', example.directory]
      }
      else if (example.builder) {
        command = ['taro', 'build', '--type', example.target]
        env.WEAPP_STYLEX_BUILDER = example.builder
        env.TARO_ENV = example.target
      }
      else {
        command = ['uni', 'build', '-p', example.uniPlatform]
      }
      const executable = await realpath(path.join(consumer, 'node_modules/.bin', command[0]))
      assert.ok(executable.startsWith(`${consumer}${path.sep}`), 'Host CLI resolved outside its isolated consumer')
      const log = path.join(evidence, `${backend}-${example.name}-${example.target}${example.builder ? `-${example.builder}` : ''}.log`)
      process.stdout.write(`Building isolated candidate ${backend}/${example.name}/${example.target}${example.builder ? `/${example.builder}` : ''}\n`)
      try {
        const result = await run('corepack', ['pnpm', 'exec', ...command], { cwd: consumer, env, timeout: 300000, maxBuffer: 16 * 1024 * 1024 })
        await writeFile(log, result.stdout + result.stderr)
      }
      catch (error) {
        await writeFile(log, (error.stdout ?? '') + (error.stderr ?? ''))
        process.stderr.write(`Isolated build failed; diagnostics: ${log}\n`)
        throw error
      }
      if (example.target === 'weapp') {
        await run(process.execPath, ['../../scripts/project-config.mjs', example.directory, example.name, example.target], { cwd: consumer, env })
      }
      const built = path.join(consumer, example.directory)
      const project = path.join(workspace, 'artifacts', backend, example.name, example.directory)
      await mkdir(path.dirname(project), { recursive: true })
      await cp(built, project, { recursive: true, filter: file => !(example.target === 'weapp' && example.name.startsWith('wechat-') && ['alipay', 'tt', 'web'].includes(path.relative(built, file))) })
      await verifyOutput(project, example)
      artifacts.push({ ...example, project })
      report.artifacts.push({ ...example, entry, backend, project, buildLog: log })
      await save()
    }
    const manifestRoot = path.join(evidence, 'provenance')
    const provenance = await writeBuildProvenance(artifacts, { root, sourceRoot, backend, candidates, inputs, manifestRoot })
    await verifyBuildProvenance(artifacts, { root, sourceRoot, backend, candidates, manifestRoot })
    report.builds.push({ backend, manifestRoot, ...provenance })
    await save()
  }
  await verifyCandidates(prepared)
  report.status = 'passed'
  await save()
  process.stdout.write(`Isolated candidate hosts (${entry}): ${report.artifacts.length} real builds passed. IDE-ready projects and provenance: ${manifestPath}\n`)
}
catch (error) {
  report.status = 'failed'
  report.error = error.stack
  await save()
  throw error
}
finally {
  await rm(prepared.unpacked, { recursive: true, force: true })
  // Preserve source, lockfiles, candidates and output for IDE acceptance and
  // inspection. Removing the reported workspace explicitly cleans up this run.
  process.stdout.write(`External consumer workspace retained: ${workspace}\n`)
}

async function verifyUniHost(directory, version) {
  const requireConsumer = createRequire(path.join(directory, 'package.json'))
  const requirePlugin = createRequire(requireConsumer.resolve('@dcloudio/vite-plugin-uni/package.json'))
  for (const name of uniHostPackages) {
    assert.equal(requireConsumer(`@dcloudio/${name}/package.json`).version, version, `The uni-app consumer installed a different ${name} channel`)
  }
  const requirePlatform = createRequire(requireConsumer.resolve('@dcloudio/uni-mp-weixin/package.json'))
  const requireMpVite = createRequire(requirePlatform.resolve('@dcloudio/uni-mp-vite/package.json'))
  const walkerPackage = JSON.parse(await readFile(path.join(await packageRoot(requireMpVite, 'estree-walker'), 'package.json'), 'utf8'))
  const versions = {
    channel: version,
    vite: requireConsumer('vite/package.json').version,
    vue: requireConsumer('vue/package.json').version,
    compilerSfc: requirePlugin('@vue/compiler-sfc/package.json').version,
    mpVite: requirePlatform('@dcloudio/uni-mp-vite/package.json').version,
    estreeWalker: walkerPackage.version,
  }
  assert.deepEqual(versions, { channel: version, vite: '5.2.8', vue: '3.4.21', compilerSfc: '3.4.21', mpVite: version, estreeWalker: '2.0.2' })
  const visited = []
  requireMpVite('estree-walker').walk({ type: 'Identifier', name: 'stylex' }, {
    enter(node) { visited.push(node.type) },
  })
  assert.deepEqual(visited, ['Identifier'], 'The uni-app package extension must provide the CommonJS estree-walker API')
  return versions
}

async function useAdapterEntry(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, item.name)
    if (item.isDirectory()) {
      await useAdapterEntry(filename)
    }
    else if (/\.(?:[cm]?[jt]sx?|vue)$/.test(item.name)) {
      const source = await readFile(filename, 'utf8')
      const replaced = source.replace(/(['"])weapp-stylex(?:\/(weapp-vite|taro|uni-app))?\1/g, (_match, quote, adapter) => `${quote}${adapter ? `@weapp-stylex/${adapter}` : '@stylexjs/stylex'}${quote}`)
      if (replaced !== source) {
        await writeFile(filename, replaced)
      }
    }
  }
}

async function verifyOutput(project, example) {
  const files = []
  async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.isDirectory()) {
        await visit(path.join(directory, item.name))
      }
      else {
        files.push(path.join(directory, item.name))
      }
    }
  }
  await visit(project)
  const css = (await Promise.all(files.filter(file => file.endsWith(example.styleExtension)).map(file => readFile(file, 'utf8')))).join('\n')
  if (example.cssDelivery !== 'weapp-web') {
    assert.match(css, /\.sx[a-z0-9]+/, `${example.name} has no compiled atomic CSS`)
    assert.match(css, /padding:16px/, `${example.name} lost StyleX numeric units`)
    assert.match(css, /--sx/, `${example.name} lost theme variables`)
    assert.doesNotMatch(css, /@layer|:not\(#/)
  }
  if (example.target !== 'h5') {
    const app = JSON.parse(await readFile(path.join(project, 'app.json'), 'utf8'))
    assert.ok(app.pages.includes('pages/index/index'))
    const subpackages = app.subPackages ?? app.subpackages
    assert.ok(subpackages.some(subpackage => subpackage.root === 'subpackage'))
    assert.doesNotMatch(css, /:root/)
    assert.ok(files.some(file => file.endsWith(example.templateExtension)))
  }
  else {
    const html = await readFile(path.join(project, 'index.html'), 'utf8')
    if (example.cssDelivery === 'stylesheet') {
      assert.match(html, /<link\s[^>]*data-weapp-stylex[^>]*>/)
    }
    assert.ok(!files.some(file => /\.(?:wxml|wxss|axml|acss|ttml|ttss)$/.test(file)))
  }
}
