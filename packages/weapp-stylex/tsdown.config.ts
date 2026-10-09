import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'index': './src/index.ts',
    'core': './src/core.ts',
    'compiler': './src/compiler.ts',
    'weapp-vite': './src/weapp-vite.ts',
    'taro': './src/taro.ts',
    'taro/loader': './src/taro-loader.ts',
    'uni-app': './src/uni-app.ts',
  },
  format: ['esm', 'cjs'],
  cjsDefault: false,
  dts: true,
  clean: true,
  target: 'node22',
  failOnWarn: false,
})
