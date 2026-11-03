import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const args = process.argv.slice(2)
function option(name, fallback) {
  const index = args.indexOf(`--${name}`)
  if (index < 0) {
    return fallback
  }
  assert.ok(args[index + 1] && !args[index + 1].startsWith('--'), `Missing --${name} value`)
  return args[index + 1]
}
const hostRoot = path.resolve(option('host-root', '.'))
const expectedVersion = option('host-version', '7.8.0')
const policy = option('policy', 'require-success')
assert.ok(['require-success', 'retain-7.4'].includes(policy), `Unknown policy: ${policy}`)
assert.ok(policy !== 'retain-7.4' || process.platform === 'linux', 'The retained-host policy requires real Linux evidence')
const output = path.resolve(option('output', 'artifacts/dependency-upgrade/weapp-vite-synthetic-ids'))
await mkdir(output, { recursive: true })
const requireHost = createRequire(path.join(hostRoot, 'package.json'))
const packageFile = requireHost.resolve('weapp-vite/package.json')
const manifest = JSON.parse(await readFile(packageFile, 'utf8'))
assert.equal(manifest.version, expectedVersion, 'The isolated host differs from the evaluated official version')
const testExport = manifest.exports['./test']
const importTarget = typeof testExport === 'string' ? testExport : testExport.import
assert.equal(typeof importTarget, 'string', 'The official package must export its public test API for import')
const entry = path.resolve(path.dirname(packageFile), importTarget)

// Each real path component is short and legal. The host itself encodes this
// physical path twice into one sidecar ID; no plugin manufactures virtual IDs.
const cwd = path.join(output, 'fixture', 'native-public-test-api-without-stylex', 'physical-directory-with-legal-short-components', 'original-sidecar-watch-dependency-fingerprint')
const observedIdsFile = path.join(output, 'host-module-ids.json')
await mkdir(path.join(cwd, 'src/pages/index'), { recursive: true })
const files = {
  'package.json': '{"private":true,"type":"module"}',
  'project.config.json': '{"appid":"touristappid","miniprogramRoot":"dist"}',
  // Exercise the public source-provider boundary without importing StyleX.
  // The provider neither manufactures IDs nor calls addWatchFile; the passive
  // observer records the module IDs that the host actually generated.
  'vite.config.mjs': `import {isAbsolute} from 'node:path';import {writeFileSync} from 'node:fs';
const physical=request=>request.kind==='script'&&isAbsolute(request.id)&&!request.id.includes('?')&&!request.id.includes('\\0');
const identity={name:'public-identity-script-provider',phase:'source',capabilities:{script:true},create(){return{
claimSource(request){return physical(request)?{id:request.id,entryId:request.id}:false},
transformSource(request){return physical(request)?{code:request.code,handled:true}:null}
}}};const observe={name:'passive-host-module-observer',generateBundle(){writeFileSync(${JSON.stringify(observedIdsFile)},JSON.stringify([...this.getModuleIds()]))}};
export default {logLevel:'error',plugins:[observe],weapp:{platform:'weapp',srcRoot:'src',compilerPlugins:[identity]}}`,
  'src/app.json': '{"pages":["pages/index/index"]}',
  'src/app.ts': 'App({})',
  'src/pages/index/index.json': '{}',
  'src/pages/index/index.ts': 'Page({data:{message:"Public host API, no StyleX"}})',
  'src/pages/index/index.wxml': '<view>{{message}}</view>',
}
await Promise.all(Object.entries(files).map(([file, source]) => writeFile(path.join(cwd, file), source)))
const worker = path.join(output, 'worker.mjs')
await writeFile(worker, `import {buildTestArtifact} from ${JSON.stringify(pathToFileURL(entry).href)};\nawait buildTestArtifact({cwd:${JSON.stringify(cwd)},outDir:'dist',skipNpm:true});\n`)
let result
try {
  const value = await run(process.execPath, [worker], { cwd: hostRoot, timeout: 120000, maxBuffer: 8 * 1024 * 1024 })
  result = { exitCode: 0, signal: null, killed: false, ...value }
}
catch (error) {
  result = { exitCode: error.code, signal: error.signal, killed: error.killed, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
}
await Promise.all([
  writeFile(path.join(output, 'stdout.log'), result.stdout),
  writeFile(path.join(output, 'stderr.log'), result.stderr),
])
const originalLog = `${result.stdout}\n${result.stderr}`
const knownFailure = result.exitCode !== 0
  && !result.killed
  && /ENAMETOOLONG: name too long, stat/.test(originalLog)
  && /weapp-vite:sidecar:script:/.test(originalLog)
  && /fingerprintPaths/.test(originalLog)
  && /weapp-vite\/dist\/test\.mjs/.test(originalLog)
const rejectedPath = originalLog.match(/path: '([^'\n]*weapp-vite:sidecar:script:[^'\n]*)'/)?.[1]
const hostModuleIds = result.exitCode === 0 ? JSON.parse(await readFile(observedIdsFile, 'utf8')) : []
const syntheticIds = hostModuleIds.filter(id => id.startsWith('weapp-vite:sidecar:script:'))
const longSyntheticIdObserved = syntheticIds.some(id => Buffer.byteLength(id) > 255)
async function inventory(directory, base = directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  })
  const values = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return inventory(file, base)
    }
    const data = await readFile(file)
    return [{ path: path.relative(base, file).split(path.sep).join('/'), bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }]
  }))
  return values.flat().sort((a, b) => a.path.localeCompare(b.path))
}
const report = {
  schemaVersion: 1,
  scenario: 'official-public-buildTestArtifact-native-source-provider-sidecar-fingerprinting-without-stylex',
  environment: { platform: process.platform, architecture: process.arch, node: process.version },
  host: { version: manifest.version, entry, packageSha256: createHash('sha256').update(await readFile(packageFile)).digest('hex') },
  fixture: { cwd, stylexImported: false, provider: 'public identity script source provider; no synthetic IDs or addWatchFile calls', sourceFiles: Object.keys(files), longestPhysicalComponentBytes: Math.max(...path.join(cwd, 'src/pages/index/index.ts').split(path.sep).map(value => Buffer.byteLength(value))) },
  result: { exitCode: result.exitCode, signal: result.signal ?? null, killed: result.killed ?? false, knownSyntheticIdFailure: knownFailure, rejectedPath: rejectedPath ?? null, syntheticComponentBytes: rejectedPath ? Buffer.byteLength(path.basename(rejectedPath)) : null },
  observedHostSyntheticIds: syntheticIds.map(id => ({ id, bytes: Buffer.byteLength(id) })),
  outputManifest: await inventory(path.join(cwd, 'dist')),
  policy,
  policyPassed: policy === 'retain-7.4' ? knownFailure : result.exitCode === 0 && longSyntheticIdObserved,
}
await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
if (policy === 'retain-7.4') {
  assert.notEqual(result.exitCode, 0, 'Candidate passed: re-evaluate the retained 7.4 policy instead of accepting a stale exclusion')
  assert.ok(knownFailure, `Candidate failed for an unexpected reason; inspect ${path.join(output, 'stderr.log')}`)
  console.log(`Official weapp-vite ${manifest.version} rejected on Linux: confirmed synthetic sidecar ENAMETOOLONG (${report.result.syntheticComponentBytes} bytes); retained-host policy verified.`)
}
else {
  assert.equal(result.exitCode, 0, `Official host regression failed; inspect ${path.join(output, 'stderr.log')}`)
  assert.ok(longSyntheticIdObserved, 'The public host did not exercise its real overlong synthetic sidecar module IDs')
  assert.ok(report.outputManifest.some(file => file.path === 'app.js'), 'Public API produced no native app.js')
  assert.ok(report.outputManifest.some(file => file.path === 'pages/index/index.wxml'), 'Public API produced no native page template')
  console.log(`Official weapp-vite ${manifest.version} public API passed with legal physical paths and no StyleX.`)
}
