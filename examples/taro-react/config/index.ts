import path from 'node:path'
import process from 'node:process'
import { defineConfig } from '@tarojs/cli'
import { taroAlipayViteCompat } from '../../../scripts/taro/vite-compat.mjs'

const builder
  = process.env.WEAPP_STYLEX_BUILDER === 'vite' ? 'vite' : 'webpack5'
const development = process.env.NODE_ENV === 'development'
export default defineConfig({
  projectName: 'taro-react',
  date: '2026-10-08',
  designWidth: 750,
  deviceRatio: { 750: 1 },
  sourceRoot: 'src',
  outputRoot: `dist/${process.env.TARO_ENV ?? 'weapp'}-${builder === 'vite' ? 'vite' : 'webpack'}${development ? '-dev' : ''}`,
  framework: 'react',
  compiler: { type: builder, prebundle: { enable: false }, vitePlugins: [taroAlipayViteCompat(process.env.TARO_ENV)] },
  plugins: [[require.resolve('weapp-stylex/taro'), { backend: process.env.WEAPP_STYLEX_BACKEND === 'auto' ? 'auto' : 'babel' }]],
  alias: { '@styles': path.resolve(__dirname, '../src/styles') },
  mini: { postcss: { pxtransform: { enable: true, config: {} } } },
  h5: {
    publicPath: development ? '/' : './',
    router: { mode: 'hash' },
    devServer: {
      host: '127.0.0.1',
      port: Number(process.env.WEAPP_STYLEX_PORT ?? 5173),
      // Expected auto-backend notices stay in the console; compilation errors
      // still show an overlay.
      client: { overlay: { warnings: false, errors: true } },
    },
  },
})
