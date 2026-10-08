import * as stylex from '@weapp-stylex/core'

const styles = stylex.create({
  page: {
    padding: 24,
  },
  text: {
    color: '#4b63d3',
    fontSize: 18,
  },
})

Page({
  data: {
    sx: {
      page: stylex.attrs(styles.page).class,
      text: stylex.attrs(styles.text).class,
    },
  },
})
