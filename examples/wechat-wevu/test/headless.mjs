import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { testHeadless } from '../../../scripts/headless.mjs'

testHeadless(fileURLToPath(new URL('..', import.meta.url))).catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exitCode = 1
})
