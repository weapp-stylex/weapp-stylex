import * as stylex from 'weapp-stylex'
import { darkTheme, lightTheme, styles } from '../../styles'

if (import.meta.env.PLATFORM === 'alipay') {
  interface AlipayInstance {
    setData: (data: { sx: ReturnType<typeof stylex.attrs> }) => void
  }
  const defineAlipayComponent = Component as unknown as (options: {
    props: { dark: boolean }
    data: { sx: ReturnType<typeof stylex.attrs> }
    deriveDataFromProps: (this: AlipayInstance, nextProps: Partial<{ dark: boolean }>) => void
  }) => void
  defineAlipayComponent({
    props: { dark: false },
    data: { sx: stylex.attrs(lightTheme, styles.card) },
    deriveDataFromProps(nextProps) {
      this.setData({ sx: stylex.attrs(nextProps.dark ? darkTheme : lightTheme, styles.card) })
    },
  })
}
else {
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
}
