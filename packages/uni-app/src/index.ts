import type { SfcParser, StylexCompilerOptions } from '@weapp-stylex/compiler'
import { createRequire } from 'node:module'
import process from 'node:process'
import { createVitePlugins, StylexSession } from '@weapp-stylex/compiler'

export type { StylexCompilerOptions } from '@weapp-stylex/compiler'
export function stylexUniApp(options: StylexCompilerOptions = {}) {
  // DCloud owns the Vue compiler version and may redirect Vue resolution.
  const require = createRequire(
    typeof __filename === 'string' ? __filename : import.meta.url,
  )
  const uniRequire = createRequire(
    require.resolve('@dcloudio/vite-plugin-uni'),
  )
  const { parse } = uniRequire('@vue/compiler-sfc') as { parse: SfcParser }
  return [
    {
      name: 'weapp-stylex:uni-platform',
      config() {
        if (process.env.UNI_PLATFORM !== 'mp-weixin') {
          throw new Error(
            'weapp-stylex currently supports UNI_PLATFORM=mp-weixin only',
          )
        }
      },
    },
    ...createVitePlugins(new StylexSession(options, parse)),
  ]
}
export default stylexUniApp
