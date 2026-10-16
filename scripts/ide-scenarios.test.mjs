import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { assertIdeStyles, assertions, captureIdeScreenshot, findIdeElement, loadIdeExpectations, normalizeIdeColor, parseIdeThemeExpectations } from './ide-scenarios.mjs'

const themes = {
  light: { surface: '#ffffff', text: '#172033', accent: '#4b63d3' },
  dark: { surface: '#172033', text: '#ffffff', accent: '#8ca0ff' },
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJx8AAAAASUVORK5CYII=', 'base64')
async function immediate(check, message) {
  assert.ok(await check(), message)
}

function simulator({ inherited = true, brokenComponent = false, brokenInheritance = false, brokenJsx = false, brokenRadius = false } = {}) {
  let active = false
  let dark = false
  let width = 80
  const routes = []
  const taps = { toggle: 0, theme: 0, grow: 0 }
  const element = id => ({
    async attribute() { return 'sxexample' },
    async tap() {
      taps[id]++
      if (id === 'toggle') {
        active = !active
      }
      if (id === 'theme') {
        dark = !dark
      }
      if (id === 'grow') {
        width = width === 80 ? 120 : 80
      }
    },
    async style(property) {
      let colors = dark ? themes.dark : themes.light
      if ((id === 'card-root' && brokenComponent) || (id === 'inherited-root' && brokenInheritance) || (id === 'jsx-root' && !brokenJsx) || id === 'detail') {
        colors = themes.light
      }
      if (property === 'opacity') {
        return String(active ? 0.6 : 1)
      }
      if (property === 'width') {
        return `${width}px`
      }
      // The actual stable IDE returns null for the shorthand, even while all
      // four computed corner values correctly report 12px.
      if (property === 'border-radius') {
        return null
      }
      if (property === 'border-bottom-right-radius' && id === 'card-root' && brokenRadius) {
        return '0px'
      }
      if (property === 'height' || /^border-(?:top|bottom)-(?:left|right)-radius$/.test(property)) {
        return '12px'
      }
      if (property === 'margin-top') {
        return id === 'inline' ? '8px' : '6.24px'
      }
      if (property.startsWith('padding-')) {
        return '16px'
      }
      if (property === 'background-color') {
        return ['toggle', 'meter'].includes(id) ? colors.accent : colors.surface
      }
      if (property === 'color') {
        return colors.text
      }
      throw new Error(`Unexpected style ${id}/${property}`)
    },
  })
  const nodes = Object.fromEntries(['root', 'inline', 'card-root', 'toggle', 'theme', 'grow', 'meter', 'inherited-root', 'jsx-root', 'detail'].map(id => [id, element(id)]))
  const hosts = Object.fromEntries(['card', 'inherited-card', 'jsx-card'].map(id => [id, {
    async $$(selector) {
      const rootId = { 'card': 'card-root', 'inherited-card': 'inherited-root', 'jsx-card': 'jsx-root' }[id]
      assert.equal(selector, `#stylex-${rootId}`)
      return [nodes[rootId]]
    },
  }]))
  return {
    taps,
    routes,
    mini: {
      async reLaunch(route) {
        routes.push(route)
        active = false
        dark = false
        width = 80
        return {
          path: route.slice(1),
          async $$(selector) {
            const id = selector.replace('#stylex-', '')
            if (hosts[id]) {
              return [hosts[id]]
            }
            if (['card-root', 'inherited-root', 'jsx-root'].includes(id)) {
              return []
            }
            assert.ok(inherited || id !== 'inherited-card', 'Unexpected inherited query for this framework')
            return nodes[id] ? [nodes[id]] : []
          },
        }
      },
      async screenshot({ path: filename }) { await writeFile(filename, png) },
    },
  }
}

async function scenario(options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'stylex-ide-scenarios-'))
  const simulation = simulator(options)
  try {
    const evidence = await assertions(simulation.mini, directory, async () => {}, {
      example: { name: options.jsx ? 'wechat-wevu' : options.inherited === false ? 'taro-react' : 'wechat-native' },
      systemInfo: { windowWidth: 390 },
      expectations: themes,
      until: immediate,
    })
    return { ...simulation, evidence }
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('precise IDE user interactions', () => {
  it('checks three reversible rounds, component themes, rpx, subpackage and clean reentry', async () => {
    const { taps, routes, evidence } = await scenario()
    assert.deepEqual(taps, { toggle: 6, theme: 6, grow: 6 })
    assert.deepEqual(routes, ['/pages/index/index', '/subpackage/detail/index', '/pages/index/index'])
    assert.equal(evidence.rounds, 3)
    assert.equal(evidence.screenshots.length, 3)
    assert.ok(evidence.screenshots.every(image => image.bytes > 8 && image.sha256.length === 64))
    assert.ok(evidence.checks.some(check => check.label.includes('component inheritance') && check.expected['background-color'] === '#172033'))
    assert.ok(evidence.checks.some(check => check.label === 'ordinary subpackage styles' && check.actual['margin-top'] === '6.24px'))
  })

  it('fails when only the page theme updates and component props remain light', async () => {
    await assert.rejects(scenario({ brokenComponent: true }), /dark theme: component props/)
  })

  it('checks every computed corner when the IDE cannot read the radius shorthand', async () => {
    const { evidence } = await scenario()
    const card = evidence.checks.find(check => check.label === 'initial: light theme: component props')
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      assert.equal(card.actual[`border-${corner}-radius`], '12px')
    }
    await assert.rejects(scenario({ brokenRadius: true }), /light theme: component props/)
  })

  it('fails when a native component stops inheriting the page theme', async () => {
    await assert.rejects(scenario({ brokenInheritance: true }), /dark theme: component inheritance/)
  })

  it('does not require the native inherited fixture for Taro', async () => {
    const { evidence } = await scenario({ inherited: false })
    assert.ok(!evidence.checks.some(check => check.label.includes('component inheritance')))
  })

  it('checks Wevu JSX styles and its own light theme across parent theme changes', async () => {
    const { evidence } = await scenario({ jsx: true })
    const checks = evidence.checks.filter(check => check.label.includes('JSX component own theme'))
    assert.equal(checks.length, 8)
    assert.ok(checks.every(check => check.actual.color === themes.light.text && check.actual['padding-top'] === '16px'))
    await assert.rejects(scenario({ jsx: true, brokenJsx: true }), /dark theme: JSX component own theme/)
  })

  it('propagates page and component protocol errors without converting them to missing nodes', async () => {
    const failure = new Error('getElements protocol rejected')
    await assert.rejects(findIdeElement({
      async $$() { throw failure },
    }, 'stylex-root', immediate), error => error === failure)
    await assert.rejects(findIdeElement({
      async $$(selector) {
        return selector === '#stylex-card'
          ? [{
              async $$() { throw failure },
            }]
          : []
      },
    }, 'stylex-card-root', immediate), error => error === failure)
    await assert.rejects(assertIdeStyles({
      async style() { throw failure },
    }, { width: { value: 80 } }, { until: immediate, label: 'meter' }), error => error === failure)
  })

  it('rejects duplicate IDs and wrong units even when a generated class exists', async () => {
    await assert.rejects(findIdeElement({
      async $$() { return [{}, {}] },
    }, 'stylex-root', immediate), /Expected one/)
    await assert.rejects(assertIdeStyles({
      async style() { return '80rpx' },
    }, { width: { value: 80 } }, { until: immediate, label: 'meter units' }), /meter units/)
  })

  it('rejects empty or non-PNG screenshots', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'stylex-ide-image-'))
    try {
      await assert.rejects(captureIdeScreenshot({
        async screenshot({ path: filename }) { await writeFile(filename, '') },
      }, path.join(directory, 'empty.png')), /empty PNG/)
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
})

describe('theme fixture expectations', () => {
  it('reads actual light and dark fixture values and normalizes renderer RGB output', async () => {
    assert.deepEqual((await loadIdeExpectations({ name: 'wechat-native' })).light, themes.light)
    assert.deepEqual((await loadIdeExpectations({ name: 'wechat-wevu' })).dark, themes.dark)
    assert.equal(normalizeIdeColor('#fff'), normalizeIdeColor('rgb(255, 255, 255)'))
    assert.equal(normalizeIdeColor('#172033'), normalizeIdeColor('rgba(23,32,51,1)'))
    assert.throws(() => normalizeIdeColor('rgba(23,32,51,0)'), /opaque CSS color/)
  })

  it('rejects dynamic fixture colors instead of silently assuming old expectations', () => {
    const tokens = 'const tokens=stylex.defineVars({surface:\'#fff\',text:\'#172033\',accent:\'#4b63d3\'})'
    const source = 'const lightTheme=stylex.createTheme(tokens,{surface:pickColor(),text:\'#172033\',accent:\'#4b63d3\'})'
    assert.throws(() => parseIdeThemeExpectations(tokens, source), /literal color/)
  })
})
