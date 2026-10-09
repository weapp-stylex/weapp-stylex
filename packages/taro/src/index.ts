import type { IPluginContext } from '@tarojs/service'
import type { StylexCompilerOptions } from '@weapp-stylex/compiler'
import { createRequire } from 'node:module'
import process from 'node:process'
import { createVitePlugins, StylexSession } from '@weapp-stylex/compiler'
import { StylexWebpackPlugin } from './webpack.js'

export type { StylexCompilerOptions } from '@weapp-stylex/compiler'
export function stylexTaro(
  ctx: IPluginContext,
  options: StylexCompilerOptions = {},
): void {
  const require = createRequire(
    typeof __filename === 'string' ? __filename : import.meta.url,
  )
  ctx.modifyViteConfig(({ viteConfig }) => {
    if (process.env.TARO_ENV !== 'weapp') {
      throw new Error('weapp-stylex currently supports TARO_ENV=weapp only')
    }
    viteConfig.plugins = [
      ...(viteConfig.plugins ?? []),
      ...createVitePlugins(new StylexSession(options)),
    ]
  })
  ctx.modifyWebpackChain(({ chain }) => {
    if (process.env.TARO_ENV !== 'weapp') {
      throw new Error('weapp-stylex currently supports TARO_ENV=weapp only')
    }
    chain.plugin('weapp-stylex').use(StylexWebpackPlugin, [options])
    chain.module
      .rule('weapp-stylex')
      .test(/\.(?:vue|[cm]?[jt]sx?)$/)
      .enforce('pre')
      .resourceQuery((query: string) => !query.includes('vue'))
      .use('weapp-stylex')
      .loader(require.resolve('@weapp-stylex/taro/loader'))
      .options(options)
  })
}

export default stylexTaro
