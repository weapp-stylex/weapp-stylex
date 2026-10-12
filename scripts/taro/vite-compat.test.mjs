import assert from 'node:assert/strict'
// Root infrastructure tests run directly in Node, outside the Vitest projects.
// eslint-disable-next-line test/no-import-node-test
import { it } from 'node:test'
import { taroAlipayViteCompat } from './vite-compat.mjs'

it('reserves the Alipay asset before the Taro 4.3 update-only Proxy runs', () => {
  const bundle = {}
  const plugin = taroAlipayViteCompat('alipay')
  plugin.generateBundle.call({ emitFile: asset => bundle[asset.fileName] = asset }, {}, bundle)
  // Reproduce the host Proxy boundary: assigning a new name would dereference
  // undefined. The platform owns the content after our reservation.
  const assets = new Proxy({}, {
    set(_target, filename, value) {
      assert.equal(bundle[filename].type, 'asset')
      bundle[filename].source = value.source()
      return true
    },
  })
  assets['.browserslistrc'] = { source: () => 'defaults and fully supports es6-module' }
  assert.equal(bundle['.browserslistrc'].source, 'defaults and fully supports es6-module')
})

it('preserves existing asset ownership and leaves other targets unchanged', () => {
  const original = { type: 'asset', fileName: '.browserslistrc', source: 'user policy' }
  for (const [platform, bundle] of [['alipay', { '.browserslistrc': original }], ['weapp', {}], ['tt', {}], ['h5', {}]]) {
    taroAlipayViteCompat(platform).generateBundle.call({ emitFile() {
      assert.fail('must not emit an asset')
    } }, {}, bundle)
  }
  assert.equal(original.source, 'user policy')
})
