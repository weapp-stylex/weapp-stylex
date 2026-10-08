import * as stylex from '@weapp-stylex/core'
import { darkTheme, lightTheme, styles } from '../../styles'

Component({
  properties: {
    dark: {
      type: Boolean,
      value: false,
      observer(value: boolean) {
        this.setData({
          sx: stylex.attrs(value ? darkTheme : lightTheme, styles.card),
        })
      },
    },
  },
  data: { sx: stylex.attrs(lightTheme, styles.card) },
})
