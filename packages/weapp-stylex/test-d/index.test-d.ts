import type { stylexTaro } from 'weapp-stylex/taro'
import type { stylexUniApp } from 'weapp-stylex/uni-app'
import type { stylexCompiler } from 'weapp-stylex/weapp-vite'
import { expectType } from 'tsd'
import { attrs, create, defineVars, props } from 'weapp-stylex'
import taro from 'weapp-stylex/taro'
import uni from 'weapp-stylex/uni-app'
import native from 'weapp-stylex/weapp-vite'

const tokens = defineVars({ accent: 'red' })
const styles = create({
  root: { color: tokens.accent, padding: 16 },
  dynamic: (width: number) => ({ width }),
})
expectType<string | undefined>(attrs(styles.root).class)
expectType<string | undefined>(props(styles.root).className)
expectType<string | undefined>(attrs(styles.dynamic(80)).style)
expectType<typeof stylexTaro>(taro)
expectType<typeof stylexUniApp>(uni)
expectType<typeof stylexCompiler>(native)
