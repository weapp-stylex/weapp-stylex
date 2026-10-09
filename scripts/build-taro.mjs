import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { execa } from 'execa'
import { ensureTaroConfig } from './taro/config.mjs'

const [builder, watch] = process.argv.slice(2)
const hostRequire = createRequire(path.join(process.cwd(), 'package.json'))
const { getUserHomeDir, TARO_CONFIG_FOLDER, TARO_BASE_CONFIG } = hostRequire('@tarojs/helper')
const userHome = getUserHomeDir()
if (userHome) {
  await ensureTaroConfig(path.join(userHome, TARO_CONFIG_FOLDER, TARO_BASE_CONFIG))
}
await execa(
  'taro',
  ['build', '--type', 'weapp', ...(watch ? ['--watch'] : [])],
  {
    stdio: 'inherit',
    preferLocal: true,
    env: { WEAPP_STYLEX_BUILDER: builder },
  },
)
if (!watch) {
  await execa(
    process.execPath,
    [
      '../../scripts/project-config.mjs',
      `dist/weapp-${builder}`,
      process.cwd().split(/[\\/]/).pop(),
    ],
    { stdio: 'inherit' },
  )
}
