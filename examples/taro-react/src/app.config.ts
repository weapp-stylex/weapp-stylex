export default defineAppConfig({
  pages: ['pages/index/index'],
  subPackages: [{ root: 'subpackage', pages: ['detail/index'] }],
  window: { navigationBarTitleText: 'StyleX' },
})
