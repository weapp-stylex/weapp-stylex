/** Keep the Taro 4.3 Alipay platform hook on its supported asset-update path. */
export function taroAlipayViteCompat(platform) {
  return {
    name: 'examples:taro-alipay-vite-assets',
    enforce: 'pre',
    apply: 'build',
    generateBundle(_options, bundle) {
      if (platform !== 'alipay' || Object.hasOwn(bundle, '.browserslistrc')) {
        return
      }
      // Alipay adds this asset through modifyBuildAssets. Taro 4.3's Vite
      // Proxy assumes every assigned asset already exists in the bundle.
      // Reserve its name; the official hook supplies the complete contents.
      this.emitFile({ type: 'asset', fileName: '.browserslistrc', source: '' })
    },
  }
}
