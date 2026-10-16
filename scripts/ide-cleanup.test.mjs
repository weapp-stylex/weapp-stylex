import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { assertIdeStyles } from './ide-scenarios.mjs'
import { closeOwnedIdeResource, withRuntimeLogChecks } from './test-ide.mjs'

async function immediate(check, message) {
  assert.ok(await check(), message)
}

describe('IDE runtime failure during computed style polling', () => {
  it('fails immediately with runtime evidence when an exception appears during a style read', async () => {
    const logs = []
    await assert.rejects(assertIdeStyles({
      async style() {
        logs.push({ type: 'exception', message: 'Theme update failed' })
        return '0px'
      },
    }, { width: { value: 80 } }, {
      until: withRuntimeLogChecks(immediate, logs),
      label: 'dynamic width',
    }), (error) => {
      assert.match(error.message, /Runtime errors captured/)
      assert.equal(error.ideComputedStyle.actual.width, '0px')
      return true
    })
  })

  it('does not query the renderer again after a previously captured runtime error', async () => {
    await assert.rejects(withRuntimeLogChecks(immediate, [{ type: 'console', message: { level: 'error' } }])(async () => {
      assert.fail('Renderer must not be queried after a runtime failure')
    }, 'renderer query'), /Runtime errors captured/)
  })
})

describe('owned IDE cleanup', () => {
  it('closes only the owned project and proves endpoint plus both native destruction events', async () => {
    const target = await mkdtemp(path.join(tmpdir(), 'stylex-ide-cleanup-'))
    const calls = []
    const resource = { closed: false }
    try {
      await closeOwnedIdeResource({
        mini: { disconnect() { calls.push('disconnect') } },
        cliPath: '/selected/cli',
        projectPath: '/owned/project',
        port: 12345,
        target,
        resource,
        journal: {
          async read() { return { windowId: 's1', windowClosed: true, webContentsDestroyed: true } },
          evidence() { return 'owned destruction evidence' },
        },
      }, {
        async runCli(command, args) { calls.push({ command, args }) },
        async isEndpointClosed(port) {
          assert.equal(port, 12345)
          return true
        },
        wait: immediate,
      })
      assert.deepEqual(calls, ['disconnect', { command: '/selected/cli', args: ['close', '--project', '/owned/project'] }])
      assert.equal(resource.endpointClosed, true)
      assert.equal(resource.closed, true)
      assert.equal(resource.nativeWindow.webContentsDestroyed, true)
    }
    finally {
      await rm(target, { recursive: true, force: true })
    }
  })

  it('still closes the owned project when SDK disconnect fails and keeps cleanup failed', async () => {
    const failure = new Error('SDK disconnect failed')
    const resource = { closed: false }
    let closed = false
    await assert.rejects(closeOwnedIdeResource({
      mini: { disconnect() { throw failure } },
      cliPath: '/cli',
      projectPath: '/owned',
      port: 54321,
      resource,
    }, {
      async runCli(command, args) {
        assert.deepEqual(args, ['close', '--project', '/owned'])
        closed = true
      },
      async isEndpointClosed() { return true },
      wait: immediate,
    }), error => error instanceof AggregateError && error.errors.includes(failure))
    assert.equal(closed, true)
    assert.equal(resource.endpointClosed, true)
    assert.equal(resource.closed, false)
  })

  it('does not claim cleanup when the owned endpoint is still open', async () => {
    const resource = { closed: false }
    await assert.rejects(closeOwnedIdeResource({ cliPath: '/cli', projectPath: '/owned', port: 54321, resource }, {
      async runCli() {},
      async isEndpointClosed() { return false },
      wait: immediate,
    }), /cleanup failed/)
    assert.equal(resource.closed, false)
    assert.equal(resource.endpointClosed, undefined)
  })
})
