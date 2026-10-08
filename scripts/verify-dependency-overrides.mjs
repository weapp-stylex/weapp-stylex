import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const repoctlRequire = createRequire(require.resolve('repoctl'))
const toolingRequire = createRequire(
  repoctlRequire.resolve('@icebreakers/monorepo'),
)

async function main() {
  const compilerRequire = createRequire(
    new URL('../packages/compiler/package.json', import.meta.url),
  )
  assert.match(compilerRequire('@babel/core').version, /^7\./)
  const adapterRequire = createRequire(
    new URL('../packages/weapp-vite/package.json', import.meta.url),
  )
  const weappRequire = createRequire(
    adapterRequire.resolve('weapp-vite/package.json'),
  )
  const weappBabel = weappRequire('@babel/core')
  assert.match(weappBabel.version, /^8\./)
  const transformed = weappBabel.transformSync('const answer: number = 42', {
    filename: 'sample.ts',
    babelrc: false,
    configFile: false,
    presets: [weappRequire.resolve('@babel/preset-typescript')],
  })
  assert.match(transformed.code, /const answer = 42/)

  for (const example of ['taro-react', 'taro-vue3']) {
    const hostRequire = createRequire(
      new URL(`../examples/${example}/package.json`, import.meta.url),
    )
    assert.equal(hostRequire('vite/package.json').version, '4.5.14')
    assert.equal(hostRequire('webpack/package.json').version, '5.91.0')
    assert.equal(hostRequire('@tarojs/taro/package.json').version, '4.3.0')
    assert.match(hostRequire('@babel/core').version, /^7\./)
  }
  const uniRequire = createRequire(
    new URL('../examples/uni-vue3/package.json', import.meta.url),
  )
  assert.equal(uniRequire('vite/package.json').version, '5.2.8')
  assert.equal(uniRequire('vue/package.json').version, '3.4.21')
  for (const name of [
    'uni-app',
    'uni-components',
    'uni-mp-weixin',
    'vite-plugin-uni',
  ]) {
    assert.equal(
      uniRequire(`@dcloudio/${name}/package.json`).version,
      '3.0.0-alpha-5030120260930001',
    )
  }
  assert.equal(weappRequire('vite/package.json').version, '8.3.3')

  // Resolve from the consuming tooling package, so these checks exercise the
  // installed overrides rather than separate direct test dependencies.
  const { simpleGit } = toolingRequire('simple-git')
  const git = simpleGit(root)
  const nativeGit = async args =>
    (await run('git', args, { cwd: root })).stdout.trim()
  const config = await git.getConfig('core.repositoryformatversion')
  assert.equal(
    config.value,
    await nativeGit(['config', '--get', 'core.repositoryformatversion']),
  )

  const status = await git.status()
  assert.equal(typeof status.isClean(), 'boolean')
  assert.ok(Array.isArray(status.files))

  const remotes = await git.getRemotes(true)
  const names = (await nativeGit(['remote'])).split('\n').filter(Boolean)
  assert.deepEqual(remotes.map(remote => remote.name).sort(), names.sort())
  for (const remote of remotes) {
    assert.equal(
      remote.refs.fetch,
      await nativeGit(['remote', 'get-url', remote.name]),
    )
  }
  const log = await git.log({ maxCount: 3 })
  assert.equal(log.latest.hash, await nativeGit(['rev-parse', 'HEAD']))

  const formatterEntry = toolingRequire.resolve('oxfmt')
  const formatterRequire = createRequire(formatterEntry)
  const pool = formatterRequire('tinypool/package.json')
  assert.equal(pool.version, '2.2.0')
  const formatterRoot = path.resolve(path.dirname(formatterEntry), '..')
  const temporary = await mkdtemp(path.join(tmpdir(), 'weapp-stylex-deps-'))
  try {
    await writeFile(
      path.join(temporary, 'sample.ts'),
      'const sample={enabled:true,label:"StyleX"};\n',
    )
    await writeFile(
      path.join(temporary, 'sample.md'),
      '# Smoke\n\n```ts\nconst sample={enabled:true};\n```\n',
    )
    await writeFile(
      path.join(temporary, 'sample.vue'),
      '<template><div>StyleX</div></template>\n<script setup lang="ts">const sample={enabled:true};</script>\n',
    )
    const cli = path.join(formatterRoot, 'bin', 'oxfmt')
    await run(process.execPath, [cli, '--write', '--threads=2', '.'], {
      cwd: temporary,
    })
    await run(process.execPath, [cli, '--check', '--threads=2', '.'], {
      cwd: temporary,
    })
    const formatted = await readFile(path.join(temporary, 'sample.md'), 'utf8')
    assert.match(formatted, /const sample = \{ enabled: true \}/)
  }
  finally {
    await rm(temporary, { recursive: true, force: true })
  }

  const mathEntry = toolingRequire.resolve('micromark-extension-math')
  const mathRequire = createRequire(mathEntry)
  assert.equal(mathRequire('katex').version, '0.19.0')
  const { math, mathHtml } = await import(pathToFileURL(mathEntry).href)
  const { micromark } = await import(
    pathToFileURL(toolingRequire.resolve('micromark')).href,
  )
  const html = micromark('Inline $x^2$.\n\n$$\n\\frac{1}{2}\n$$\n', {
    extensions: [math()],
    htmlExtensions: [mathHtml()],
  })
  assert.match(html, /math-inline/)
  assert.match(html, /katex-display/)
  assert.doesNotMatch(html, /katex-error/)
  process.stdout.write('Dependency override compatibility checks passed\n')
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exitCode = 1
})
