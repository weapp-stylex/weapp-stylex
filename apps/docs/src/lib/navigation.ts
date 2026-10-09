import type { Breadcrumb, PrevNext, SidebarItem } from '@cloudflare/nimbus-docs/types'

interface NavigationPage {
  path: string
  en: string
  zh: string
  home?: boolean
}

interface NavigationGroup {
  en: string
  zh: string
  icon: string
  overview?: string
  pages: NavigationPage[]
  groups?: NavigationGroup[]
}

// One route definition keeps both languages and all navigation surfaces aligned.
const groups: NavigationGroup[] = [
  {
    en: 'Getting started',
    zh: '开始使用',
    icon: 'rocket',
    pages: [
      { path: '', en: 'Overview', zh: '概览', home: true },
      { path: 'get-started', en: 'Quick start', zh: '快速开始' },
      { path: 'aggregate-package', en: 'Aggregate package', zh: '聚合包' },
    ],
  },
  {
    en: 'Framework integrations',
    zh: '框架接入',
    icon: 'devices',
    pages: [
      { path: 'native', en: 'Native WeChat', zh: '原生微信' },
      { path: 'wevu', en: 'Wevu', zh: 'Wevu' },
      { path: 'taro-react', en: 'Taro React', zh: 'Taro React' },
      { path: 'taro-vue3', en: 'Taro Vue 3', zh: 'Taro Vue 3' },
      { path: 'uni-app', en: 'uni-app Vue 3', zh: 'uni-app Vue 3' },
    ],
  },
  {
    en: 'Style guides',
    zh: '样式指南',
    icon: 'palette',
    pages: [
      { path: 'styles', en: 'Shared style modules', zh: '共享样式模块' },
      { path: 'themes', en: 'Themes and dynamic values', zh: '主题与动态值' },
    ],
  },
  {
    en: 'API reference',
    zh: 'API 参考',
    icon: 'code',
    overview: 'api',
    pages: [
      { path: 'configuration', en: 'Packages and configuration', zh: '包与配置 API' },
      { path: 'api', en: 'API overview', zh: 'API 概览' },
      { path: 'api/runtime', en: 'Runtime API', zh: 'Runtime API' },
      { path: 'api/types', en: 'TypeScript types', zh: 'TypeScript 类型' },
      { path: 'api/adapters', en: 'Build adapters', zh: '构建适配器' },
      { path: 'api/compiler', en: 'Compiler API', zh: 'Compiler API' },
    ],
  },
  {
    en: 'Recipes and help',
    zh: '场景与帮助',
    icon: 'book',
    pages: [],
    groups: [
      {
        en: 'Practical recipes',
        zh: '场景实践',
        icon: 'layers',
        overview: 'recipes',
        pages: [
          { path: 'recipes', en: 'Recipes overview', zh: '场景概览' },
          { path: 'recipes/composition', en: 'Conditional composition', zh: '条件组合' },
          { path: 'recipes/dynamic-styles', en: 'Dynamic styles', zh: '动态样式' },
          { path: 'recipes/tokens-themes', en: 'Tokens and themes', zh: 'Token 与主题' },
          { path: 'recipes/shared-modules', en: 'Shared modules', zh: '共享模块' },
          { path: 'recipes/components-subpackages', en: 'Components and subpackages', zh: '组件与分包' },
          { path: 'recipes/migration', en: 'Migrate an existing project', zh: '迁移现有项目' },
        ],
      },
      {
        en: 'Advanced topics and help',
        zh: '进阶与帮助',
        icon: 'tool',
        pages: [
          { path: 'troubleshooting', en: 'Troubleshooting', zh: '故障排查' },
          { path: 'faq', en: 'Troubleshooting and scope', zh: '排障与支持边界' },
          { path: 'performance', en: 'Compilation performance', zh: '编译性能' },
          { path: 'architecture', en: 'Compiler architecture', zh: '编译架构' },
          { path: 'examples', en: 'Examples and validation', zh: '示例与验证' },
          { path: 'contributing', en: 'Contributing and docs', zh: '贡献与文档维护' },
        ],
      },
    ],
  },
]

function href(page: NavigationPage, chinese: boolean): string {
  if (page.home) {
    return chinese ? '/zh/' : '/en/'
  }
  return `${chinese ? '/zh' : ''}/${page.path}/`
}

function normalize(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] ?? '/'
  return `${path.replace(/\/+$/, '')}/`
}

function label(page: NavigationPage, chinese: boolean): string {
  return page[chinese ? 'zh' : 'en']
}

export function getSiteSidebar(pathname: string, chinese: boolean): SidebarItem[] {
  const current = normalize(pathname)
  const renderGroups = (items: NavigationGroup[]): SidebarItem[] => items.map((group, order) => ({
    type: 'group',
    label: group[chinese ? 'zh' : 'en'],
    icon: group.icon,
    order,
    children: [
      ...group.pages.map((page, pageOrder): SidebarItem => ({
        type: 'link',
        label: label(page, chinese),
        href: href(page, chinese),
        isCurrent: current === href(page, chinese),
        order: pageOrder,
      })),
      ...renderGroups(group.groups ?? []),
    ],
  }))
  return renderGroups(groups)
}

export function getSiteBreadcrumbs(pathname: string, chinese: boolean): Breadcrumb[] {
  const current = normalize(pathname)
  const home = { label: chinese ? '首页' : 'Home', href: chinese ? '/zh/' : '/en/' }
  if (current === home.href) {
    return [{ label: home.label }]
  }
  const find = (items: NavigationGroup[], parents: Breadcrumb[]): Breadcrumb[] | undefined => {
    for (const group of items) {
      const groupHref = group.overview ? `${chinese ? '/zh' : ''}/${group.overview}/` : undefined
      const page = group.pages.find(page => current === href(page, chinese))
      if (page) {
        const crumb = { label: group[chinese ? 'zh' : 'en'], ...(groupHref ? { href: groupHref } : {}) }
        return [...parents, ...(groupHref === current ? [] : [crumb]), { label: label(page, chinese) }]
      }
      const nested = find(group.groups ?? [], [...parents, { label: group[chinese ? 'zh' : 'en'] }])
      if (nested) {
        return nested
      }
    }
    return undefined
  }
  return find(groups, [home]) ?? []
}

export function getSitePrevNext(pathname: string, chinese: boolean): PrevNext {
  const current = normalize(pathname)
  const flatten = (items: NavigationGroup[]): NavigationPage[] => items.flatMap(group => [...group.pages, ...flatten(group.groups ?? [])])
  const pages = flatten(groups).filter(page => !page.home)
  const index = pages.findIndex(page => href(page, chinese) === current)
  if (index === -1) {
    return {}
  }
  const prev = pages[index - 1]
  const next = pages[index + 1]
  return {
    ...(prev ? { prev: { label: label(prev, chinese), href: href(prev, chinese) } } : {}),
    ...(next ? { next: { label: label(next, chinese), href: href(next, chinese) } } : {}),
  }
}
