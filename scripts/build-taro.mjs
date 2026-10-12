import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { execa } from 'execa'
import { ensureTaroConfig } from './taro/config.mjs'

const [builder, ...arguments_] = process.argv.slice(2)
const platform = arguments_.find(value => !value.startsWith('-')) ?? 'weapp'
const watch = arguments_.includes('--watch')
if (!['vite', 'webpack'].includes(builder) || !['weapp', 'alipay', 'tt', 'h5'].includes(platform)) {
  throw new Error('Usage: build-taro.mjs <vite|webpack> [weapp|alipay|tt|h5] [--watch]')
}
const hostRequire = createRequire(path.join(process.cwd(), 'package.json'))
const { getUserHomeDir, TARO_CONFIG_FOLDER, TARO_BASE_CONFIG } = hostRequire('@tarojs/helper')
const userHome = getUserHomeDir()
if (userHome) {
  await ensureTaroConfig(path.join(userHome, TARO_CONFIG_FOLDER, TARO_BASE_CONFIG))
}
await execa(
  'taro',
  ['build', '--type', platform, ...(watch ? ['--watch'] : [])],
  {
    stdio: 'inherit',
    preferLocal: true,
    env: { WEAPP_STYLEX_BUILDER: builder, TARO_ENV: platform },
  },
)
if (!watch && platform === 'weapp') {
  await execa(
    process.execPath,
    [
      '../../scripts/project-config.mjs',
      `dist/${platform}-${builder}`,
      process.cwd().split(/[\\/]/).pop(),
      platform,
    ],
    { stdio: 'inherit' },
  )
}
