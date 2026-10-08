import path from 'node:path'
import process from 'node:process'
import { defineConfig } from '@tarojs/cli'

const builder
  = process.env.WEAPP_STYLEX_BUILDER === 'vite' ? 'vite' : 'webpack5'
export default defineConfig({
  projectName: 'taro-react',
  date: '2026-10-08',
  designWidth: 750,
  deviceRatio: { 750: 1 },
  sourceRoot: 'src',
  outputRoot: `dist/weapp-${builder === 'vite' ? 'vite' : 'webpack'}`,
  framework: 'react',
  compiler: { type: builder, prebundle: { enable: false } },
  plugins: ['@weapp-stylex/taro'],
  alias: { '@styles': path.resolve(__dirname, '../src/styles') },
  mini: { postcss: { pxtransform: { enable: true, config: {} } } },
})
