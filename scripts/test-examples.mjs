import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { execa } from 'execa'
import { examples, targets } from './example-matrix.mjs'

const require = createRequire(new URL('../packages/compiler/package.json', import.meta.url))
const babel = require('@babel/core')
const postcss = require('postcss')

const target = process.env.WEAPP_STYLEX_TARGET
if (target && !Object.hasOwn(targets, target)) {
  throw new Error('WEAPP_STYLEX_TARGET must be weapp, alipay, tt or h5')
}
const matrix = target ? examples.filter(example => example.target === target) : examples

async function files(directory, excluded = new Set()) {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).filter(entry => !excluded.has(entry.name)).map(entry =>
        entry.isDirectory()
          ? files(path.join(directory, entry.name))
          : [path.join(directory, entry.name)],
      ),
    )
  ).flat()
}

// weapp-vite's Web runtime embeds page/component style metadata in JavaScript.
// Read string literals through the parser: bundle hashes and variable names are
// intentionally unstable, and matching escaped JavaScript text is not CSS QA.
async function shadowStyles(output) {
  const styles = new Set()
  for (const file of output.filter(file => /\.[cm]?js$/.test(file))) {
    const ast = babel.parseSync(await readFile(file, 'utf8'), { babelrc: false, configFile: false })
    const accept = (value) => {
      if (!/\.sx[a-z0-9]+[\s.{:#]/.test(value)) {
        return
      }
      try {
        const root = postcss.parse(value)
        let atomic = false
        root.walkRules((rule) => {
          atomic ||= /\.sx[a-z0-9]+/.test(rule.selector)
        })
        if (atomic) {
          styles.add(value)
        }
      }
      catch {
        // Other runtime strings may mention class names without containing CSS.
      }
    }
    babel.traverse(ast, {
      StringLiteral(node) { accept(node.node.value) },
      TemplateLiteral(node) {
        if (!node.node.expressions.length) {
          accept(node.node.quasis[0].value.cooked ?? node.node.quasis[0].value.raw)
        }
      },
    })
  }
  return [...styles].sort()
}

const summaries = {}
for (const example of matrix) {
  const excluded = example.target === 'weapp' && ['wechat-native', 'wechat-wevu'].includes(example.name)
    ? new Set(['alipay', 'tt', 'web'])
    : new Set()
  const output = await files(example.project, excluded)
  const web = example.target === 'h5'
  const shadow = example.cssDelivery === 'weapp-web'
  const styles = output.filter(file => web
    ? /(?:^|\/)stylex-[\da-f]+\.css$/.test(file)
    : file.endsWith(`stylex${example.styleExtension}`))
  const cssParts = shadow
    ? await shadowStyles(output)
    : await Promise.all(styles.toSorted().map(file => readFile(file, 'utf8')))
  assert.ok(
    cssParts.length,
    `${example.name}/${example.directory}: missing StyleX styles`,
  )
  const css = cssParts.join('\n')
  summaries[`${example.name}/${example.directory}`] = { paths: shadow ? ['page/component style metadata'] : styles.map(file => path.relative(example.project, file)).sort(), css }
  assert.match(css, /padding:16px/)
  assert.match(css, /margin-top:8px/)
  if (web) {
    assert.doesNotMatch(css, /(?:^|[^\w-])12rpx\b/)
  }
  else {
    assert.match(css, /margin-top:12rpx/)
  }
  assert.match(css, /--sx/)
  let hasDefaultVariables = false
  // Web runtime 2 scopes page defaults to the active shadow host; runtime 1
  // uses the unqualified host. Theme class rules do not count as defaults.
  const defaultSelectors = shadow
    ? [':host', ':host(:where([data-weapp-page-active]))']
    : [example.rootSelector]
  postcss.parse(css).walkRules((rule) => {
    if (rule.selectors.some(selector => defaultSelectors.includes(selector.trim()))) {
      hasDefaultVariables ||= rule.nodes.some(node =>
        node.type === 'decl'
        && node.prop.startsWith('--sx')
        && ['#fff', '#ffffff'].includes(node.value),
      )
    }
  })
  assert.ok(hasDefaultVariables, `${example.name}: missing default root variables`)
  assert.doesNotMatch(css, /@layer|:not\(#/)
  if (!web) {
    assert.doesNotMatch(css, /:root/)
  }
  for (const file of web
    ? []
    : output.filter(
        file => file.endsWith(example.styleExtension) && !file.endsWith(`stylex${example.styleExtension}`),
      )) {
    const content = await readFile(file, 'utf8')
    assert.ok(content.includes(`@import "./stylex${example.styleExtension}";`), file)
    assert.ok(
      output.includes(path.join(path.dirname(file), `stylex${example.styleExtension}`)),
      file,
    )
  }
  if (web) {
    const html = await readFile(path.join(example.project, 'index.html'), 'utf8')
    if (!shadow) {
      assert.match(html, /<link\s[^>]*data-weapp-stylex[^>]*>/)
      for (const style of styles) {
        assert.ok(html.includes(path.relative(example.project, style).replaceAll('\\', '/')), 'H5 entry does not reference its StyleX stylesheet')
      }
    }
    assert.ok(!output.some(file => /\.(?:wxml|wxss|axml|acss|ttml|ttss)$/.test(file)), 'H5 output contains mini-program assets')
  }
  else {
    const app = JSON.parse(
      await readFile(path.join(example.project, 'app.json'), 'utf8'),
    )
    assert.ok(app.pages.includes('pages/index/index'))
    assert.ok(
      (app.subPackages ?? app.subpackages).some(
        pkg => pkg.root === 'subpackage',
      ),
    )
    for (const route of ['pages/index/index', 'subpackage/detail/index']) {
      for (const extension of ['.js', example.templateExtension, example.styleExtension]) {
        assert.ok(
          output.includes(path.join(example.project, `${route}${extension}`)),
          `${route}${extension}`,
        )
      }
    }
  }
  const js = (
    await Promise.all(
      output
        .filter(file => file.endsWith('.js'))
        .map(file => readFile(file, 'utf8')),
    )
  ).join('\n')
  assert.match(js, /sx[a-z0-9]+/)
  assert.doesNotMatch(js, /stylex\.create\(/)
  process.stdout.write(
    `Artifact checks passed: ${example.name}/${example.directory}\n`,
  )
}
if (process.env.WEAPP_STYLEX_COMPARE_BACKENDS === '1') {
  const baseline = new URL(`../artifacts/example-babel-css${target ? `-${target}` : ''}.json`, import.meta.url)
  if (process.env.WEAPP_STYLEX_BACKEND === 'auto') {
    assert.deepEqual(summaries, JSON.parse(await readFile(baseline, 'utf8')), 'Auto CSS differs from the official Babel artifacts')
    process.stdout.write(`All ${matrix.length} auto CSS artifacts match Babel exactly\n`)
  }
  else {
    await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true })
    await writeFile(baseline, JSON.stringify(summaries))
  }
}
for (const name of !target || target === 'weapp' ? ['wechat-native', 'wechat-wevu'] : []) {
  await execa('corepack', ['pnpm', '--filter', name, 'test:headless'], {
    stdio: 'inherit',
  })
}
