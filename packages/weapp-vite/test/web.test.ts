import { describe, expect, it } from 'vitest'
import { createStylex } from '../src/index'
import { componentCss, createShadowStylePlugins, transformShadowMetadata } from '../src/web'

describe('Web shadow styles', () => {
  it('modifies only host import bindings and preserves existing component styles', () => {
    const result = transformShadowMetadata(`
      import {registerPage as page, registerComponent as component, installWebModuleRegistration as install} from 'virtual:weapp-vite/runtime';
      import {registerPage as foreign} from 'another-runtime';
      page({}, {id:'page'});
      component({}, {id:'card',style:localStyle});
      install({id:'card',kind:'component'});
      install({id:'app',kind:'app'});
      foreign({}, {id:'foreign'});
      function nested(page) { page({}, {id:'unrelated'}); }
    `, '/project/page.js')
    expect(result?.code).toContain('from "virtual:weapp-stylex/web-css"')
    expect(result?.code).toMatch(/style: _stylexPageCss \+ ""/)
    expect(result?.code).toMatch(/style: _stylexComponentCss \+ localStyle/)
    expect(result?.code).toMatch(/id: 'unrelated'\s*\}/)
    expect(result?.code).toMatch(/id: 'foreign'\s*\}/)
    expect(result?.code).toMatch(/id: 'app',\s*kind: 'app'\s*\}/)
    expect(result?.map?.sources).toContain('/project/page.js')
  })

  it('handles SFC and JSX factory metadata with the correct style scope', () => {
    const result = transformShadowMetadata(`
      import {registerWebWevuComponent as component,registerWebWevuComponentFactory as factory} from 'weapp-vite/runtime';
      component({}, {id:'page',kind:'page',style:existing});
      factory(defineComponent,{id:'card',kind:'component'},{});
    `, '/project/page.vue')
    expect(result?.code).toMatch(/style: _stylexPageCss \+ existing/)
    expect(result?.code).toMatch(/style: _stylexComponentCss \+ ""/)
    expect(transformShadowMetadata(`import {registerPage} from 'other';registerPage({}, {})`, '/project/other.js')).toBeNull()
  })

  it('keeps parent theme inheritance when adding CSS to a component shadow root', () => {
    const css = ':root{--sx-a:white}.dark{--sx-a:black}.sx123{color:var(--sx-a)}'
    expect(componentCss(css)).toBe('.dark{--sx-a:black}.sx123{color:var(--sx-a)}')
  })

  it('delivers page defaults on the shadow host and delegates responsive units to the Web host', async () => {
    const css = ':root{--sx-a:white}.dark{--sx-a:black}.sx123{color:var(--sx-a);padding:16px;margin:16rpx}'
    const plugins = createShadowStylePlugins(() => ({ css: () => css, prune() {} }) as never, () => true)
    const web = plugins.find(plugin => plugin.name === 'weapp-stylex:web')!
    if (!('configResolved' in web) || !('renderStart' in web) || !('load' in web) || !('renderChunk' in web)) {
      throw new TypeError('Expected a Web stylesheet plugin')
    }
    web.configResolved({ root: '/project', base: '/', command: 'build', build: { outDir: 'dist' } })
    await web.renderStart.call({ getModuleIds: () => [][Symbol.iterator]() } as never)
    const loaded = web.load('\0virtual:weapp-stylex/web-css')!
    const rendered = web.renderChunk(loaded)!.code
    const page = JSON.parse(/export const pageCss=("(?:[^"\\]|\\.)*")/.exec(rendered)![1]!) as string
    const component = JSON.parse(/export const componentCss=("(?:[^"\\]|\\.)*")/.exec(rendered)![1]!) as string
    expect(page).toContain(':host{--sx-a:white}')
    expect(component).not.toContain('--sx-a:white')
    expect(component).toContain('.dark{--sx-a:black}')
    expect(component).toContain('padding:16px')
    expect(component).toContain('var(--rpx)')
    expect(component).not.toContain('16rpx')
  })

  it('switches source preprocessing to all Web scripts and runs before host SFC compilation', async () => {
    const stylex = createStylex()
    const host = stylex.vitePlugins.find(plugin => plugin.name === 'weapp-stylex:host')!
    if (typeof host.configResolved !== 'function') {
      throw new TypeError('Expected host plugin')
    }
    host.configResolved({ command: 'serve', build: {}, weappVite: { name: 'weapp-vite', runtime: 'web', platform: 'web' } } as never)
    const source = stylex.vitePlugins.find(plugin => plugin.name === 'weapp-stylex:source')!
    if (!('transform' in source) || typeof source.transform !== 'object') {
      throw new TypeError('Expected an ordered source transform')
    }
    expect(source.transform.order).toBe('pre')
    const context = {
      resolve: async () => null,
      addWatchFile() {},
      warn() {},
      error(error: unknown) {
        throw error
      },
    }
    const script = `import * as stylex from 'weapp-stylex';export const styles=stylex.create({root:{color:'red'}})`
    const transformed = await source.transform.handler.call(context as never, script, '/project/styles.ts')
    expect(transformed?.code).not.toContain('stylex.create')
    const sfc = `<template><view :class="sx.class" /></template><script setup>import * as stylex from 'weapp-stylex';const styles=stylex.create({root:{color:'red'}});const sx=stylex.attrs(styles.root)</script>`
    const vue = await source.transform.handler.call(context as never, sfc, '/project/page.vue')
    expect(vue?.code).toContain('<template><view :class="sx.class" /></template>')
    expect(vue?.code).not.toContain('stylex.create')
    // This is a full host component request, unlike Vue's virtual script block.
    const component = await source.transform.handler.call(context as never, sfc, '/project/card.vue?weapp-web-component')
    expect(component?.code).not.toContain('stylex.create')
    expect(await source.transform.handler.call(context as never, script, '/project/card.vue?vue&type=script&lang.ts')).toBeNull()
    const compiled = stylex.vitePlugins.find(plugin => plugin.name === 'weapp-stylex:web-sfc-script')! as Extract<
      typeof stylex.vitePlugins[number],
      { transform: (...args: never[]) => Promise<unknown> }
    >
    if (typeof compiled.transform !== 'function') {
      throw new TypeError('Expected the cached host SFC script completion hook')
    }
    const hostScript = `import * as stylex from 'weapp-stylex';registerWebWevuComponent({setup(){const styles=stylex.create({root:{color:'red'}});return {sx:stylex.attrs(styles.root)}}},{kind:'component'})`
    const completed = await compiled.transform.call(context as never, hostScript, '/project/card.vue?weapp-web-component')
    expect(completed?.code).not.toContain('stylex.create')
    expect(completed?.code).toContain('registerWebWevuComponent')
    expect(await compiled.transform.call(context as never, hostScript, '/project/card.vue?weapp-web-sfc-template')).toBeNull()
    expect(await compiled.transform.call(context as never, hostScript, '/project/card.vue?vue&type=script&lang.ts')).toBeNull()
  })

  it('rejects a Web host that conflicts with the explicitly selected mini-program target', () => {
    const stylex = createStylex({ target: 'alipay' })
    const host = stylex.vitePlugins.find(plugin => plugin.name === 'weapp-stylex:host')!
    if (typeof host.configResolved !== 'function') {
      throw new TypeError('Expected host plugin')
    }
    expect(() => host.configResolved({ weappVite: { name: 'weapp-vite', runtime: 'web', platform: 'web' } } as never)).toThrow('conflicts')
  })
})
