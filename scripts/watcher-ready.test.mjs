import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
// Root infrastructure tests run directly in Node, outside the workspace Vitest projects.
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createWatchBuildWaiter, replaceWatchedSource, waitForWatchedSources } from './watcher-ready.mjs'

const directory = '/fixture'
const sources = ['entry.js', 'shared.js', 'tokens.stylex.js']

function makeWatcher(registered = []) {
  const watcher = new EventEmitter()
  watcher.getWatched = () => ({ [directory]: [...registered] })
  return { watcher, registered }
}

function assertReleased(watcher) {
  assert.equal(watcher.listenerCount('ready'), 0)
  assert.equal(watcher.listenerCount('error'), 0)
}

describe('fixture watcher source readiness', () => {
  it('waits for every source after premature ready and gradual silent registration', async () => {
    const { watcher, registered } = makeWatcher()
    let settled = false
    const pending = waitForWatchedSources(watcher, directory, sources, { interval: 1 })
    const observed = pending.then(() => {
      settled = true
    })
    watcher.emit('ready')
    await nextTurn()
    assert.equal(settled, false)
    registered.push(sources[0])
    watcher.emit('ready')
    await nextTurn()
    assert.equal(settled, false)
    registered.push(sources[1])
    await nextTurn()
    assert.equal(settled, false)
    // ignoreInitial suppresses add events; registration must be observed.
    registered.push(sources[2])
    await observed
    assert.equal(settled, true)
    assertReleased(watcher)
  })

  it('accepts a fully registered watcher whose ready event already fired', async () => {
    const { watcher } = makeWatcher(sources)
    watcher.emit('ready')
    await waitForWatchedSources(watcher, directory, sources)
    assertReleased(watcher)
  })

  it('propagates watcher errors immediately and preserves unrelated listeners', async () => {
    const { watcher } = makeWatcher()
    const unrelated = () => {}
    watcher.on('ready', unrelated)
    const failure = new Error('native watcher failed')
    const pending = waitForWatchedSources(watcher, directory, sources)
    const rejected = assert.rejects(pending, error => error === failure)
    watcher.emit('error', failure)
    await rejected
    assert.deepEqual(watcher.listeners('ready'), [unrelated])
    assert.equal(watcher.listenerCount('error'), 0)
  })

  it('propagates registry read errors and releases its listeners', async () => {
    const { watcher } = makeWatcher()
    const failure = new Error('watch registry unavailable')
    watcher.getWatched = () => {
      throw failure
    }
    await assert.rejects(waitForWatchedSources(watcher, directory, sources), error => error === failure)
    assertReleased(watcher)
  })

  it('times out with the remaining sources and releases its listeners', async () => {
    const { watcher } = makeWatcher([sources[0]])
    await assert.rejects(
      waitForWatchedSources(watcher, directory, sources, { timeout: 5, interval: 1 }),
      /Watcher source registration timed out in \/fixture: shared\.js, tokens\.stylex\.js/,
    )
    assertReleased(watcher)
  })
})

describe('Vite fixture watch build synchronization', () => {
  const file = '/fixture/entry.js'
  const source = 'export const sx=""'
  const end = (waiter) => {
    waiter.onEvent({ code: 'BUNDLE_END' })
    waiter.onEvent({ code: 'END' })
  }
  const transform = (waiter, code = source, id = file) =>
    waiter.plugin.transform.handler(code, id)

  it('requires a completed bundle for the initial build and remembers its END', async () => {
    const waiter = createWatchBuildWaiter()
    let settled = false
    const initial = waiter.waitForBuild().then(() => {
      settled = true
    })
    waiter.onEvent({ code: 'END' })
    await nextTurn()
    assert.equal(settled, false)
    waiter.plugin.buildStart()
    end(waiter)
    await initial
    await waiter.waitForBuild()
  })

  it('ignores old END, unrelated changes and a matching input transformed before its watchChange', async () => {
    const waiter = createWatchBuildWaiter()
    waiter.plugin.buildStart()
    end(waiter)
    let settled = false
    const changed = waiter.waitForBuild({ file, source }).then(() => {
      settled = true
    })
    waiter.onEvent({ code: 'END' })
    waiter.plugin.watchChange('/fixture/other.js')
    waiter.plugin.buildStart()
    transform(waiter)
    end(waiter)
    await nextTurn()
    assert.equal(settled, false)
    waiter.plugin.watchChange(file)
    waiter.plugin.buildStart()
    transform(waiter)
    end(waiter)
    await changed
  })

  it('waits for the build after a target watchChange that arrives during the previous build', async () => {
    const waiter = createWatchBuildWaiter()
    waiter.plugin.buildStart()
    let settled = false
    const changed = waiter.waitForBuild({ file, source }).then(() => {
      settled = true
    })
    waiter.plugin.watchChange(file)
    transform(waiter)
    end(waiter)
    await nextTurn()
    assert.equal(settled, false)
    waiter.plugin.buildStart()
    transform(waiter)
    // A repeated END from the old bundle must not complete this generation.
    waiter.onEvent({ code: 'END' })
    await nextTurn()
    assert.equal(settled, false)
    end(waiter)
    await changed
  })

  it('requires the requested source input in the completed build', async () => {
    const waiter = createWatchBuildWaiter()
    let settled = false
    const changed = waiter.waitForBuild({ file, source }).then(() => {
      settled = true
    })
    waiter.plugin.watchChange(file)
    waiter.plugin.buildStart()
    transform(waiter, 'export const sx="stale"')
    end(waiter)
    await nextTurn()
    assert.equal(settled, false)
    waiter.plugin.watchChange(file)
    waiter.plugin.buildStart()
    transform(waiter)
    end(waiter)
    await changed
  })

  it('propagates a build ERROR to the current and subsequent requests', async () => {
    const waiter = createWatchBuildWaiter()
    const failure = new Error('compiler failed')
    const rejected = assert.rejects(waiter.waitForBuild({ file, source }), error => error === failure)
    waiter.onEvent({ code: 'ERROR', error: failure })
    await rejected
    await assert.rejects(waiter.waitForBuild(), error => error === failure)
  })

  it('times out without accepting unrelated END events and releases the pending request', async () => {
    const waiter = createWatchBuildWaiter({ timeout: 5 })
    const rejected = assert.rejects(waiter.waitForBuild({ file, source }), /timed out for \/fixture\/entry\.js/)
    waiter.plugin.buildStart()
    end(waiter)
    await rejected
    await waiter.waitForBuild()
  })
})

describe('atomic watched source saves', () => {
  it('keeps the previous complete source visible until staging has finished', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'stylex-watch-source-'))
    const filename = path.join(directory, 'entry.js')
    const staged = Promise.withResolvers()
    const release = Promise.withResolvers()
    await writeFile(filename, 'previous complete source')
    async function* chunks() {
      yield 'next '
      staged.resolve()
      await release.promise
      yield 'complete source'
    }
    const saving = replaceWatchedSource(filename, chunks())
    try {
      await staged.promise
      assert.equal(await readFile(filename, 'utf8'), 'previous complete source')
      release.resolve()
      await saving
      assert.equal(await readFile(filename, 'utf8'), 'next complete source')
      assert.deepEqual(await readdir(directory), ['entry.js'])
    }
    finally {
      release.resolve()
      await saving
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('preserves the previous source and removes staging after a failed save', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'stylex-watch-source-'))
    const filename = path.join(directory, 'entry.js')
    const failure = new Error('fixture source stream failed')
    try {
      await writeFile(filename, 'previous complete source')
      async function* chunks() {
        yield 'incomplete '
        throw failure
      }
      await assert.rejects(replaceWatchedSource(filename, chunks()), error => error === failure)
      assert.equal(await readFile(filename, 'utf8'), 'previous complete source')
      assert.deepEqual(await readdir(directory), ['entry.js'])
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
