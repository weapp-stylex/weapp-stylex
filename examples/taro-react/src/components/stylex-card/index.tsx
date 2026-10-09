import { View } from '@tarojs/components'
import * as stylex from 'weapp-stylex'
import { darkTheme, lightTheme, styles } from '../../styles'

export default function StylexCard({ dark }: { dark: boolean }) {
  return (
    <View
      id="stylex-card-root"
      {...stylex.props(dark ? darkTheme : lightTheme, styles.card)}
    >
      组件样式也能复用
    </View>
  )
}
