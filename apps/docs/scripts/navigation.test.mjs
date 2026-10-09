import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { getSiteBreadcrumbs, getSitePrevNext, getSiteSidebar } from '../src/lib/navigation.ts'

function routes(sidebar) {
  return sidebar.flatMap(item => item.type === 'group' ? routes(item.children) : [item.href])
}

function currentRoutes(sidebar) {
  return sidebar.flatMap(item => item.type === 'group' ? currentRoutes(item.children) : item.isCurrent ? [item.href] : [])
}

describe('shared documentation navigation', () => {
  it('keeps five groups and all 29 pages aligned in both languages', () => {
    const english = getSiteSidebar('/get-started/', false)
    const chinese = getSiteSidebar('/zh/get-started/', true)
    assert.equal(english.length, 5)
    assert.equal(chinese.length, 5)
    assert.deepEqual(routes(chinese).map(route => route === '/zh/' ? '/en/' : route.slice(3)), routes(english))
    assert.equal(new Set(routes(english)).size, 29)
    assert.deepEqual(english.map(group => routes(group.children).length), [3, 5, 2, 6, 13])
    assert.deepEqual(chinese.map(group => group.label), ['开始使用', '框架接入', '样式指南', 'API 参考', '场景与帮助'])
    assert.ok(routes(english).every(route => route.endsWith('/')))
  })

  it('marks only an exact current route and handles slashes, queries and language boundaries', () => {
    const sidebar = getSiteSidebar('/api/runtime?query=test', false)
    assert.deepEqual(currentRoutes(sidebar), ['/api/runtime/'])
    assert.deepEqual(currentRoutes(getSiteSidebar('/zh/api/', true)), ['/zh/api/'])
    assert.deepEqual(currentRoutes(getSiteSidebar('/zh/api/', false)), [])
    assert.deepEqual(currentRoutes(getSiteSidebar('/api/runtime-extra/', false)), [])
  })

  it('links nested pages to their local group overview and keeps the last crumb unlinked', () => {
    assert.deepEqual(getSiteBreadcrumbs('/zh/api/runtime/', true), [
      { label: '首页', href: '/zh/' },
      { label: 'API 参考', href: '/zh/api/' },
      { label: 'Runtime API' },
    ])
    assert.deepEqual(getSiteBreadcrumbs('/en/', false), [{ label: 'Home' }])
    assert.deepEqual(getSiteBreadcrumbs('/api/', false), [{ label: 'Home', href: '/en/' }, { label: 'API overview' }])
    assert.deepEqual(getSiteBreadcrumbs('/zh/recipes/composition/', true), [
      { label: '首页', href: '/zh/' },
      { label: '场景与帮助' },
      { label: '场景实践', href: '/zh/recipes/' },
      { label: '条件组合' },
    ])
    assert.equal(getSiteBreadcrumbs('/native/', false)[1].href, undefined)
    assert.deepEqual(getSiteBreadcrumbs('/missing/', false), [])
  })

  it('connects all document groups without linking past the first or last page', () => {
    const all = routes(getSiteSidebar('/', false)).filter(route => route !== '/en/')
    for (const [index, route] of all.entries()) {
      const navigation = getSitePrevNext(route, false)
      assert.equal(navigation.prev?.href, all[index - 1])
      assert.equal(navigation.next?.href, all[index + 1])
      const localized = getSitePrevNext(`/zh${route}`, true)
      assert.equal(localized.prev?.href, all[index - 1] ? `/zh${all[index - 1]}` : undefined)
      assert.equal(localized.next?.href, all[index + 1] ? `/zh${all[index + 1]}` : undefined)
    }
    assert.deepEqual(getSitePrevNext('/en/', false), {})
    assert.deepEqual(getSitePrevNext('/missing/', false), {})
  })
})
