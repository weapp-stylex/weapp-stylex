import styles, { darkTheme, lightTheme } from '@styles/index'
import { Button, Text, View } from '@tarojs/components'
import { useState } from 'react'
import * as stylex from 'weapp-stylex'
import StylexCard from '../../components/stylex-card'

const inline = stylex.create({ label: { marginTop: 8, fontSize: 14 } })
export default function Index() {
  const [active, setActive] = useState(false)
  const [dark, setDark] = useState(false)
  const [width, setWidth] = useState(80)
  return (
    <View
      id="stylex-root"
      data-testid="stylex-root"
      {...stylex.props(dark ? darkTheme : lightTheme, styles.root)}
    >
      <Text {...stylex.props(styles.title)}>共享 StyleX 样式</Text>
      <View id="stylex-inline" {...stylex.props(inline.label)}>
        独立文件 · React props · 动态尺寸
      </View>
      <StylexCard dark={dark} />
      <View
        id="stylex-toggle"
        {...stylex.props(styles.button, active && styles.active)}
        onClick={() => setActive(!active)}
      >
        点击查看条件样式
      </View>
      <Button id="stylex-theme" onClick={() => setDark(!dark)}>
        切换主题
      </Button>
      <Button
        id="stylex-grow"
        onClick={() => setWidth(width === 80 ? 120 : 80)}
      >
        动态尺寸
      </Button>
      <View
        id="stylex-meter"
        data-testid="stylex-meter"
        {...stylex.props(styles.meter(width))}
      >
        尺寸
        {width}
      </View>
    </View>
  )
}
