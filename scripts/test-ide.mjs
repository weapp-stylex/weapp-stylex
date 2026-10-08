import assert from 'node:assert/strict'
import { cp, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import automator from 'miniprogram-automator'
import { examples } from './example-matrix.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const artifacts = path.join(root, 'artifacts/ide')
const officialSource
  = 'https://devtools.wxqcloud.qq.com.cn/WechatWebDev/nightly/versions/config.json'
const cliPath = process.env.WEAPP_VITE_E2E_DEVTOOLS_CLI_PATH
const appid = process.env.WEAPP_STYLEX_APPID
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
}
async function save() {
  await writeFile(
    path.join(artifacts, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
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
async function until(check, message) {
  const deadline = Date.now() + 15000
  do {
    if (await check()) {
      return
    }
    await delay(150)
  } while (Date.now() < deadline)
  throw new Error(message)
}
async function element(page, id) {
  await page.waitFor(`#${id}`)
  const node = await page.$(`#${id}`)
  assert.ok(node, `Missing #${id}`)
  return node
}
async function assertions(mini, target) {
  const page = await mini.reLaunch('/pages/index/index')
  assert.ok(page)
  const rootNode = await element(page, 'stylex-root')
  const initialTheme = await rootNode.attribute('class')
  assert.match(initialTheme, /sx\w+/)
  const background = await rootNode.style('background-color')
  assert.match(
    await (await element(page, 'stylex-card-root')).attribute('class'),
    /sx\w+/,
  )
  const toggle = await element(page, 'stylex-toggle')
  const initial = await toggle.attribute('class')
  await toggle.tap()
  await until(
    async () => (await toggle.attribute('class')) !== initial,
    'Conditional class did not update',
  )
  assert.equal(Number(await toggle.style('opacity')), 0.6)
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
  await (await element(page, 'stylex-grow')).tap()
  const meter = await element(page, 'stylex-meter')
  await until(
    async () => (await meter.style('width')) === '120px',
    'Dynamic width did not remain 120px',
  )
  await mini.screenshot({ path: path.join(target, 'index.png') })
  const detail = await mini.reLaunch('/subpackage/detail/index')
  assert.ok(detail)
  assert.match(
    await (await element(detail, 'stylex-detail')).attribute('class'),
    /sx\w+/,
  )
  await mini.screenshot({ path: path.join(target, 'subpackage.png') })
}
async function main() {
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
      const logs = []
      let mini
      let failure
      try {
        resource.launches++
        mini = await automator.launch({
          cliPath,
          projectPath,
          port,
          timeout: 60000,
          trustProject: true,
        })
        assert.ok(
          mini,
          'DevTools launch did not establish an automator connection; check login and service port',
        )
        mini.on('console', message =>
          logs.push({ type: 'console', message }))
        mini.on('exception', message =>
          logs.push({ type: 'exception', message }))
        record.systemInfo = await mini.systemInfo()
        record.account = await mini.callWxMethod('getAccountInfoSync')
        assert.equal(record.account.miniProgram.appId, appid)
        await assertions(mini, target)
        assert.ok(
          !logs.some(
            log => log.type === 'exception' || log.message?.level === 'error',
          ),
          'Runtime errors captured in IDE logs',
        )
        record.status = 'passed'
      }
      catch (error) {
        record.status = 'failed'
        record.error = error.stack
        failure = error
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
          if (mini) {
            await mini.close()
          }
          else {
            await execa(cliPath, ['close', '--project', projectPath], {
              timeout: 15000,
            })
          }
          // Verify only our dedicated automation endpoint; never close other projects.
          let connection
          try {
            connection = await automator.connect({
              wsEndpoint: `ws://127.0.0.1:${port}`,
            })
          }
          catch {
            resource.closed = true
          }
          if (connection) {
            connection.disconnect()
            resource.cleanupError = `Owned automator endpoint ${port} is still live after close`
            failure = new Error(resource.cleanupError)
          }
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
    report.status = 'passed'
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
main().catch(async (error) => {
  report.status = 'failed'
  report.error = error.stack
  process.exitCode = 1
  await save()
  process.stderr.write(`${error.stack}\n`)
})
