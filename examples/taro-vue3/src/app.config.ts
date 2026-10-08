import type { AppConfig } from '@tarojs/taro'

const config: AppConfig = defineAppConfig({
  pages: ['pages/index/index'],
  subPackages: [{ root: 'subpackage', pages: ['detail/index'] }],
  window: { navigationBarTitleText: 'StyleX' },
})

export default config
