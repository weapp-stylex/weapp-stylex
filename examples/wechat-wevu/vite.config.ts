import path from 'node:path'
import process from 'node:process'
import { createStylex } from 'weapp-stylex/weapp-vite'
import { defineConfig } from 'weapp-vite/config'

const sx = createStylex({ backend: process.env.WEAPP_STYLEX_BACKEND === 'auto' ? 'auto' : 'babel' })
export default defineConfig({
  plugins: sx.vitePlugins,
  resolve: {
    alias: { '@styles': path.resolve(import.meta.dirname, 'src/styles') },
  },
  weapp: { srcRoot: 'src', compilerPlugins: [sx.compilerPlugin] },
})
