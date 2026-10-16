import type { IPluginContext } from '@tarojs/service'
import type { StylexCompilerOptions, StylexTarget } from '@weapp-stylex/compiler'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { createRpxOnlyPostcssTransformer, createVitePlugins, createWebStylePlugins, resolveStylexTarget, StylexSession } from '@weapp-stylex/compiler'
import { StylexWebpackPlugin } from './webpack.js'

export type { StylexCompilerOptions, StylexTarget } from '@weapp-stylex/compiler'

export function taroStylexTarget(environment = process.env.TARO_ENV): StylexTarget {
  const targets: Record<string, StylexTarget> = { weapp: 'weapp', alipay: 'alipay', tt: 'tt', h5: 'web' }
  const key = environment ?? ''
  const target = Object.hasOwn(targets, key) ? targets[key] : undefined
  if (!target) {
    throw new Error(`Unsupported TARO_ENV=${environment ?? '(unset)'}. StyleX supports weapp, alipay, tt and h5.`)
  }
  return target
}

function hostPolicy(config: unknown): string {
  return `taro-h5:rpx-only:v1:${JSON.stringify(config, (_key, value: unknown) => typeof value === 'function' ? value.toString() : value)}`
}
export function stylexTaro(
  ctx: IPluginContext,
  options: StylexCompilerOptions = {},
): void {
  const require = createRequire(
    typeof __filename === 'string' ? __filename : import.meta.url,
  )
  ctx.modifyViteConfig(({ viteConfig, viteCompilerContext }) => {
    const target = taroStylexTarget()
    const resolved = resolveStylexTarget(options, target)
    const session = new StylexSession(resolved)
    let convert = createRpxOnlyPostcssTransformer(undefined, '')
    viteConfig.plugins = [
      ...(viteConfig.plugins ?? []),
      ...createVitePlugins(session, { emitStyles: target !== 'web' }),
      ...(target === 'web'
        ? [
            {
              name: 'weapp-stylex:taro-web-units',
              configResolved(config: { root: string, css?: { postcss?: { plugins?: { postcssPlugin?: string }[] } | string } }) {
                const plugins = typeof config.css?.postcss === 'object' ? config.css.postcss.plugins : []
                const plugin = plugins?.find(value => value.postcssPlugin === 'postcss-pxtransform')
                convert = createRpxOnlyPostcssTransformer(plugin as Parameters<typeof createRpxOnlyPostcssTransformer>[0], path.join(config.root, '__weapp_stylex__/styles.css'))
              },
            },
            ...createWebStylePlugins(session, {
              transformCss: css => convert(css),
              policyKey: hostPolicy(viteCompilerContext?.taroConfig ?? ctx.initialConfig),
            }),
          ]
        : []),
    ]
  })
  ctx.modifyWebpackChain(({ chain }) => {
    const target = taroStylexTarget()
    const resolved = resolveStylexTarget(options, target)
    chain.plugin('weapp-stylex').use(StylexWebpackPlugin, [resolved, { policyKey: hostPolicy(ctx.initialConfig) }])
    chain.module
      .rule('weapp-stylex')
      .test(/\.(?:vue|[cm]?[jt]sx?)$/)
      .enforce('pre')
      // Vue-loader rereads the raw SFC for inline block requests. Transform it
      // before selectBlock too; the session reuses cached script transforms.
      .resourceQuery((query: string) => {
        const params = new URLSearchParams(query)
        // Preserve Vue-loader's behavior of ignoring unknown custom blocks.
        return !params.has('vue') || ['script', 'template', 'style'].includes(params.get('type') ?? '')
      })
      .use('weapp-stylex')
      // Vue-loader clones JS rules for render functions. A stable loader ident
      // lets its pitcher deduplicate the original and cloned pre-loader.
      .set('ident', 'weapp-stylex')
      .loader(require.resolve('@weapp-stylex/taro/loader'))
      .options(resolved)
  })
}

export default stylexTaro
