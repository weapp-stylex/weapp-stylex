import { View } from '@tarojs/components'
import * as stylex from 'weapp-stylex'
import { lightTheme, styles } from '../../styles'

export default function Detail() {
  return (
    <View id="stylex-detail" {...stylex.props(lightTheme, styles.card)}>
      普通分包页面
    </View>
  )
}
