import assert from 'node:assert/strict'
import { cp, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import automator from 'miniprogram-automator'
import { examples } from './example-matrix.mjs'
import { nativeJournal } from './ide-native-journal.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const artifacts = path.join(root, 'artifacts/ide')
const officialSource
  = 'https://devtools.wxqcloud.qq.com.cn/WechatWebDev/nightly/versions/config.json'
const cliPath = process.env.WEAPP_VITE_E2E_DEVTOOLS_CLI_PATH
const appid = process.env.WEAPP_STYLEX_APPID
const startAt = Number(process.env.WEAPP_STYLEX_IDE_START_AT ?? 0)
// A connected automation socket is not proof that the native simulator is ready.
// On macOS, observe the owned page before enabling automation in the same window.
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
async function element(page, id) {
  let node
  await until(async () => {
    node = await page.$(`#${id}`)
    if (node) {
      return true
    }
    if (id === 'stylex-card-root') {
      // The native/Vue fixture gives its custom-component host a stable selector.
      const component = await page.$('#stylex-card')
      node = await component?.$(`#${id}`)
    }
    return !!node
  }, `Missing #${id}`)
  return node
}
export async function assertions(mini, target, phase) {
  await phase('index route')
  const page = await mini.reLaunch('/pages/index/index')
  assert.ok(page)
  await phase('shared page class')
  const rootNode = await element(page, 'stylex-root')
  const initialTheme = await rootNode.attribute('class')
  assert.match(initialTheme, /sx\w+/)
  const background = await rootNode.style('background-color')
  await phase('inline StyleX class and units')
  const inline = await element(page, 'stylex-inline')
  assert.match(await inline.attribute('class'), /sx\w+/)
  assert.equal(await inline.style('margin-top'), '8px')
  await phase('shared component class')
  assert.match(
    await (await element(page, 'stylex-card-root')).attribute('class'),
    /sx\w+/,
  )
  const toggle = await element(page, 'stylex-toggle')
  await phase('conditional class')
  const initial = await toggle.attribute('class')
  await toggle.tap()
  await until(
    async () => (await toggle.attribute('class')) !== initial,
    'Conditional class did not update',
  )
  assert.equal(Number(await toggle.style('opacity')), 0.6)
  await phase('theme variables')
  await (await element(page, 'stylex-theme')).tap()
  await until(
    async () => (await rootNode.attribute('class')) !== initialTheme,
    'Theme class did not update',
  )
  assert.notEqual(
    await rootNode.style('background-color'),
    background,
    'Theme variables did not apply',
  )
  await phase('dynamic width')
  await (await element(page, 'stylex-grow')).tap()
  const meter = await element(page, 'stylex-meter')
  await until(
    async () => (await meter.style('width')) === '120px',
    'Dynamic width did not remain 120px',
  )
  await mini.screenshot({ path: path.join(target, 'index.png') })
  await phase('subpackage route')
  const detail = await mini.reLaunch('/subpackage/detail/index')
  assert.ok(detail)
  assert.match(
    await (await element(detail, 'stylex-detail')).attribute('class'),
    /sx\w+/,
  )
  await mini.screenshot({ path: path.join(target, 'subpackage.png') })
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
  const lockPath = path.join(artifacts, 'suite.lock')
  const lock = await open(lockPath, 'wx')
  const run = path.join(artifacts, `run-${Date.now()}`)
  try {
    await mkdir(run)
    activeRun = run
    await lock.writeFile(JSON.stringify({ pid: process.pid, run }))
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
    for (const [index, example] of examples.entries()) {
      if (index < startAt) {
        continue
      }
      const target = path.join(run, `${index}-${example.name}`)
      const projectPath = path.join(target, 'project')
      await cp(example.project, projectPath, { recursive: true })
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
      const record = {
        name: example.name,
        directory: example.directory,
        status: 'running',
        screenshots: [
          path.join(target, 'index.png'),
          path.join(target, 'subpackage.png'),
        ],
        logs: path.join(target, 'console.json'),
      }
      report.artifacts.push(record)
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
          await until(async () => {
            resource.nativeWindow = await journal.read()
            return journal.evidence().includes('[devtools] webview page ready')
          }, 'Owned project did not reach native page readiness before automation', 45000)
          resource.readyBeforeAutomator = true
        }
        resource.launches++
        await phase('launch')
        mini = await bounded(() => automator.launch({
          cliPath,
          projectPath,
          port,
          timeout: 60000,
          trustProject: true,
        }), 'Automator launch', 65000)
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
        if (journal) {
          resource.nativeWindow = await journal.read()
          assert.ok(resource.nativeWindow.windowId, 'Cannot identify owned native window in DevTools journal')
        }
        await bounded(() => assertions(mini, target, phase), 'Runtime assertions', 90000)
        assert.ok(
          !logs.some(
            log => log.type === 'exception' || log.message?.type === 'error' || log.message?.level === 'error',
          ),
          'Runtime errors captured in IDE logs',
        )
        record.status = 'passed'
      }
      catch (error) {
        record.status = 'failed'
        record.error = error.stack
        failure = error
        if (mini) {
          try {
            record.failureScreenshot = path.join(target, 'failure.png')
            await bounded(() => mini.screenshot({ path: record.failureScreenshot }), 'Failure screenshot', 5000)
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
          // Target the owned project explicitly; the shared IDE host may contain user windows.
          mini?.disconnect()
          await execa(cliPath, ['close', '--project', projectPath], {
            timeout: 15000,
          })
          // Verify only our dedicated automation endpoint; never close other projects.
          await until(() => endpointClosed(port), `Owned automator endpoint ${port} is still live after close`)
          resource.endpointClosed = true
          if (journal) {
            await until(async () => {
              resource.nativeWindow = await journal.read()
              return resource.nativeWindow.windowClosed && resource.nativeWindow.webContentsDestroyed
            }, 'Owned native window did not finish closing')
            resource.nativeLogs = path.join(target, 'native.log')
            await writeFile(resource.nativeLogs, `${journal.evidence()}\n`)
          }
          resource.closed = true
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
    report.status = startAt ? 'partial' : 'passed'
  }
  catch (error) {
    report.status = 'failed'
    report.error = error.stack
    process.exitCode = 1
  }
  finally {
    await lock.close()
    await rm(lockPath)
    await save()
  }
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
