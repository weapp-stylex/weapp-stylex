import process from 'node:process'
import uniImport from '@dcloudio/vite-plugin-uni'
import { defineConfig } from 'vite'
import { stylexUniApp } from 'weapp-stylex/uni-app'

const uni
  = (uniImport as unknown as { default?: typeof uniImport }).default ?? uniImport
export default defineConfig({ plugins: [uni(), ...stylexUniApp({ backend: process.env.WEAPP_STYLEX_BACKEND === 'auto' ? 'auto' : 'babel' })] })
