import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts', './src/loader.ts', './src/webpack.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'node22',
})
