import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { artifactFromProject, createTestProject } from '@mpcore/test'

async function main() {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url))
  const dist = path.join(projectRoot, 'dist')
  const project = createTestProject({
    artifact: artifactFromProject(dist),
    failOnConsoleError: true,
  })

  try {
    const page = await project.renderPage('/pages/index/index')
    const title = page.screen.getByText('原子化样式，直接生成 WXSS')
    assert.match(title.attributes.class, /^sx/)

    const card = page.screen.getByText('组件样式也能复用')
    assert.match(card.attributes.class, /^sx/)

    const button = page.screen.getByText('点击查看条件样式')
    const initialClass = button.attributes.class
    await page.user.tap(button)
    await page.screen.refresh()
    assert.notEqual(button.attributes.class, initialClass)

    const subpackage = await project.renderPage('/subpackage/detail/index')
    assert.match(subpackage.screen.getByText('普通分包页面').attributes.class, /^sx/)

    const css = await readFile(path.join(dist, 'stylex.wxss'), 'utf8')
    assert.doesNotMatch(css, /@layer/)
    assert.doesNotMatch(css, /:not\(#\\#/)
    process.stdout.write('mpcore headless StyleX assertions passed\n')
  }
  finally {
    await project.close()
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exitCode = 1
})
