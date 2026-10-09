import path from 'node:path'
import { createStylex } from 'weapp-stylex/weapp-vite'
import { defineConfig } from 'weapp-vite/config'

const sx = createStylex()
export default defineConfig({
  plugins: sx.vitePlugins,
  resolve: {
    alias: { '@styles': path.resolve(import.meta.dirname, 'src/styles') },
  },
  weapp: { srcRoot: 'src', compilerPlugins: [sx.compilerPlugin] },
})
