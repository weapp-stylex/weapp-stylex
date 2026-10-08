import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { execa } from 'execa'
import { examples } from './example-matrix.mjs'

const require = createRequire(new URL('../packages/compiler/package.json', import.meta.url))
const postcss = require('postcss')

async function files(directory) {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(entry =>
        entry.isDirectory()
          ? files(path.join(directory, entry.name))
          : [path.join(directory, entry.name)],
      ),
    )
  ).flat()
}
for (const example of examples) {
  const output = await files(example.project)
  const styles = output.filter(file => file.endsWith('stylex.wxss'))
  assert.ok(
    styles.length,
    `${example.name}/${example.directory}: missing StyleX WXSS`,
  )
  const css = (
    await Promise.all(styles.map(file => readFile(file, 'utf8')))
  ).join('\n')
  assert.match(css, /padding:16px/)
  assert.match(css, /margin-top:12rpx/)
  assert.match(css, /--sx/)
  let hasDefaultVariables = false
  postcss.parse(css).walkRules((rule) => {
    if (rule.selectors.includes('page')) {
      hasDefaultVariables ||= rule.nodes.some(node =>
        node.type === 'decl'
        && node.prop.startsWith('--sx')
        && ['#fff', '#ffffff'].includes(node.value),
      )
    }
  })
  assert.ok(hasDefaultVariables, `${example.name}: missing default page variables`)
  assert.doesNotMatch(css, /@layer|:not\(#|:root/)
  for (const file of output.filter(
    file => file.endsWith('.wxss') && !file.endsWith('stylex.wxss'),
  )) {
    const content = await readFile(file, 'utf8')
    assert.match(content, /@import "\.\/stylex.wxss";/, file)
    assert.ok(
      output.includes(path.join(path.dirname(file), 'stylex.wxss')),
      file,
    )
  }
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
    for (const extension of ['js', 'wxml', 'wxss']) {
      assert.ok(
        output.includes(path.join(example.project, `${route}.${extension}`)),
        `${route}.${extension}`,
      )
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
for (const name of ['wechat-native', 'wechat-wevu']) {
  await execa('corepack', ['pnpm', '--filter', name, 'test:headless'], {
    stdio: 'inherit',
  })
}
