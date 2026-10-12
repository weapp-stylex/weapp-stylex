import path from 'node:path'
import process from 'node:process'
import { createStylex } from 'weapp-stylex/weapp-vite'
import { defineConfig, resolveWeappViteHostMeta } from 'weapp-vite/config'
import project from './project.config.json'

let web = false
const sx = createStylex({ backend: process.env.WEAPP_STYLEX_BACKEND === 'auto' ? 'auto' : 'babel' })
export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: Number(process.env.WEAPP_STYLEX_PORT ?? 5173), strictPort: true },
  plugins: [
    ...sx.vitePlugins,
    {
      name: 'example:component-platform',
      configResolved(config) {
        web = resolveWeappViteHostMeta(config)?.runtime === 'web'
      },
    },
  ],
  resolve: {
    alias: { '@styles': path.resolve(import.meta.dirname, 'src/styles') },
  },
  weapp: {
    srcRoot: 'src',
    autoImportComponents: {
      globs: [],
      resolvers: [(name) => {
        if (name !== 'jsx-card' && name !== 'JsxCard') {
          return
        }
        const file = web ? 'web.vue' : 'index.tsx'
        return {
          name: 'jsx-card',
          from: `/components/jsx-card/${web ? 'web' : 'index'}`,
          resolvedId: path.resolve(import.meta.dirname, 'src/components/jsx-card', file),
          sourceType: web ? 'wevu-sfc' : 'native',
        }
      }],
    },
    compilerPlugins: [sx.compilerPlugin],
    multiPlatform: {
      enabled: true,
      projectConfigs: {
        weapp: { appid: process.env.WEAPP_STYLEX_APPID ?? project.appid, projectname: project.projectname, setting: project.setting, libVersion: project.libVersion },
        alipay: { format: 2, compileType: 'mini', compileOptions: { component2: true } },
        tt: { projectname: 'weapp-stylex-wevu', setting: { urlCheck: false } },
      },
    },
  },
})
