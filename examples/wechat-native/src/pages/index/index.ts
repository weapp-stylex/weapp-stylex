import * as stylex from '@weapp-stylex/core'

const styles = stylex.create({
  page: {
    minHeight: '100vh',
    padding: 24,
    boxSizing: 'border-box',
  },
  eyebrow: {
    color: '#4b63d3',
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: 1,
  },
  title: {
    color: '#172033',
    fontSize: 28,
    fontWeight: 700,
    marginTop: 8,
  },
  subtitle: {
    color: '#65708a',
    fontSize: 15,
    lineHeight: 1.6,
    marginTop: 8,
  },
  button: {
    backgroundColor: '#4b63d3',
    borderRadius: 14,
    color: 'white',
    marginTop: 24,
    padding: 14,
    textAlign: 'center',
  },
  buttonPressed: {
    opacity: 0.65,
  },
})

const sx = {
  page: stylex.attrs(styles.page).class,
  eyebrow: stylex.attrs(styles.eyebrow).class,
  title: stylex.attrs(styles.title).class,
  subtitle: stylex.attrs(styles.subtitle).class,
  button: stylex.attrs(styles.button).class,
  buttonPressed: stylex.attrs(styles.buttonPressed).class,
}

Page({
  data: {
    sx,
    pressed: false,
  },
  onTapButton() {
    this.setData({ pressed: !this.data.pressed })
  },
})
