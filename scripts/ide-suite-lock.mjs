import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

export const ideSuiteLockPath = path.join(homedir(), '.cache/weapp-stylex/ide-suite.lock')

export async function acquireIdeSuiteLock({ lockPath = ideSuiteLockPath, owner = {} } = {}) {
  const token = randomUUID()
  const identity = { ...owner, pid: process.pid, token, acquiredAt: new Date().toISOString() }
  const content = `${JSON.stringify(identity, null, 2)}\n`
  await mkdir(path.dirname(lockPath), { recursive: true })
  try {
    // All checkouts belonging to this user contend for this same atomic mkdir.
    await mkdir(lockPath, { mode: 0o700 })
  }
  catch (error) {
    if (error.code !== 'EEXIST') {
      throw error
    }
    let entries
    try {
      entries = await readdir(lockPath)
    }
    catch {
      entries = []
    }
    throw new Error(`Another IDE suite owns ${lockPath}${entries.length ? ` (${entries.join(', ')})` : ''}; no existing lock was removed`, { cause: error })
  }
  const tokenPath = path.join(lockPath, `${token}.json`)
  try {
    await writeFile(tokenPath, content, { flag: 'wx', mode: 0o600 })
  }
  catch (error) {
    // Never recursively remove a lock directory, including failed acquisition.
    await unlink(tokenPath).catch(() => {})
    await rmdir(lockPath).catch(() => {})
    throw error
  }
  let released = false
  return {
    path: lockPath,
    owner: identity,
    async release() {
      if (released) {
        return
      }
      let stored
      try {
        stored = await readFile(tokenPath, 'utf8')
      }
      catch (error) {
        throw new Error(`IDE suite lock ownership changed: ${lockPath}; no foreign lock was removed`, { cause: error })
      }
      if (stored !== content) {
        throw new Error(`IDE suite lock ownership changed: ${lockPath}; no foreign lock was removed`)
      }
      // The unguessable child name belongs only to this acquisition. If another
      // owner replaced the directory, its different child can never be unlinked.
      await unlink(tokenPath)
      await rmdir(lockPath)
      released = true
    },
  }
}

export async function withIdeSuiteLock(work, options) {
  const lock = await acquireIdeSuiteLock(options)
  let result
  let failure
  let failed = false
  try {
    result = await work(lock)
  }
  catch (error) {
    failure = error
    failed = true
  }
  try {
    await lock.release()
  }
  catch (error) {
    if (failed) {
      throw new AggregateError([failure, error], 'IDE suite and lock cleanup failed')
    }
    throw error
  }
  if (failed) {
    throw failure
  }
  return result
}
