export function isChinese(path: string) {
  return path === '/zh' || path.startsWith('/zh/')
}

export function alternatePath(path: string) {
  if (path === '/zh' || path === '/zh/') {
    return '/en/'
  }
  if (path === '/en' || path === '/en/') {
    return '/zh/'
  }
  return isChinese(path) ? path.slice(3) || '/' : `/zh${path}`
}

export const labels = {
  en: {
    navigation: 'On this site',
    contents: 'On this page',
    skip: 'Skip to content',
    search: 'Search documentation',
    submit: 'Search',
    empty: 'No matching pages.',
    loading: 'Searching…',
    unavailable: 'Search is temporarily unavailable. Try again in a moment, or use the documentation navigation.',
    markdown: 'Read Markdown',
    index: 'Documentation index',
  },
  zh: {
    navigation: '站点导航',
    contents: '本页目录',
    skip: '跳转到正文',
    search: '搜索文档',
    submit: '搜索',
    empty: '没有找到匹配的页面。',
    loading: '正在搜索…',
    unavailable: '搜索暂不可用，请稍后重试，或通过文档导航查找。',
    markdown: '阅读 Markdown',
    index: '文档索引',
  },
} as const
