import { expect, it } from 'vitest'
import { uniStylexTarget } from '../src/index.js'

it('maps only supported uni-app host targets', () => {
  expect(['mp-weixin', 'mp-alipay', 'mp-toutiao', 'h5'].map(uniStylexTarget)).toEqual(['weapp', 'alipay', 'tt', 'web'])
  for (const target of ['mp-qq', 'toString', 'constructor', '__proto__', '']) {
    expect(() => uniStylexTarget(target)).toThrow('Unsupported UNI_PLATFORM')
  }
})
