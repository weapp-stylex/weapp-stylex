import * as stylex from '@weapp-stylex/core'
import styles, { darkTheme, lightTheme } from '../../styles'

const inline = stylex.create({ subtitle: { marginTop: 8, color: '#65708a' } })
Page({
  data: {
    pressed: false,
    dark: false,
    width: 80,
    sx: {
      page: stylex.attrs(lightTheme, styles.root),
      title: stylex.attrs(styles.title),
      subtitle: stylex.attrs(inline.subtitle),
      button: stylex.attrs(styles.button),
      meter: stylex.attrs(styles.meter(80)),
    },
  },
  onTapButton() {
    const pressed = !this.data.pressed
    this.setData({
      pressed,
      'sx.button': stylex.attrs(styles.button, pressed && styles.active),
    })
  },
  onToggleTheme() {
    const dark = !this.data.dark
    this.setData({
      dark,
      'sx.page': stylex.attrs(dark ? darkTheme : lightTheme, styles.root),
    })
  },
  onGrow() {
    const width = this.data.width === 80 ? 120 : 80
    this.setData({ width, 'sx.meter': stylex.attrs(styles.meter(width)) })
  },
})
