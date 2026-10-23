import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readdir, readFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { acquireIdeSuiteLock, withIdeSuiteLock } from './ide-suite-lock.mjs'

async function temporary(work) {
  const directory = await mkdtemp(path.join(tmpdir(), 'stylex-ide-lock-'))
  try {
    await work(path.join(directory, 'suite.lock'), directory)
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('user-level IDE suite exclusion', () => {
  it('allows exactly one simultaneous owner and lets a later suite acquire after release', async () => temporary(async (lockPath) => {
    const acquisitions = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => acquireIdeSuiteLock({ lockPath, owner: { workspace: `/checkout-${index}` } })))
    const winners = acquisitions.filter(result => result.status === 'fulfilled')
    assert.equal(winners.length, 1)
    assert.equal(acquisitions.filter(result => result.status === 'rejected').length, 7)
    await winners[0].value.release()
    const next = await acquireIdeSuiteLock({ lockPath })
    await next.release()
    await next.release()
  }))

  it('excludes a separate process in a different checkout without touching its lock', async () => temporary(async (lockPath, directory) => {
    const moduleUrl = new URL('./ide-suite-lock.mjs', import.meta.url).href
    const source = `import {acquireIdeSuiteLock} from ${JSON.stringify(moduleUrl)};
const lock=await acquireIdeSuiteLock({lockPath:${JSON.stringify(lockPath)},owner:{workspace:'/other-checkout'}});
process.stdout.write('held\\n');process.stdin.once('data',async()=>{await lock.release();process.exit(0)});`
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'] })
    const exited = once(child, 'exit')
    try {
      await once(child.stdout, 'data')
      const before = await readdir(lockPath)
      await assert.rejects(acquireIdeSuiteLock({ lockPath, owner: { workspace: '/this-checkout' } }), /Another IDE suite owns/)
      assert.deepEqual(await readdir(lockPath), before)
      assert.equal(JSON.parse(await readFile(path.join(lockPath, before[0]), 'utf8')).workspace, '/other-checkout')
    }
    finally {
      child.stdin.end('release\n')
      const [code] = await exited
      assert.equal(code, 0)
    }
  }))

  it('releases its own lock after a suite failure and preserves the failure', async () => temporary(async (lockPath) => {
    const failure = new Error('runtime assertion failed')
    await assert.rejects(withIdeSuiteLock(async () => {
      throw failure
    }, { lockPath }), error => error === failure)
    await assert.rejects(readdir(lockPath), { code: 'ENOENT' })
  }))

  it('does not remove a replacement owner when its original directory disappeared', async () => temporary(async (lockPath) => {
    const original = await acquireIdeSuiteLock({ lockPath })
    await rename(lockPath, `${lockPath}.original`)
    const replacement = await acquireIdeSuiteLock({ lockPath, owner: { workspace: '/replacement' } })
    await assert.rejects(original.release(), /ownership changed/)
    assert.deepEqual(await readdir(lockPath), [`${replacement.owner.token}.json`])
    await replacement.release()
  }))
})
