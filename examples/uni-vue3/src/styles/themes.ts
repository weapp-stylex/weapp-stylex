import * as stylex from 'weapp-stylex'
import { tokens } from './tokens.stylex'

export const lightTheme = stylex.createTheme(tokens, {
  surface: '#ffffff',
  text: '#172033',
  accent: '#4b63d3',
})
export const darkTheme = stylex.createTheme(tokens, {
  surface: '#172033',
  text: '#ffffff',
  accent: '#8ca0ff',
})
