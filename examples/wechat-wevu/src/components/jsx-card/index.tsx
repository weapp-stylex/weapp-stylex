import * as stylex from 'weapp-stylex'
import { defineComponent } from 'wevu'
import { lightTheme, styles } from '../../styles'

export default defineComponent({
  setup() {
    const attrs = stylex.attrs(lightTheme, styles.card)
    return () => (
      <view id="stylex-jsx-root" data-testid="stylex-jsx-root" class={attrs.class} style={attrs.style}>
        <text>JSX 样式组件</text>
      </view>
    )
  },
})
