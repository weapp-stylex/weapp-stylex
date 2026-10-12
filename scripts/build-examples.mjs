import process from 'node:process'
import { execa } from 'execa'
import { examples, targets } from './example-matrix.mjs'

const target = process.argv[2]
if (!Object.hasOwn(targets, target)) {
  throw new Error('Usage: build-examples.mjs <weapp|alipay|tt|h5>')
}
// Each target runs in a separate CI checkout. Serial workspaces and Taro
// builders keep the host output directories and temporary files independent.
for (const name of new Set(examples.filter(example => example.target === target).map(example => example.name))) {
  const script = target === 'h5' && ['wechat-native', 'wechat-wevu'].includes(name)
    ? 'build:web'
    : `build:${target}`
  await execa('corepack', ['pnpm', '--filter', name, script], { stdio: 'inherit' })
}
