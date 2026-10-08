import process from 'node:process'
import { execa } from 'execa'

const [builder, watch] = process.argv.slice(2)
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
