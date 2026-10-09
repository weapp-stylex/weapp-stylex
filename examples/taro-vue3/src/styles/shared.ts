import * as stylex from 'weapp-stylex'
import { tokens } from './tokens.stylex'

export const styles = stylex.create({
  root: {
    padding: 16,
    backgroundColor: tokens.surface,
    color: tokens.text,
    minHeight: '100vh',
  },
  title: { fontSize: 24, fontWeight: 700, color: tokens.text },
  card: {
    padding: 16,
    marginTop: '12rpx',
    borderRadius: 12,
    backgroundColor: tokens.surface,
    color: tokens.text,
  },
  button: {
    padding: 12,
    marginTop: 16,
    backgroundColor: tokens.accent,
    color: 'white',
    borderRadius: 8,
  },
  active: { opacity: 0.6 },
  meter: (width: number) => ({
    width,
    height: 12,
    marginTop: 16,
    backgroundColor: tokens.accent,
  }),
})
export default styles
