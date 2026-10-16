import type { SfcParser, StylexCompilerOptions, StylexTarget } from '@weapp-stylex/compiler'
import { createRequire } from 'node:module'
import process from 'node:process'
import { createCssValueTransformer, createVitePlugins, createWebStylePlugins, resolveStylexTarget, StylexSession } from '@weapp-stylex/compiler'
import { createRuntimeResolver } from './runtime-resolver.js'

export type { PluginHost, StyleBundle, StylexCompilerOptions, StylexTarget, WebPluginHost, WebServer } from '@weapp-stylex/compiler'
export function uniStylexTarget(platform = process.env.UNI_PLATFORM): StylexTarget {
  const targets: Record<string, StylexTarget> = { 'mp-weixin': 'weapp', 'mp-alipay': 'alipay', 'mp-toutiao': 'tt', 'h5': 'web' }
  const key = platform ?? ''
  const target = Object.hasOwn(targets, key) ? targets[key] : undefined
  if (!target) {
    throw new Error(`Unsupported UNI_PLATFORM=${platform ?? '(unset)'}. StyleX supports mp-weixin, mp-alipay, mp-toutiao and h5.`)
  }
  return target
}

function createUniAppPlugins(options: StylexCompilerOptions) {
  // DCloud owns the Vue compiler version and may redirect Vue resolution.
  const require = createRequire(
    typeof __filename === 'string' ? __filename : import.meta.url,
  )
  const uniRequire = createRequire(
    require.resolve('@dcloudio/vite-plugin-uni'),
  )
  let session: StylexSession | undefined
  let target: StylexTarget | undefined
  let convert = (css: string) => css
  let policyKey = 'uni-h5:host-rpx:v1'
  const getSession = () => {
    if (!session) {
      throw new Error('StyleX uni-app host configuration has not resolved')
    }
    return session
  }
  return [
    createRuntimeResolver(),
    {
      name: 'weapp-stylex:uni-platform',
      config() {
        target = uniStylexTarget()
        const { parse } = uniRequire('@vue/compiler-sfc') as { parse: SfcParser }
        session = new StylexSession(resolveStylexTarget(options, target), parse)
        if (target === 'web') {
          const { parseRpx2UnitOnce } = uniRequire('@dcloudio/uni-cli-shared') as { parseRpx2UnitOnce: (root: string, platform: string) => { unit: string, unitRatio: number, unitPrecision: number } }
          const { createRpx2Unit } = uniRequire('@dcloudio/uni-shared') as { createRpx2Unit: (unit: string, ratio: number, precision: number) => (value: string) => string }
          const config = parseRpx2UnitOnce(process.env.UNI_INPUT_DIR!, 'h5')
          const webUnits = new Set(['%', 'px', 'cm', 'mm', 'q', 'in', 'pt', 'pc', 'em', 'rem', 'ex', 'rex', 'cap', 'rcap', 'ch', 'rch', 'ic', 'ric', 'lh', 'rlh', 'vw', 'vh', 'vi', 'vb', 'vmin', 'vmax', 'svw', 'svh', 'svi', 'svb', 'svmin', 'svmax', 'lvw', 'lvh', 'lvi', 'lvb', 'lvmin', 'lvmax', 'dvw', 'dvh', 'dvi', 'dvb', 'dvmin', 'dvmax', 'cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax'])
          if (typeof config.unit !== 'string' || !webUnits.has(config.unit.toLowerCase()) || !Number.isFinite(config.unitRatio) || config.unitRatio <= 0 || !Number.isInteger(config.unitPrecision) || config.unitPrecision < 0 || config.unitPrecision > 100) {
            throw new Error('Invalid uni-app H5 rpx unit policy: use a browser CSS unit, a positive unitRatio and unitPrecision between 0 and 100.')
          }
          policyKey = `uni-h5:host-rpx:v1:${JSON.stringify(config)}`
          convert = createCssValueTransformer(createRpx2Unit(config.unit, config.unitRatio, config.unitPrecision))
        }
      },
    },
    ...createVitePlugins(getSession, { emitStyles: () => target !== 'web' }),
    ...createWebStylePlugins(getSession, {
      enabled: () => target === 'web',
      transformCss: css => convert(css),
      policyKey: () => policyKey,
    }),
  ]
}

/** Public return identity for configurations that emit their own declarations. */
// An interface keeps its public identity when downstream exports infer this array.
export interface StylexUniAppPlugins extends ReturnType<typeof createUniAppPlugins> {}

export function stylexUniApp(options: StylexCompilerOptions = {}): StylexUniAppPlugins {
  return createUniAppPlugins(options)
}
export default stylexUniApp
