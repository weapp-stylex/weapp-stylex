import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
// Infrastructure regressions run directly in Node outside workspace Vitest projects.
// eslint-disable-next-line test/no-import-node-test
import { it } from 'node:test'
import { buildDocs } from '../build-docs.mjs'
import { deployDocs } from '../deploy-docs.mjs'
import { activeMatchingVersion, cloudflareClient, readDeploymentVersion } from './cloudflare.mjs'
import { assertBuildIdentity, assertDeploymentContext, buildIdentity, deploymentMessage } from './identity.mjs'

const sourceSha = 'a'.repeat(40)
const versionId = '12345678-1234-1234-1234-123456789abc'
const otherVersion = '87654321-4321-4321-4321-cba987654321'
const managedEnv = {
  REPO_DOCS_SITE: 'stylex',
  REPO_DOCS_CHANNEL: 'stable',
  REPO_DOCS_SOURCE_SHA: sourceSha,
  REPO_DOCS_DEPLOYMENT_ID: 'b'.repeat(64),
  REPO_DOCS_RELEASE_ID: 'release-completed',
  REPO_DOCS_RESULT_FILE: '/tmp/result.json',
  REPO_DOCS_URL: 'https://stylex.weapp.dev',
  GITHUB_ACTIONS: 'true',
  GITHUB_RUN_ID: '1',
  REPO_DOCS_CONCURRENCY_GROUP: 'docs-stylex-stable',
  CLOUDFLARE_API_TOKEN: 'test-token',
  CLOUDFLARE_ACCOUNT_ID: 'c'.repeat(32),
}
const identity = buildIdentity(managedEnv, sourceSha)

async function fixture(t, channel = 'stable') {
  const root = await mkdtemp(path.join(tmpdir(), 'stylex-docs-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const env = { ...managedEnv, REPO_DOCS_RESULT_FILE: path.join(root, 'result.json') }
  if (channel === 'preview') {
    Object.assign(env, {
      REPO_DOCS_CHANNEL: 'preview',
      REPO_DOCS_URL: 'https://preview.stylex.weapp.dev',
      REPO_DOCS_RELEASE_ID: '',
      REPO_DOCS_CONCURRENCY_GROUP: '',
      GITHUB_ACTIONS: '',
      GITHUB_RUN_ID: '',
    })
  }
  const artifact = path.join(root, 'apps/docs/dist/docs-build.json')
  await mkdir(path.dirname(artifact), { recursive: true })
  await writeFile(artifact, JSON.stringify(buildIdentity(env, sourceSha)))
  return { root, env, artifact }
}

function provider({ message = deploymentMessage(identity), versions = [{ version_id: versionId, percentage: 100 }] } = {}) {
  return async (_worker, endpoint) => endpoint === 'deployments'
    ? { deployments: [{ created_on: '2026-10-23T00:00:00Z', versions }] }
    : { id: versionId, annotations: { 'workers/message': message } }
}

function remote({ deployed = true, message = deploymentMessage(identity), id = versionId } = {}) {
  const state = { deployed, message, id, requests: [] }
  state.request = async (url) => {
    state.requests.push(url)
    if (!state.deployed) {
      return Response.json({ success: false, errors: [{ code: 10007 }] }, { status: 404 })
    }
    return Response.json({
      success: true,
      result: url.endsWith('/deployments')
        ? { deployments: [{ created_on: '2026-10-23T00:00:00Z', versions: [{ version_id: state.id, percentage: 100 }] }] }
        : { id: state.id, annotations: { 'workers/message': state.message } },
    })
  }
  return state
}

it('local validation supports both channels without authorizing deployment', () => {
  assert.equal(buildIdentity({}, sourceSha).channel, 'stable')
  assert.equal(buildIdentity({ REPO_DOCS_CHANNEL: 'preview' }, sourceSha).channel, 'preview')
  assert.throws(() => assertDeploymentContext({}, 'stable'), /Direct documentation deployment/)
  assert.throws(() => assertDeploymentContext({ REPO_DOCS_CHANNEL: 'preview' }, 'preview'), /Direct documentation deployment/)
  assert.throws(() => buildIdentity({ REPO_DOCS_SOURCE_SHA: 'd'.repeat(40) }, sourceSha), /checked-out Git commit/)
})

it('stable requires the completed release, managed workflow and production concurrency group', () => {
  assert.equal(assertDeploymentContext(managedEnv, 'stable').worker, 'weapp-stylex-docs')
  for (const key of ['REPO_DOCS_RELEASE_ID', 'GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'REPO_DOCS_CONCURRENCY_GROUP']) {
    assert.throws(() => assertDeploymentContext({ ...managedEnv, [key]: '' }, 'stable'), /managed docs-stylex-stable/)
  }
  for (const key of ['REPO_DOCS_SITE', 'REPO_DOCS_SOURCE_SHA', 'REPO_DOCS_DEPLOYMENT_ID', 'REPO_DOCS_RESULT_FILE']) {
    assert.throws(() => assertDeploymentContext({ ...managedEnv, [key]: '' }, 'stable'), /Direct documentation deployment/)
  }
  assert.throws(() => assertDeploymentContext({ ...managedEnv, REPO_DOCS_URL: 'https://preview.stylex.weapp.dev' }, 'stable'))
  assert.throws(() => assertDeploymentContext(managedEnv, 'preview'), /Direct documentation deployment/)
})

it('stale and preview artifacts cannot be used for a stable deployment', async (t) => {
  const h = await fixture(t)
  for (const key of Object.keys(identity)) {
    assert.throws(() => assertBuildIdentity({ ...identity, [key]: 'mismatch' }, identity), /artifact does not match/)
  }
  await writeFile(h.artifact, JSON.stringify({ ...identity, channel: 'preview' }))
  await assert.rejects(deployDocs({ ...h, channel: 'stable', request: () => assert.fail('No remote request is allowed for a stale artifact') }), /artifact does not match/)
})

it('recovery only accepts the newest active version with 100 percent traffic and matching identity', async () => {
  assert.equal(await activeMatchingVersion(provider(), 'weapp-stylex-docs', identity), versionId)
  assert.equal(await activeMatchingVersion(provider({ message: 'another-release' }), 'weapp-stylex-docs', identity), undefined)
  await assert.rejects(activeMatchingVersion(provider({ versions: [{ version_id: versionId, percentage: 50 }, { version_id: otherVersion, percentage: 50 }] }), 'weapp-stylex-docs', identity), /100%/)
  await assert.rejects(activeMatchingVersion(async () => ({}), 'weapp-stylex-docs', identity), /invalid deployments/)
  const history = async (_worker, endpoint) => endpoint === 'deployments'
    ? { deployments: [
        { created_on: '2026-10-22T00:00:00Z', versions: [{ version_id: versionId, percentage: 100 }] },
        { created_on: '2026-10-23T00:00:00Z', versions: [{ version_id: otherVersion, percentage: 100 }] },
      ] }
    : { id: otherVersion, annotations: { 'workers/message': 'newer-deployment' } }
  assert.equal(await activeMatchingVersion(history, 'weapp-stylex-docs', identity), undefined)
})

it('an interrupted upload recovers the active identity without uploading again', async (t) => {
  const h = await fixture(t)
  const state = remote({ deployed: false })
  let outputFile
  await assert.rejects(deployDocs({
    ...h,
    channel: 'stable',
    request: state.request,
    run: async (_command, _args, options) => {
      outputFile = options.env.WRANGLER_OUTPUT_FILE_PATH
      state.deployed = true
      throw new Error('Runner interrupted after the remote deployment')
    },
  }), /Runner interrupted/)
  await assert.rejects(stat(path.dirname(outputFile)), { code: 'ENOENT' })
  await assert.rejects(readFile(h.env.REPO_DOCS_RESULT_FILE), { code: 'ENOENT' })
  const result = await deployDocs({ ...h, channel: 'stable', request: state.request, run: () => assert.fail('Recovery must not upload again') })
  assert.deepEqual(result, { versionId, url: 'https://stylex.weapp.dev' })
  assert.deepEqual(JSON.parse(await readFile(h.env.REPO_DOCS_RESULT_FILE, 'utf8')), result)
})

it('preview deploys only its Worker and confirms the exact reported version before returning success', async (t) => {
  const h = await fixture(t, 'preview')
  const state = remote({ deployed: false })
  let outputFile
  const result = await deployDocs({
    ...h,
    channel: 'preview',
    request: state.request,
    run: async (command, args, options) => {
      assert.equal(command, 'corepack')
      assert.deepEqual(args.slice(0, 7), ['pnpm', 'exec', 'wrangler', 'deploy', '--env', 'preview', '--message'])
      outputFile = options.env.WRANGLER_OUTPUT_FILE_PATH
      await writeFile(outputFile, JSON.stringify({ type: 'deploy', worker_name: 'weapp-stylex-docs-preview', wrangler_environment: 'preview', version_id: versionId }))
      state.deployed = true
    },
  })
  assert.deepEqual(result, { versionId, url: 'https://preview.stylex.weapp.dev' })
  assert.ok(state.requests.every(url => url.includes('/scripts/weapp-stylex-docs-preview/')))
  await assert.rejects(stat(path.dirname(outputFile)), { code: 'ENOENT' })
})

it('successful upload output cannot confirm a different remotely active version', async (t) => {
  const h = await fixture(t)
  const state = remote({ deployed: false })
  await assert.rejects(deployDocs({
    ...h,
    channel: 'stable',
    request: state.request,
    run: async (_command, _args, options) => {
      await writeFile(options.env.WRANGLER_OUTPUT_FILE_PATH, JSON.stringify({ type: 'deploy', worker_name: 'weapp-stylex-docs', version_id: versionId }))
      state.deployed = true
      state.id = otherVersion
    },
  }), /not confirmed active/)
  await assert.rejects(readFile(h.env.REPO_DOCS_RESULT_FILE), { code: 'ENOENT' })
})

it('Wrangler evidence must identify the exact Worker, environment and valid version', () => {
  const output = JSON.stringify({ type: 'deploy', worker_name: 'weapp-stylex-docs-preview', wrangler_environment: 'preview', version_id: versionId })
  assert.equal(readDeploymentVersion(output, 'weapp-stylex-docs-preview', 'preview'), versionId)
  assert.throws(() => readDeploymentVersion(output, 'weapp-stylex-docs', ''), /did not report/)
  assert.throws(() => readDeploymentVersion(output, 'weapp-stylex-docs-preview', ''), /did not report/)
  assert.throws(() => readDeploymentVersion('{broken', 'weapp-stylex-docs', ''), SyntaxError)
})

it('only an explicit missing Worker permits a first deployment; unknown API failures stop', async () => {
  const client = cloudflareClient(managedEnv, async () => Response.json({ success: false, errors: [{ code: 10007 }] }, { status: 404 }))
  assert.equal(await client('weapp-stylex-docs-preview', 'deployments', true), undefined)
  await assert.rejects(client('weapp-stylex-docs', `versions/${versionId}`), /HTTP 404/)
  for (const status of [403, 429, 500]) {
    const failed = cloudflareClient(managedEnv, async () => Response.json({ success: false, errors: [{ code: 10000 }] }, { status }))
    await assert.rejects(failed('weapp-stylex-docs', 'deployments', true), new RegExp(`HTTP ${status}`))
  }
  assert.throws(() => cloudflareClient({}), /required to verify/)
})

it('docs build propagates channel context and stamps the artifact only after every validation', async (t) => {
  const h = await fixture(t, 'preview')
  const commands = []
  const result = await buildDocs({ ...h, browserExecutable: process.execPath, run: async (command, args, options) => {
    if (command === 'git') {
      return { stdout: sourceSha }
    }
    await assert.rejects(readFile(h.artifact), { code: 'ENOENT' })
    assert.equal(options.env.REPO_DOCS_CHANNEL, 'preview')
    assert.equal(options.env.REPO_DOCS_URL, 'https://preview.stylex.weapp.dev')
    commands.push(args.join(' '))
  } })
  assert.equal(commands.length, 7)
  assert.equal(commands[0], 'pnpm --filter ./packages/* build')
  assert.equal(commands.at(-1), 'pnpm exec node scripts/test-docs-browser.mjs')
  assert.deepEqual(JSON.parse(await readFile(h.artifact, 'utf8')), result)
})

it('docs build installs Chromium for a missing local cache and system dependencies in CI', async (t) => {
  for (const ci of [false, true]) {
    const h = await fixture(t)
    const commands = []
    await buildDocs({
      ...h,
      env: { ...h.env, CI: String(ci) },
      browserExecutable: path.join(h.root, 'missing-browser'),
      run: async (command, args) => {
        if (command === 'git') {
          return { stdout: sourceSha }
        }
        commands.push(args)
      },
    })
    assert.deepEqual(commands.at(-2), ['pnpm', 'exec', 'playwright', 'install', ...(ci ? ['--with-deps'] : []), 'chromium'])
    assert.deepEqual(commands.at(-1), ['pnpm', 'exec', 'node', 'scripts/test-docs-browser.mjs'])
  }
})

it('failed validation removes stale artifact authorization and stops later steps', async (t) => {
  const h = await fixture(t)
  let steps = 0
  await assert.rejects(buildDocs({ ...h, run: async (command) => {
    if (command === 'git') {
      return { stdout: sourceSha }
    }
    steps++
    throw new Error('Declaration build failed')
  } }), /Declaration build failed/)
  assert.equal(steps, 1)
  await assert.rejects(readFile(h.artifact), { code: 'ENOENT' })
})
