import assert from 'node:assert/strict'
// Root infrastructure tests run directly in Node, outside the workspace Vitest projects.
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { launchIdeAutomator } from './ide-automator.mjs'

const launchOptions = { cliPath: '/selected/cli', projectPath: '/owned', port: 54321, timeout: 60000, trustProject: true }

function forbidden(message) {
  return () => {
    throw new Error(message)
  }
}

describe('IDE automation connection after owned native readiness', () => {
  it('waits for the new native page before public SDK connect and version checking', async () => {
    const entered = Promise.withResolvers()
    const ready = Promise.withResolvers()
    const checkpoint = {}
    const mini = { id: 'owned-mini' }
    const events = []
    const stages = []
    const reports = []
    let nativeReady = false
    const pending = launchIdeAutomator(launchOptions, {
      sdk: {
        launch: forbidden('native observation must not use SDK launch'),
        async connect(options) {
          assert.equal(nativeReady, true, 'SDK version checking ran before native readiness')
          assert.deepEqual(options, { wsEndpoint: 'ws://127.0.0.1:54321' })
          events.push('connect')
          return mini
        },
      },
      async runCli(command, args, options) {
        assert.equal(command, launchOptions.cliPath)
        assert.deepEqual(args, ['auto', '--project', '/owned', '--auto-port', '54321', '--trust-project'])
        assert.deepEqual(options, { timeout: 60000 })
        events.push('cli')
        return { stdout: 'automation enabled', stderr: 'selected CLI evidence' }
      },
      journal: {
        async checkpoint() {
          events.push('checkpoint')
          return checkpoint
        },
        async pageReadyAfter(cursor) {
          assert.equal(cursor, checkpoint)
          events.push('readiness')
          return nativeReady
        },
      },
      async until(check, message, timeout) {
        assert.match(message, /Owned simulator/)
        assert.equal(timeout, 45000)
        assert.equal(await check(), false)
        entered.resolve()
        await ready.promise
        assert.equal(await check(), true)
      },
      async phase(stage) { stages.push(stage) },
      async report(value) { reports.push(value) },
    })
    await entered.promise
    assert.deepEqual(events, ['checkpoint', 'cli', 'readiness'])
    assert.deepEqual(reports, [{ cli: { stdout: 'automation enabled', stderr: 'selected CLI evidence' }, nativeReady: false }])
    nativeReady = true
    ready.resolve()
    assert.deepEqual(await pending, { mini, nativeReady: true, cli: { stdout: 'automation enabled', stderr: 'selected CLI evidence' } })
    assert.deepEqual(events, ['checkpoint', 'cli', 'readiness', 'readiness', 'connect'])
    assert.deepEqual(reports[1], { nativeReady: true })
    assert.deepEqual(stages, ['launch via selected CLI', 'post-launch native readiness', 'connect automator'])
  })

  it('preserves CLI failure evidence without waiting or connecting', async () => {
    const failure = Object.assign(new Error('selected CLI failed'), { stdout: 'partial stdout', stderr: 'CLI error' })
    const reports = []
    await assert.rejects(launchIdeAutomator(launchOptions, {
      sdk: { launch: forbidden('must not fallback'), connect: forbidden('must not connect') },
      async runCli() { throw failure },
      journal: { async checkpoint() { return {} } },
      until: forbidden('CLI failure must not enter native readiness'),
      async report(value) { reports.push(value) },
    }), error => error === failure)
    assert.deepEqual(reports, [{ cli: { stdout: 'partial stdout', stderr: 'CLI error' }, nativeReady: false }])
  })

  it('fails before launching when the native checkpoint cannot be read', async () => {
    const failure = new Error('native journal unreadable')
    await assert.rejects(launchIdeAutomator(launchOptions, {
      sdk: { launch: forbidden('must not fallback'), connect: forbidden('must not connect') },
      runCli: forbidden('must not launch before checkpoint'),
      journal: { async checkpoint() { throw failure } },
      until: forbidden('must not wait before launch'),
    }), error => error === failure)
  })

  it('keeps CLI evidence but does not connect after a native readiness failure', async () => {
    const failure = new Error('new owned page did not become ready')
    const checkpoint = {}
    const reports = []
    await assert.rejects(launchIdeAutomator(launchOptions, {
      sdk: { launch: forbidden('must not fallback'), connect: forbidden('must not connect') },
      async runCli() { return { stdout: 'CLI done', stderr: '' } },
      journal: {
        async checkpoint() { return checkpoint },
        async pageReadyAfter(cursor) {
          assert.equal(cursor, checkpoint)
          return false
        },
      },
      async until(check) {
        assert.equal(await check(), false)
        throw failure
      },
      async report(value) { reports.push(value) },
    }), error => error === failure)
    assert.deepEqual(reports, [{ cli: { stdout: 'CLI done', stderr: '' }, nativeReady: false }])
  })

  it('retains public SDK connection failures after readiness without another launch', async () => {
    const failure = new Error('SDK version check rejected runtime')
    const reports = []
    await assert.rejects(launchIdeAutomator(launchOptions, {
      sdk: {
        launch: forbidden('must not retry launch'),
        async connect() { throw failure },
      },
      async runCli() { return { stdout: '', stderr: '' } },
      journal: {
        async checkpoint() { return {} },
        async pageReadyAfter() { return true },
      },
      async until(check) { assert.equal(await check(), true) },
      async report(value) { reports.push(value) },
    }), error => error === failure)
    assert.deepEqual(reports, [{ cli: { stdout: '', stderr: '' }, nativeReady: false }, { nativeReady: true }])
  })

  it('forwards the existing public launch options when native observation is unavailable', async () => {
    const options = { ...launchOptions, account: 'test-account', ticket: 'test-ticket', args: ['--language', 'en'], cwd: '/cwd', projectConfig: { appid: 'owned-appid' } }
    const mini = { id: 'fallback-mini' }
    const stages = []
    const result = await launchIdeAutomator(options, {
      sdk: {
        async launch(received) {
          assert.equal(received, options)
          return mini
        },
        connect: forbidden('fallback must use SDK launch'),
      },
      runCli: forbidden('fallback must preserve SDK launch'),
      journal: null,
      until: forbidden('fallback cannot observe native readiness'),
      async phase(stage) { stages.push(stage) },
    })
    assert.deepEqual(result, { mini, nativeReady: false, cli: null })
    assert.deepEqual(stages, ['launch'])
  })
})
