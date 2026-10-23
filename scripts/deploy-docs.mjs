import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { activeMatchingVersion, cloudflareClient, readDeploymentVersion } from './docs-deployment/cloudflare.mjs'
import { assertBuildIdentity, assertDeploymentContext, buildIdentity, deploymentMessage } from './docs-deployment/identity.mjs'

const workspaceRoot = fileURLToPath(new URL('..', import.meta.url))

export async function deployDocs({ channel, root = workspaceRoot, env = process.env, run = execa, request = fetch } = {}) {
  const target = assertDeploymentContext(env, channel)
  const identity = buildIdentity(env, env.REPO_DOCS_SOURCE_SHA)
  const website = path.join(root, 'apps/docs')
  assertBuildIdentity(JSON.parse(await readFile(path.join(website, 'dist/docs-build.json'), 'utf8')), identity)
  const client = cloudflareClient(env, request)
  let versionId = await activeMatchingVersion(client, target.worker, identity)
  if (!versionId) {
    const temporary = await mkdtemp(path.join(tmpdir(), 'weapp-stylex-docs-deploy-'))
    const outputFile = path.join(temporary, 'wrangler.jsonl')
    try {
      await run('corepack', ['pnpm', 'exec', 'wrangler', 'deploy', '--env', target.environment, '--message', deploymentMessage(identity)], {
        cwd: website,
        env: { ...env, WRANGLER_OUTPUT_FILE_PATH: outputFile },
        stdio: 'inherit',
      })
      versionId = readDeploymentVersion(await readFile(outputFile, 'utf8'), target.worker, target.environment)
      if (await activeMatchingVersion(client, target.worker, identity) !== versionId) {
        throw new Error('The uploaded documentation version is not confirmed active; retry this same deployment.')
      }
    }
    finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }
  const result = { versionId, url: target.url }
  await writeFile(env.REPO_DOCS_RESULT_FILE, `${JSON.stringify(result)}\n`)
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await deployDocs({ channel: process.argv[2] })))
}
