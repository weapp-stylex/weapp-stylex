import { stylexCompiler } from 'weapp-stylex/weapp-vite'
import { defineConfig } from 'weapp-vite/config'

export default defineConfig({
  weapp: {
    srcRoot: 'src',
    compilerPlugins: [stylexCompiler()],
  },
})
