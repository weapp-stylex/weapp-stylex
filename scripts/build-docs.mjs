import { constants } from 'node:fs'
import { access, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { chromium } from 'playwright'
import { buildIdentity } from './docs-deployment/identity.mjs'

const workspaceRoot = fileURLToPath(new URL('..', import.meta.url))

export async function buildDocs({ root = workspaceRoot, env = process.env, run = execa, browserExecutable = chromium.executablePath() } = {}) {
  const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: root, env })
  const identity = buildIdentity(env, stdout.trim())
  const buildEnv = { ...env, REPO_DOCS_CHANNEL: identity.channel }
  const identityFile = path.join(root, 'apps/docs/dist/docs-build.json')
  // A failed validation must never leave the previous artifact authorized.
  await rm(identityFile, { force: true })
  const commands = [
    ['--filter', './packages/*', 'build'],
    ...['lint', 'typecheck', 'build', 'check:site', 'test'].map(script => ['--filter', 'docs', script]),
  ]
  const browserAvailable = await access(browserExecutable, constants.X_OK).then(() => true, () => false)
  if (env.CI === 'true' || !browserAvailable) {
    commands.push(['exec', 'playwright', 'install', ...(env.CI === 'true' ? ['--with-deps'] : []), 'chromium'])
  }
  commands.push(['exec', 'node', 'scripts/test-docs-browser.mjs'])
  for (const args of commands) {
    await run('corepack', ['pnpm', ...args], { cwd: root, env: buildEnv, stdio: 'inherit' })
  }
  await writeFile(identityFile, `${JSON.stringify(identity)}\n`)
  return identity
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await buildDocs()
}
