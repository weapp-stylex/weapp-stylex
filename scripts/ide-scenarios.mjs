import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../packages/compiler/package.json', import.meta.url))
const babel = require('@babel/core')

const root = fileURLToPath(new URL('..', import.meta.url))
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export function normalizeIdeColor(value) {
  const source = String(value).trim().toLowerCase()
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/.exec(source)
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map(digit => digit.repeat(2)).join('') : hex[1]
    return [0, 2, 4].map(index => Number.parseInt(digits.slice(index, index + 2), 16)).join(',')
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(1(?:\.0+)?))?\s*\)$/.exec(source)
  if (rgb && rgb.slice(1, 4).every(channel => Number(channel) <= 255)) {
    return rgb.slice(1, 4).map(Number).join(',')
  }
  throw new Error(`Expected an opaque CSS color, received ${JSON.stringify(value)}`)
}

function colorObject(node, label) {
  assert.equal(node?.type, 'ObjectExpression', `${label} must use a literal fixture object`)
  const colors = {}
  for (const property of node.properties) {
    assert.equal(property.type, 'ObjectProperty', `${label} cannot use spreads or methods`)
    assert.equal(property.computed, false, `${label} cannot use computed keys`)
    const key = property.key.name ?? property.key.value
    assert.equal(property.value.type, 'StringLiteral', `${label}.${key} must use a literal color`)
    assert.ok(!Object.hasOwn(colors, key), `${label}.${key} is duplicated`)
    normalizeIdeColor(property.value.value)
    colors[key] = property.value.value
  }
  for (const key of ['surface', 'text', 'accent']) {
    assert.ok(Object.hasOwn(colors, key), `${label}.${key} is missing`)
  }
  return colors
}

export function parseIdeThemeExpectations(tokensSource, themesSource) {
  const objects = {}
  for (const source of [tokensSource, themesSource]) {
    const ast = babel.parseSync(source, { babelrc: false, configFile: false, parserOpts: { plugins: ['typescript'] } })
    babel.traverse(ast, {
      VariableDeclarator({ node }) {
        const name = node.id.name
        if (!['tokens', 'lightTheme', 'darkTheme'].includes(name)) {
          return
        }
        assert.ok(!Object.hasOwn(objects, name), `Duplicate fixture ${name}`)
        const call = node.init
        const method = name === 'tokens' ? 'defineVars' : 'createTheme'
        assert.ok(call?.type === 'CallExpression' && call.callee.type === 'MemberExpression' && call.callee.property.name === method, `${name} must call StyleX ${method}`)
        objects[name] = colorObject(call.arguments[name === 'tokens' ? 0 : 1], name)
      },
    })
  }
  for (const name of ['tokens', 'lightTheme', 'darkTheme']) {
    assert.ok(objects[name], `Missing fixture ${name}`)
  }
  return { defaults: objects.tokens, light: objects.lightTheme, dark: objects.darkTheme }
}

export async function loadIdeExpectations(example, { workspace = root } = {}) {
  const styles = path.join(workspace, 'examples', example.name, 'src/styles')
  const [tokens, themes] = await Promise.all(['tokens.stylex.ts', 'themes.ts'].map(name => readFile(path.join(styles, name), 'utf8')))
  return parseIdeThemeExpectations(tokens, themes)
}

async function uniqueElement(scope, selector) {
  const nodes = await scope.$$(selector)
  assert.ok(nodes.length <= 1, `Expected one ${selector}, found ${nodes.length}`)
  return nodes[0]
}

export async function findIdeElement(page, id, until) {
  let element
  const host = { 'stylex-card-root': 'stylex-card', 'stylex-inherited-root': 'stylex-inherited-card', 'stylex-jsx-root': 'stylex-jsx-card' }[id]
  await until(async () => {
    element = await uniqueElement(page, `#${id}`)
    if (!element && host) {
      const component = await uniqueElement(page, `#${host}`)
      element = component && await uniqueElement(component, `#${id}`)
    }
    return !!element
  }, `Missing #${id}`)
  return element
}

function matches(actual, expected) {
  if (typeof expected === 'string') {
    // Invalid/missing renderer colors are mismatches, not successful changes.
    try {
      return normalizeIdeColor(actual) === normalizeIdeColor(expected)
    }
    catch {
      return false
    }
  }
  const { value, tolerance = 0.01, unit = 'px' } = typeof expected === 'number' ? { value: expected, unit: '' } : expected
  const parsed = unit === 'px' ? /^(-?\d+(?:\.\d+)?)px$/.exec(String(actual).trim()) : /^(-?\d+(?:\.\d+)?)$/.exec(String(actual).trim())
  return !!parsed && Math.abs(Number(parsed[1]) - value) <= tolerance
}

export async function assertIdeStyles(element, expected, { until, label }) {
  const actual = {}
  try {
    await until(async () => {
      for (const [property, value] of Object.entries(expected)) {
        actual[property] = await element.style(property)
        if (!matches(actual[property], value)) {
          return false
        }
      }
      return true
    }, `${label}: expected computed styles ${JSON.stringify(expected)}; inspect recorded stage and runtime logs`)
  }
  catch (error) {
    error.ideComputedStyle = { label, expected, actual }
    throw error
  }
  return { label, expected, actual }
}

export async function captureIdeScreenshot(mini, filename) {
  await mini.screenshot({ path: filename })
  const image = await readFile(filename)
  assert.ok(image.length > pngSignature.length && image.subarray(0, pngSignature.length).equals(pngSignature), `Missing or empty PNG screenshot: ${filename}`)
  return { path: filename, bytes: image.length, sha256: createHash('sha256').update(image).digest('hex') }
}

export async function assertions(mini, target, phase, { example, systemInfo, expectations, until, evidence = { rounds: 3, checks: [], screenshots: [] } }) {
  const width = Number(systemInfo.windowWidth)
  assert.ok(Number.isFinite(width) && width > 0, 'A real systemInfo.windowWidth is required for rpx acceptance')
  const inherited = ['wechat-native', 'wechat-wevu'].includes(example.name)
  const jsx = example.name === 'wechat-wevu'
  const px = value => ({ value })
  // Mini-program renderers may round rpx to a device pixel. Other px values
  // retain a 0.01px tolerance and never inherit this rounding allowance.
  const cardStyles = colors => ({
    'padding-top': px(16),
    'margin-top': { value: width * 12 / 750, tolerance: 0.51 },
    // Stable DevTools exposes computed corners but returns null for the
    // border-radius shorthand. Check all corners so partial loss still fails.
    'border-top-left-radius': px(12),
    'border-top-right-radius': px(12),
    'border-bottom-left-radius': px(12),
    'border-bottom-right-radius': px(12),
    'background-color': colors.surface,
    'color': colors.text,
  })
  const check = async (element, styles, label) => evidence.checks.push(await assertIdeStyles(element, styles, { until, label }))
  async function indexState(page, label) {
    const nodes = {}
    for (const id of ['root', 'inline', 'card-root', 'toggle', 'theme', 'grow', 'meter', ...(inherited ? ['inherited-root'] : []), ...(jsx ? ['jsx-root'] : [])]) {
      nodes[id] = await findIdeElement(page, `stylex-${id}`, until)
    }
    for (const id of ['root', 'inline', 'card-root', 'meter', ...(inherited ? ['inherited-root'] : []), ...(jsx ? ['jsx-root'] : [])]) {
      assert.match(await nodes[id].attribute('class'), /(?:^|\s)sx\w+(?:\s|$)/, `${label}: #stylex-${id} has no compiled classes`)
    }
    await check(nodes.inline, { 'margin-top': px(8) }, `${label}: inline numeric unit`)
    await check(nodes.meter, { width: px(80), height: px(12) }, `${label}: initial dynamic dimensions`)
    await check(nodes.toggle, { opacity: 1 }, `${label}: initial conditional style`)
    await themeState(nodes, expectations.light, `${label}: light theme`)
    return nodes
  }
  async function themeState(nodes, colors, label) {
    await check(nodes.root, {
      'padding-top': px(16),
      'padding-right': px(16),
      'padding-bottom': px(16),
      'padding-left': px(16),
      'background-color': colors.surface,
      'color': colors.text,
    }, `${label}: page`)
    await check(nodes['card-root'], cardStyles(colors), `${label}: component props`)
    if (inherited) {
      await check(nodes['inherited-root'], cardStyles(colors), `${label}: component inheritance`)
    }
    if (jsx) {
      await check(nodes['jsx-root'], cardStyles(expectations.light), `${label}: JSX component own theme`)
    }
    await check(nodes.toggle, { 'background-color': colors.accent }, `${label}: conditional control token`)
    await check(nodes.meter, { 'background-color': colors.accent, 'height': px(12) }, `${label}: dynamic token`)
  }
  await phase('index route and precise initial styles')
  const page = await mini.reLaunch('/pages/index/index')
  assert.ok(page)
  assert.equal(page.path.replace(/^\//, ''), 'pages/index/index')
  const nodes = await indexState(page, 'initial')
  for (let round = 1; round <= evidence.rounds; round++) {
    await phase(`round ${round}: conditional on and off`)
    await nodes.toggle.tap()
    await check(nodes.toggle, { opacity: 0.6 }, `round ${round}: conditional on`)
    await nodes.toggle.tap()
    await check(nodes.toggle, { opacity: 1 }, `round ${round}: conditional off`)
    await phase(`round ${round}: light to dark to light`)
    await nodes.theme.tap()
    await themeState(nodes, expectations.dark, `round ${round}: dark theme`)
    await nodes.theme.tap()
    await themeState(nodes, expectations.light, `round ${round}: restored light theme`)
    await phase(`round ${round}: width 80 to 120 to 80`)
    await nodes.grow.tap()
    await check(nodes.meter, { width: px(120), height: px(12) }, `round ${round}: expanded width`)
    await nodes.grow.tap()
    await check(nodes.meter, { width: px(80), height: px(12) }, `round ${round}: restored width`)
  }
  evidence.screenshots.push(await captureIdeScreenshot(mini, path.join(target, 'index.png')))
  await phase('subpackage route and computed shared styles')
  const detail = await mini.reLaunch('/subpackage/detail/index')
  assert.ok(detail)
  assert.equal(detail.path.replace(/^\//, ''), 'subpackage/detail/index')
  const detailNode = await findIdeElement(detail, 'stylex-detail', until)
  assert.match(await detailNode.attribute('class'), /(?:^|\s)sx\w+(?:\s|$)/)
  await check(detailNode, cardStyles(expectations.light), 'ordinary subpackage styles')
  evidence.screenshots.push(await captureIdeScreenshot(mini, path.join(target, 'subpackage.png')))
  await phase('return and reenter index with initial state')
  const returned = await mini.reLaunch('/pages/index/index')
  assert.ok(returned)
  assert.equal(returned.path.replace(/^\//, ''), 'pages/index/index')
  await indexState(returned, 'reentered')
  evidence.screenshots.push(await captureIdeScreenshot(mini, path.join(target, 'reentry.png')))
  return evidence
}
