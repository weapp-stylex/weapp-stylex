import process from 'node:process'
import { createStylex } from 'weapp-stylex/weapp-vite'
import { defineConfig } from 'weapp-vite/config'
import project from './project.config.json'

const sx = createStylex({ backend: process.env.WEAPP_STYLEX_BACKEND === 'auto' ? 'auto' : 'babel' })
export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: Number(process.env.WEAPP_STYLEX_PORT ?? 5173), strictPort: true },
  plugins: sx.vitePlugins,
  weapp: {
    srcRoot: 'src',
    compilerPlugins: [sx.compilerPlugin],
    multiPlatform: {
      enabled: true,
      projectConfigs: {
        weapp: { appid: process.env.WEAPP_STYLEX_APPID ?? project.appid, projectname: project.projectname, setting: project.setting, libVersion: project.libVersion },
        alipay: { format: 2, compileType: 'mini', compileOptions: { component2: true } },
        tt: { projectname: 'weapp-stylex-native', setting: { urlCheck: false } },
      },
    },
  },
})
