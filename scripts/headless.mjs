import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { artifactFromProject, createTestProject } from '@mpcore/test'

export async function testHeadless(projectRoot) {
  const dist = path.join(projectRoot, 'dist')
  const project = createTestProject({
    artifact: artifactFromProject(dist),
    failOnConsoleError: true,
  })
  try {
    const page = await project.renderPage('/pages/index/index')
    assert.match(
      page.screen.getByText('组件样式也能复用').attributes.class,
      /sx\w+/,
    )
    const root = page.screen.getByTestId('stylex-root')
    assert.match(root.attributes.class, /sx\w+/)
    const initialTheme = root.attributes.class
    // fileURLToPath(new URL('..')) retains its trailing separator. Compare the
    // directory name so the Wevu-only regression always runs for that caller.
    const wevu = path.basename(projectRoot) === 'wechat-wevu'
    const jsxClass = wevu
      ? page.screen.getByTestId('stylex-jsx-root').attributes.class
      : null
    if (wevu) {
      assert.match(jsxClass, /sx\w+/, 'JSX setup bindings must reach the rendered component')
    }
    const button = page.screen.getByText('点击查看条件样式')
    const initialClass = button.attributes.class
    await page.user.tap(button)
    await page.screen.refresh()
    assert.notEqual(
      page.screen.getByText('点击查看条件样式').attributes.class,
      initialClass,
    )
    await page.user.tap(page.screen.getByText('切换主题'))
    await page.screen.refresh()
    assert.notEqual(
      page.screen.getByTestId('stylex-root').attributes.class,
      initialTheme,
    )
    const initialStyle
      = page.screen.getByTestId('stylex-meter').attributes.style
    await page.user.tap(page.screen.getByText('动态尺寸'))
    await page.screen.refresh()
    const meter = page.screen.getByTestId('stylex-meter')
    assert.notEqual(meter.attributes.style, initialStyle)
    assert.match(meter.attributes.style, /120px/)
    if (wevu) {
      assert.equal(
        page.screen.getByTestId('stylex-jsx-root').attributes.class,
        jsxClass,
        'The JSX component must retain its own light theme when its parent changes',
      )
    }
    const subpackage = await project.renderPage('/subpackage/detail/index')
    assert.match(
      subpackage.screen.getByText('普通分包页面').attributes.class,
      /sx\w+/,
    )
    const css = await readFile(path.join(dist, 'stylex.wxss'), 'utf8')
    assert.match(css, /padding:16px/)
    assert.doesNotMatch(css, /@layer|:not\(#|:root/)
    process.stdout.write(
      `${path.basename(projectRoot)}: headless shared styles, component, condition, theme, dynamic value and subpackage passed\n`,
    )
  }
  finally {
    await project.close()
  }
}
