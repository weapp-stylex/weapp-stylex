import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
// Root infrastructure tests run directly in Node, outside the workspace Vitest projects.
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { ensureTaroConfig } from './config.mjs'

async function fixture(work) {
  const root = await mkdtemp(path.join(tmpdir(), 'stylex-taro-config-'))
  const directory = path.join(root, '.taro4.0')
  const filename = path.join(directory, 'index.json')
  try {
    await work({ root, directory, filename })
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
}

function initializer(filename) {
  const script = `
    import { readFile } from 'node:fs/promises'
    const { ensureTaroConfig } = await import(process.argv[1])
    process.send('ready')
    process.once('message', async () => {
      try {
        await ensureTaroConfig(process.argv[2])
        process.stdout.write(JSON.stringify(JSON.parse(await readFile(process.argv[2], 'utf8'))))
      } catch (error) {
        console.error(error)
        process.exitCode = 1
      } finally {
        process.disconnect()
      }
    })
  `
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, new URL('./config.mjs', import.meta.url).href, filename], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    timeout: 10_000,
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (value) => {
    stdout += value
  })
  child.stderr.on('data', (value) => {
    stderr += value
  })
  const ready = new Promise((resolve, reject) => {
    child.once('message', resolve)
    child.once('error', reject)
    child.once('close', () => reject(new Error(`Initializer exited before readiness: ${stderr}`)))
  })
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code !== 0) {
        reject(new Error(`Initializer failed (${signal ?? code}): ${stderr}`))
      }
      else {
        resolve(stdout)
      }
    })
  })
  // A worker can fail while the other workers are still reaching the barrier.
  completed.catch(() => {})
  return { child, ready, completed }
}

describe('Taro shared config initialization', () => {
  it('publishes complete JSON before independent cold-start processes read it', async () => {
    await fixture(async ({ filename, directory }) => {
      const workers = Array.from({ length: 8 }, () => initializer(filename))
      try {
        await Promise.all(workers.map(worker => worker.ready))
        for (const worker of workers) {
          worker.child.send('start')
        }
        const results = await Promise.all(workers.map(worker => worker.completed))
        for (const result of results) {
          assert.deepEqual(JSON.parse(result), {})
        }
        assert.equal(await readFile(filename, 'utf8'), '{}\n')
        assert.deepEqual(await readdir(directory), ['index.json'])
      }
      finally {
        for (const worker of workers) {
          if (worker.child.exitCode === null && worker.child.signalCode === null) {
            worker.child.kill()
          }
        }
        await Promise.allSettled(workers.map(worker => worker.completed))
      }
    })
  })

  it('initializes the default config and cleans its temporary directory', async () => {
    await fixture(async ({ filename, directory }) => {
      await ensureTaroConfig(filename)
      assert.equal(await readFile(filename, 'utf8'), '{}\n')
      assert.deepEqual(await readdir(directory), ['index.json'])
    })
  })

  it('preserves existing custom configuration byte for byte', async () => {
    await fixture(async ({ filename, directory }) => {
      const original = '{  "templateSource": "https://example.test/templates",\n "remoteConfigSchemaUrl": "https://example.test/schema.json" }\n'
      await mkdir(directory)
      await writeFile(filename, original)
      await ensureTaroConfig(filename)
      assert.equal(await readFile(filename, 'utf8'), original)
      assert.deepEqual(await readdir(directory), ['index.json'])
    })
  })

  it('uses existing readable configuration in a read-only directory', {
    skip: process.platform === 'win32' || process.getuid?.() === 0,
  }, async () => {
    await fixture(async ({ filename, directory }) => {
      const original = '{ "templateSource": "https://example.test/templates" }\n'
      await mkdir(directory)
      await writeFile(filename, original)
      const originalMode = (await stat(directory)).mode & 0o777
      await chmod(directory, 0o555)
      try {
        await assert.rejects(writeFile(path.join(directory, 'must-not-create'), ''), { code: 'EACCES' })
        await ensureTaroConfig(filename)
        assert.equal(await readFile(filename, 'utf8'), original)
        assert.deepEqual(await readdir(directory), ['index.json'])
      }
      finally {
        await chmod(directory, originalMode)
      }
    })
  })

  it('preserves damaged user configuration for Taro to report', async () => {
    await fixture(async ({ filename, directory }) => {
      const original = '{\n'
      await mkdir(directory)
      await writeFile(filename, original)
      await ensureTaroConfig(filename)
      assert.equal(await readFile(filename, 'utf8'), original)
      assert.deepEqual(await readdir(directory), ['index.json'])
    })
  })

  it('cleans only the temporary directory owned by its invocation', async () => {
    await fixture(async ({ filename, directory }) => {
      const foreign = path.join(directory, '.weapp-stylex-config-foreign')
      await mkdir(foreign, { recursive: true })
      await writeFile(path.join(foreign, 'keep.txt'), 'owned by another invocation')
      await ensureTaroConfig(filename)
      assert.deepEqual((await readdir(directory)).sort(), ['.weapp-stylex-config-foreign', 'index.json'])
      assert.equal(await readFile(path.join(foreign, 'keep.txt'), 'utf8'), 'owned by another invocation')
    })
  })

  it('propagates errors when a config parent is a file', async () => {
    await fixture(async ({ root }) => {
      const blocker = path.join(root, 'not-a-directory')
      await writeFile(blocker, 'keep')
      await assert.rejects(ensureTaroConfig(path.join(blocker, 'index.json')), error => ['EEXIST', 'ENOTDIR'].includes(error.code))
      assert.equal(await readFile(blocker, 'utf8'), 'keep')
      assert.deepEqual(await readdir(root), ['not-a-directory'])
    })
  })

  it('propagates publication errors and cleans the prepared temporary file', async () => {
    await fixture(async ({ directory }) => {
      await assert.rejects(ensureTaroConfig(path.join(directory, 'x'.repeat(300))), error => error.code === 'ENAMETOOLONG')
      assert.deepEqual(await readdir(directory), [])
    })
  })
})
