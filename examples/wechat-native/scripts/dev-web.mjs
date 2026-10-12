import { createRequire } from 'node:module'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { createCompilerContext } from 'weapp-vite'

// Keep the host's Web config and Vite version, while owning startup/shutdown.
// The 7.4 CLI serve path can report readiness without starting a Web server.
const hostRequire = createRequire(createRequire(import.meta.url).resolve('weapp-vite/package.json'))
const { createServer } = await import(pathToFileURL(hostRequire.resolve('vite')).href)
let context
let server
let stopped = false
let stop
const shutdown = new Promise((resolve) => {
  stop = () => {
    stopped = true
    resolve()
  }
})
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
try {
  context = await createCompilerContext({
    cwd: process.cwd(),
    isDev: true,
    mode: 'development',
    cliPlatform: 'web',
    preloadAppEntry: false,
    syncAutoImportSupportFiles: false,
  })
  const config = context.configService.mergeWeb()
  if (!config) {
    throw new Error('The weapp-vite Web development configuration is missing')
  }
  server = await createServer(config)
  server.httpServer?.once('close', stop)
  if (!stopped) {
    await Promise.race([server.listen(), shutdown])
    if (!stopped) {
      server.printUrls()
      await shutdown
    }
  }
}
finally {
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
  await server?.close()
  await context?.watcherService.closeAll()
}
