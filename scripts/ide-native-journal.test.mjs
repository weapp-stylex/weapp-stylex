import assert from 'node:assert/strict'
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
// Root infrastructure tests run directly in Node, outside the workspace Vitest projects.
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { nativeJournal } from './ide-native-journal.mjs'

async function fixture(work) {
  const root = await mkdtemp(path.join(tmpdir(), 'stylex-ide-journal-'))
  const directory = path.join(root, 'profile/WeappLog/logs')
  await mkdir(directory, { recursive: true })
  const log = path.join(directory, 'main.log')
  await writeFile(log, '')
  try {
    await work({ root, directory, log })
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('owned IDE native lifecycle', () => {
  it('ignores history and waits for both owned destruction events', async () => {
    await fixture(async ({ root, log }) => {
      await appendFile(log, '[rt:1,win:s1] project ready, projectpath=/owned\nwebcontents-destroyed { winId: \'s1\' }\n')
      const journal = await nativeJournal('/owned', root)
      assert.deepEqual(await journal.read(), { windowId: null, windowClosed: false, webContentsDestroyed: false })
      await appendFile(log, '[rt:2,win:s2] project ready, projectpath=/owned\n')
      await appendFile(log, 'native-window-closed { winId: \'s9\' }\nwebcontents-destroyed { winId: \'s9\' }\n')
      assert.deepEqual(await journal.read(), { windowId: 's2', windowClosed: false, webContentsDestroyed: false })
      await appendFile(log, 'native-window-closed { winId: \'s2\' }\n')
      assert.equal((await journal.read()).webContentsDestroyed, false)
      await appendFile(log, 'webcontents-destroyed { winId: \'s2\' }\n')
      assert.deepEqual(await journal.read(), { windowId: 's2', windowClosed: true, webContentsDestroyed: true })
      assert.ok(!journal.evidence().includes('s9'))
      assert.ok(!journal.evidence().includes('s1'))
    })
  })

  it('reads a new native log after launch and preserves foreign resources', async () => {
    await fixture(async ({ root, directory }) => {
      const journal = await nativeJournal('/owned', root)
      const newLog = path.join(directory, 'next.log')
      const foreign = path.join(root, 'foreign/WeappLog/logs')
      await mkdir(foreign, { recursive: true })
      await writeFile(path.join(foreign, 'main.log'), '[rt:1,win:s3] project ready, projectpath=/foreign\nnative-window-closed { winId: \'s3\' }\nwebcontents-destroyed { winId: \'s3\' }\n')
      await writeFile(newLog, '[rt:1,win:s3] project ready, projectpath=/owned\n')
      assert.deepEqual(await journal.read(), { windowId: 's3', windowClosed: false, webContentsDestroyed: false })
      assert.ok(!journal.evidence().includes('/foreign'))
      await appendFile(newLog, 'native-window-closed { winId: \'s3\' }\nwebcontents-destroyed { winId: \'s3\' }\n')
      assert.equal((await journal.read()).webContentsDestroyed, true)
    })
  })

  it('keeps ownership and destruction evidence across native log rollover', async () => {
    await fixture(async ({ root, log, directory }) => {
      const journal = await nativeJournal('/owned', root)
      await appendFile(log, '[rt:1,win:s4] call executor { cacheSubKey: \'/owned/pages/index/index.json\' }\n')
      assert.equal((await journal.read()).windowId, 's4')
      await rm(log)
      await writeFile(path.join(directory, 'rotated.log'), 'native-window-closed { winId: \'s4\' }\nwebcontents-destroyed { winId: \'s4\' }\n')
      assert.deepEqual(await journal.read(), { windowId: 's4', windowClosed: true, webContentsDestroyed: true })
    })
  })

  it('identifies a window closed before backend initialization', async () => {
    await fixture(async ({ root, log }) => {
      const journal = await nativeJournal('/owned', root)
      await appendFile(log, 'close-fallback-force-close { winId: \'s5\', projectId: \'/owned\' }\nnative-window-closed { winId: \'s5\' }\nwebcontents-destroyed { winId: \'s5\' }\n')
      assert.deepEqual(await journal.read(), { windowId: 's5', windowClosed: true, webContentsDestroyed: true })
    })
  })
})
