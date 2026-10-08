import * as stylex from '@weapp-stylex/core'
import { defineComponent } from 'wevu'
import { lightTheme, styles } from '../../styles'

const attrs = stylex.attrs(lightTheme, styles.card)
export default defineComponent({
  setup() {
    return () => (
      <view class={attrs.class}>
        <text>JSX 样式组件</text>
      </view>
    )
  },
})
