import uniImport from '@dcloudio/vite-plugin-uni'
import { stylexUniApp } from '@weapp-stylex/uni-app'
import { defineConfig } from 'vite'

const uni
  = (uniImport as unknown as { default?: typeof uniImport }).default ?? uniImport
export default defineConfig({ plugins: [uni(), ...stylexUniApp()] })
