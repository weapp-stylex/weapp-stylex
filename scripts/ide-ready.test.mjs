import assert from 'node:assert/strict'
// Root infrastructure tests run directly in Node, outside the workspace Vitest projects.
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { waitForAppReady } from './test-ide.mjs'

describe('IDE application readiness before route automation', () => {
  it('waits for the actual index page structure without navigating during compilation', async () => {
    let reads = 0
    let queries = 0
    const index = {
      id: 'index-page',
      path: 'pages/index/index',
      async $$(selector) {
        assert.equal(selector, '#stylex-root')
        queries++
        return queries === 1 ? [] : [{ id: 'root-node' }]
      },
    }
    const mini = {
      async pageStack() {
        reads++
        if (reads === 1) {
          return []
        }
        if (reads === 2) {
          // An older index page under the active loading page is insufficient.
          return [index, { id: 'loading-page', path: 'pages/loading/index' }]
        }
        return [index]
      },
      async currentPage() {
        throw new Error('currentPage must not be queried before application readiness')
      },
      async reLaunch() {
        throw new Error('readiness must not trigger or retry navigation')
      },
    }
    const ready = await waitForAppReady(mini, { timeout: 2000 })
    assert.equal(reads, 4)
    assert.equal(queries, 2)
    assert.equal(ready.pageId, index.id)
    assert.equal(ready.path, index.path)
    assert.equal(ready.selector, '#stylex-root')
    assert.ok(ready.elapsedMs >= 0)
  })

  it('propagates protocol failures instead of treating them as missing DOM nodes', async () => {
    const failure = new Error('host page metadata failure')
    const mini = {
      async pageStack() {
        return [{
          id: 'index-page',
          path: '/pages/index/index',
          async $$() { throw failure },
        }]
      },
    }
    await assert.rejects(waitForAppReady(mini), error => error === failure)
    await assert.rejects(
      waitForAppReady({ async pageStack() { throw failure } }),
      error => error === failure,
    )
  })

  it('fails when runtime errors arrive while reading the first page structure', async () => {
    const logs = []
    const mini = {
      async pageStack() {
        return [{
          id: 'index-page',
          path: 'pages/index/index',
          async $$() {
            logs.push({ type: 'exception', message: { message: 'application initialization failed' } })
            return [{ id: 'root-node' }]
          },
        }]
      },
    }
    await assert.rejects(waitForAppReady(mini, { logs }), /Runtime errors captured in IDE logs/)
  })

  it('fails with a readiness timeout if the host exposes no application page', async () => {
    await assert.rejects(
      waitForAppReady({ async pageStack() { return [] } }, { timeout: 1 }),
      /Application index structure did not become ready before route automation/,
    )
  })
})
