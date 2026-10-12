import { expect, it } from 'vitest'
import { taroStylexTarget } from '../src/index.js'

it('maps only supported Taro host targets', () => {
  expect(['weapp', 'alipay', 'tt', 'h5'].map(taroStylexTarget)).toEqual(['weapp', 'alipay', 'tt', 'web'])
  for (const target of ['qq', 'toString', 'constructor', '__proto__', '']) {
    expect(() => taroStylexTarget(target)).toThrow('Unsupported TARO_ENV')
  }
})
