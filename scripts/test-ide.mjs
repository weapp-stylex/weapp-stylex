import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import automator from 'miniprogram-automator'
import { examples as artifactMatrix } from './example-matrix.mjs'
import { launchIdeAutomator } from './ide-automator.mjs'
import { copyVerifiedIdeProject, resolveIdeInputs } from './ide-inputs.mjs'
import { nativeJournal } from './ide-native-journal.mjs'
import { assertions, captureIdeScreenshot, loadIdeExpectations } from './ide-scenarios.mjs'
import { withIdeSuiteLock } from './ide-suite-lock.mjs'

export { assertions } from './ide-scenarios.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const examples = artifactMatrix.filter(example => example.target === 'weapp')
const artifacts = path.join(root, 'artifacts/ide')
const officialSource
  = 'https://devtools.wxqcloud.qq.com.cn/WechatWebDev/nightly/versions/config.json'
const cliPath = process.env.WEAPP_VITE_E2E_DEVTOOLS_CLI_PATH
const appid = process.env.WEAPP_STYLEX_APPID
const startAt = Number(process.env.WEAPP_STYLEX_IDE_START_AT ?? 0)
// A connected automation socket is not proof that the application is ready.
// Observe fresh owned native readiness before the SDK version check, then
// application structure before reLaunch. The macOS preopen path cannot replace
// the post-auto barrier because automation can trigger another compilation.
const preopen = process.env.WEAPP_STYLEX_IDE_PREOPEN === '1'
  || (process.platform === 'darwin' && process.env.WEAPP_STYLEX_IDE_PREOPEN !== '0')
const reportPath = path.join(artifacts, startAt ? `partial-${startAt}.json` : 'report.json')
const report = {
  checkedAt: new Date().toISOString(),
  status: 'pending',
  officialSource,
  officialDownloadPage:
    'https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html',
  cliPath,
  appid: appid ?? null,
  installedVersion: null,
  latestStable: null,
  blockers: [],
  resources: [],
  artifacts: [],
  scope: startAt ? `partial: artifacts ${startAt + 1}–${examples.length}` : 'full',
  backend: process.env.WEAPP_STYLEX_BACKEND === 'auto' ? 'auto' : 'babel',
  startup: preopen ? 'open-before-auto' : 'direct',
}
let activeRun
async function save() {
  const content = `${JSON.stringify(report, null, 2)}\n`
  await writeFile(
    reportPath,
    content,
  )
  if (activeRun) {
    await writeFile(path.join(activeRun, 'report.json'), content)
  }
}
async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) =>
    server.once('error', reject).listen(0, '127.0.0.1', resolve),
  )
  const port = server.address().port
  await new Promise((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve())),
  )
  return port
}
async function endpointClosed(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (closed) => {
      socket.destroy()
      resolve(closed)
    }
    socket.once('connect', () => finish(false))
    socket.once('error', error => finish(error.code === 'ECONNREFUSED'))
    socket.setTimeout(1000, () => finish(false))
  })
}
async function bounded(work, label, timeout = 15000) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout)
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}
async function until(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout
  do {
    if (await bounded(check, message, Math.max(1, deadline - Date.now()))) {
      return
    }
    await delay(150)
  } while (Date.now() < deadline)
  throw new Error(message)
}
export function assertRuntimeLogs(logs) {
  assert.ok(
    !logs.some(
      log => log.type === 'exception' || log.message?.type === 'error' || log.message?.level === 'error',
    ),
    'Runtime errors captured in IDE logs',
  )
}
export function withRuntimeLogChecks(wait, logs) {
  return (check, ...options) => wait(async () => {
    assertRuntimeLogs(logs)
    const result = await check()
    assertRuntimeLogs(logs)
    return result
  }, ...options)
}
export async function waitForAppReady(mini, { logs = [], timeout = 45000 } = {}) {
  const started = Date.now()
  let ready
  await until(async () => {
    assertRuntimeLogs(logs)
    // reLaunch first calls currentPage(), whose host metadata is absent while
    // compilation is in progress. Read the page stack without changing routes.
    const stack = await mini.pageStack()
    const page = stack.at(-1)
    if (page?.path.replace(/^\//, '') !== 'pages/index/index') {
      return false
    }
    // Page.$ catches every protocol error and returns null. $$ distinguishes
    // an absent root from a real host/runtime failure, which must still fail.
    const nodes = await page.$$('#stylex-root')
    assertRuntimeLogs(logs)
    if (!nodes.length) {
      return false
    }
    ready = { pageId: page.id, path: page.path, selector: '#stylex-root', elapsedMs: Date.now() - started }
    return true
  }, 'Application index structure did not become ready before route automation', timeout)
  return ready
}
export async function closeOwnedIdeResource({ mini, cliPath: selectedCli, projectPath, port, journal, resource, target }, {
  runCli = execa,
  isEndpointClosed = endpointClosed,
  wait = until,
} = {}) {
  const failures = []
  try {
    await mini?.disconnect()
  }
  catch (error) {
    failures.push(error)
  }
  try {
    // The shared host may contain user windows. Only close this owned project.
    await runCli(selectedCli, ['close', '--project', projectPath], { timeout: 15000 })
  }
  catch (error) {
    failures.push(error)
  }
  try {
    await wait(() => isEndpointClosed(port), `Owned automator endpoint ${port} is still live after close`)
    resource.endpointClosed = true
    if (journal) {
      await wait(async () => {
        resource.nativeWindow = await journal.read()
        return resource.nativeWindow.windowClosed && resource.nativeWindow.webContentsDestroyed
      }, 'Owned native window did not finish closing')
      resource.nativeLogs = path.join(target, 'native.log')
      await writeFile(resource.nativeLogs, `${journal.evidence()}\n`)
    }
  }
  catch (error) {
    failures.push(error)
  }
  resource.closed = failures.length === 0
  if (failures.length) {
    throw new AggregateError(failures, 'Owned IDE resource cleanup failed')
  }
}
async function main() {
  assert.ok(Number.isInteger(startAt) && startAt >= 0 && startAt < examples.length, 'Invalid IDE artifact start index')
  await mkdir(artifacts, { recursive: true })
  try {
    const response = await fetch(officialSource, {
      signal: AbortSignal.timeout(25000),
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const data = await response.json()
    report.latestStable
      = data.channels.find(channel => channel.id === 'stable')?.version ?? null
    await writeFile(
      path.join(artifacts, 'official-versions.json'),
      JSON.stringify(data, null, 2),
    )
    if (!report.latestStable) {
      report.blockers.push(
        'Official stable channel version could not be confirmed',
      )
    }
  }
  catch (error) {
    report.blockers.push(
      `Official stable version lookup failed: ${error.message}`,
    )
  }
  if (!cliPath) {
    report.blockers.push(
      'Set WEAPP_VITE_E2E_DEVTOOLS_CLI_PATH to the selected stable installation CLI',
    )
  }
  else {
    try {
      const manifest = JSON.parse(
        await readFile(
          path.resolve(
            path.dirname(cliPath),
            '../Resources/app.asar.unpacked/package.json',
          ),
          'utf8',
        ),
      )
      report.installedVersion = manifest.version
      if (manifest.version !== report.latestStable) {
        report.blockers.push(
          'Selected DevTools installation does not match the verified official stable version',
        )
      }
    }
    catch (error) {
      report.blockers.push(
        `Cannot verify selected installation version: ${error.message}`,
      )
    }
  }
  if (!/^wx[\da-f]{16}$/i.test(appid ?? '')) {
    report.blockers.push(
      'Set WEAPP_STYLEX_APPID to a real WeChat AppID; tourist mode is not IDE acceptance',
    )
  }
  if (report.blockers.length) {
    await save()
    process.stderr.write(
      `IDE acceptance pending: ${report.blockers.join('; ')}\nReport: ${path.join(artifacts, 'report.json')}\n`,
    )
    process.exitCode = 2
    return
  }
  const inputOptions = { backend: report.backend, consumerManifest: process.env.WEAPP_STYLEX_IDE_CONSUMER_MANIFEST }
  const inputs = await resolveIdeInputs(inputOptions)
  const { examples: selectedExamples, sourceRoot } = inputs
  report.provenance = inputs.provenance
  report.consumerManifest = inputs.consumerManifestPath ?? null
  report.libraryPacks = inputs.libraryPacks ?? null
  await withIdeSuiteLock(async (lock) => {
    report.suiteLock = { path: lock.path, owner: lock.owner, released: false }
    const run = path.join(artifacts, `run-${Date.now()}`)
    try {
      await mkdir(run)
      activeRun = run
      if (process.platform !== 'win32') {
        const { stdout } = await execa('ps', ['-axo', 'pid=,command='])
        // Read-only guard. Never stop or reuse another suite's automator.
        if (
          stdout
            .split('\n')
            .some(line => /(?:cli|cli\.bat).*--auto-port/.test(line))
        ) {
          throw new Error(
            'Another automator launch is active; run IDE suites globally in sequence',
          )
        }
      }
      for (const [index, example] of selectedExamples.entries()) {
        if (index < startAt) {
          continue
        }
        const target = path.join(run, `${index}-${example.name}`)
        const projectPath = path.join(target, 'project')
        const expectations = await loadIdeExpectations(example, { workspace: sourceRoot })
        const record = {
          name: example.name,
          directory: example.directory,
          status: 'running',
          provenance: report.provenance.artifacts.find(artifact => artifact.name === example.name && artifact.directory === example.directory),
          expectations,
          copy: {},
          screenshots: [
            path.join(target, 'index.png'),
            path.join(target, 'subpackage.png'),
            path.join(target, 'reentry.png'),
          ],
          logs: path.join(target, 'console.json'),
        }
        report.artifacts.push(record)
        try {
          await copyVerifiedIdeProject(example, projectPath, record.provenance, { evidence: record.copy })
        }
        catch (error) {
          record.status = 'failed'
          record.error = error.stack
          throw error
        }
        const configPath = path.join(projectPath, 'project.config.json')
        const config = JSON.parse(await readFile(configPath, 'utf8'))
        await writeFile(
          configPath,
          JSON.stringify({ ...config, appid, miniprogramRoot: '.' }, null, 2),
        )
        await writeFile(
          path.join(projectPath, 'project.private.config.json'),
          JSON.stringify(
            {
              condition: {
                miniprogram: {
                  list: [
                    {
                      name: 'StyleX index',
                      pathName: 'pages/index/index',
                      query: '',
                    },
                    {
                      name: 'StyleX ordinary subpackage',
                      pathName: 'subpackage/detail/index',
                      query: '',
                    },
                  ],
                },
              },
            },
            null,
            2,
          ),
        )
        const port = await freePort()
        const resource = {
          projectPath,
          port,
          createdByTask: true,
          launches: 0,
          closed: false,
        }
        report.resources.push(resource)
        async function phase(stage) {
          record.stage = stage
          process.stdout.write(`[IDE] ${example.name}/${example.directory}: ${stage}\n`)
          await save()
        }
        const logs = []
        const journal = await nativeJournal(projectPath)
        let mini
        let failure
        try {
          if (preopen) {
            assert.ok(journal, 'Native readiness observation is required for preopen acceptance')
            await phase('open project before automation')
            const result = await execa(cliPath, ['open', '--project', projectPath], { timeout: 60000 })
            record.openLog = path.join(target, 'open.log')
            await writeFile(record.openLog, `${result.stdout}\n${result.stderr}\n`)
            // Opening a project may initialize only its editor. The auto CLI
            // starts the simulator; launchIdeAutomator requires a fresh native
            // readiness event after that command before connecting the SDK.
            resource.openedBeforeAutomator = true
          }
          resource.launches++
          await phase('launch')
          const launched = await launchIdeAutomator({
            cliPath,
            projectPath,
            port,
            timeout: 60000,
            trustProject: true,
          }, {
            sdk: {
              launch: options => bounded(() => automator.launch(options), 'Automator launch', 65000),
              connect: options => bounded(() => automator.connect(options), 'Automator connect', 15000),
            },
            runCli: execa,
            journal,
            until: withRuntimeLogChecks(until, logs),
            phase,
            async report({ cli, nativeReady }) {
              if (cli) {
                record.autoLog = path.join(target, 'auto.log')
                await writeFile(record.autoLog, `${cli.stdout}\n${cli.stderr}\n`)
              }
              resource.readyAfterAutomator = nativeReady
              await save()
            },
          })
          mini = launched.mini
          assert.ok(
            mini,
            'DevTools launch did not establish an automator connection; check login and service port',
          )
          // MiniProgram.on('console') drops App.enableLog's Promise. Await it so failure still runs teardown.
          mini.addListener('console', message =>
            logs.push({ at: new Date().toISOString(), stage: record.stage, type: 'console', message }))
          mini.addListener('exception', message =>
            logs.push({ at: new Date().toISOString(), stage: record.stage, type: 'exception', message }))
          await phase('connected environment')
          await bounded(() => mini.send('App.enableLog'), 'App.enableLog')
          record.toolInfo = await bounded(() => mini.send('Tool.getInfo'), 'Tool.getInfo')
          record.systemInfo = await bounded(() => mini.systemInfo(), 'System info')
          record.account = await bounded(() => mini.callWxMethod('getAccountInfoSync'), 'Account info')
          assert.equal(record.account.miniProgram.appId, appid)
          assert.equal(record.toolInfo.version, report.installedVersion)
          assert.ok(record.toolInfo.SDKVersion, 'Tool.getInfo omitted the actual SDK version')
          assert.equal(record.systemInfo.SDKVersion, record.toolInfo.SDKVersion, 'Tool and system SDK versions differ')
          if (journal) {
            resource.nativeWindow = await journal.read()
            assert.ok(resource.nativeWindow.windowId, 'Cannot identify owned native window in DevTools journal')
          }
          await phase('application readiness')
          record.applicationReady = await waitForAppReady(mini, { logs })
          await save()
          record.assertions = { rounds: 3, checks: [], screenshots: [] }
          await bounded(() => assertions(mini, target, phase, {
            example,
            systemInfo: record.systemInfo,
            expectations,
            until: withRuntimeLogChecks(until, logs),
            evidence: record.assertions,
          }), 'Runtime assertions', 90000)
          assertRuntimeLogs(logs)
          record.status = 'passed'
        }
        catch (error) {
          record.status = 'failed'
          record.error = error.stack
          record.failedComputedStyle = error.ideComputedStyle
          failure = error
          if (mini) {
            try {
              record.failureScreenshot = path.join(target, 'failure.png')
              await bounded(() => captureIdeScreenshot(mini, record.failureScreenshot), 'Failure screenshot', 5000)
            }
            catch (captureError) {
              record.screenshotError = captureError.message
            }
          }
        }
        finally {
          try {
            await writeFile(record.logs, JSON.stringify(logs, null, 2))
          }
          catch (error) {
            record.status = 'failed'
            record.logError = error.message
            failure = failure
              ? new AggregateError([failure, error], 'IDE validation and log capture failed')
              : error
          }
          try {
            await closeOwnedIdeResource({ mini, cliPath, projectPath, port, journal, resource, target })
          }
          catch (error) {
            resource.cleanupError = error.message
            failure = failure
              ? new AggregateError(
                  [failure, error],
                  'IDE validation and cleanup failed',
                )
              : error
          }
          finally {
            await save()
          }
        }
        if (failure) {
          throw failure
        }
      }
      const finalInputs = await resolveIdeInputs(inputOptions)
      assert.equal(finalInputs.provenance.run.id, inputs.provenance.run.id, 'IDE build provenance changed during the suite')
      assert.equal(finalInputs.libraryPacks?.id ?? null, inputs.libraryPacks?.id ?? null, 'IDE library build/pack batch changed during the suite')
      report.finalInputVerification = {
        checkedAt: new Date().toISOString(),
        runId: finalInputs.provenance.run.id,
        libraryPacksId: finalInputs.libraryPacks?.id ?? null,
      }
      report.status = startAt ? 'partial' : 'passed'
    }
    catch (error) {
      report.status = 'failed'
      report.error = error.stack
      process.exitCode = 1
    }
    finally {
      await save()
    }
  }, { owner: { workspace: root, backend: report.backend } })
  report.suiteLock.released = true
  await save()
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(async (error) => {
    report.status = 'failed'
    report.error = error.stack
    process.exitCode = 1
    await save()
    process.stderr.write(`${error.stack}\n`)
  })
}
