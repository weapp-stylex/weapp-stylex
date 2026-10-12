import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
// Root infrastructure tests run directly in Node, outside the workspace Vitest projects.
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { waitForWatchedSources } from './watcher-ready.mjs'

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
