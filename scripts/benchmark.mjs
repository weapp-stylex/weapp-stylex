import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../packages/compiler/package.json', import.meta.url))
const babel = require('@babel/core')
const plugin = require('@stylexjs/babel-plugin')
const { StylexSession } = require('@weapp-stylex/compiler')

const prefix = 'import * as stylex from \'@weapp-stylex/core\';'
const artifacts = new URL('../artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true })
const temporary = await mkdtemp(fileURLToPath(new URL('benchmark-', artifacts)))
const report = {
  environment: { node: process.version, cpu: os.cpus()[0].model, arch: process.arch, platform: process.platform, babel: babel.version, stylex: '0.19.1', swc: '0.19.0' },
  protocol: { warmup: 5, rounds: 7, sourcemaps: true, timingThreshold: false },
  transforms: [],
}
const median = values => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)]
const host = { resolve: async () => undefined, addWatchFile() {} }
try {
  for (const count of [10, 100, 1000]) {
    const filename = path.join(temporary, 'styles.ts')
    const source = `${prefix}export const styles=stylex.create({${Array.from({ length: count }, (_, i) => `s${i}:{padding:${i % 41 + 1},marginTop:'${i % 35 + 1}rpx',color:'#${(i * 12347 % 16777216).toString(16).padStart(6, '0')}',opacity:${i % 100 / 100},borderRadius:${i % 19 + 1},width:${i % 250 + 1},height:${i % 160 + 1}}`).join(',')}})`
    await writeFile(filename, source)
    const parseOptions = { filename, babelrc: false, configFile: false, parserOpts: { sourceType: 'unambiguous', plugins: ['typescript'] } }
    const options = { ...parseOptions, sourceMaps: true, plugins: [plugin.withOptions({ importSources: ['@weapp-stylex/core'], classNamePrefix: 'sx', dev: false, debug: false, test: false, runtimeInjection: false, styleResolution: 'application-order' })] }
    const cached = new StylexSession()
    await cached.transform(source, filename, host)
    const functions = {
      parse: () => babel.parseSync(source, parseOptions),
      originalBabelDoubleParse: () => {
        babel.parseSync(source, parseOptions)
        return babel.transformSync(source, options)
      },
      optimizedBabelCold: () => new StylexSession().transform(source, filename, host),
      autoCold: () => new StylexSession({ backend: 'auto' }).transform(source, filename, host),
      cacheHit: () => cached.transform(source, filename, host),
    }
    for (const fn of Object.values(functions)) {
      for (let i = 0; i < report.protocol.warmup; i++) {
        await fn()
      }
    }
    const samples = Object.fromEntries(Object.keys(functions).map(key => [key, []]))
    const repetitions = count === 1000 ? 2 : count === 100 ? 5 : 15
    for (let round = 0; round < report.protocol.rounds; round++) {
      const keys = Object.keys(functions)
      if (round % 2) {
        keys.reverse()
      }
      for (const key of keys) {
        const start = performance.now()
        for (let i = 0; i < repetitions; i++) {
          await functions[key]()
        }
        samples[key].push((performance.now() - start) / repetitions)
      }
    }
    assert.equal(cached.getStats().babelTransforms, 1, 'Cache hit reparsed or recompiled source')
    assert.equal(cached.getStats().parses, 1)
    report.transforms.push({ styles: count, bytes: Buffer.byteLength(source), repetitions, samples, medianMs: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, median(values)])), cachedCalls: cached.getStats() })
  }
  const token = path.join(temporary, 'tokens.stylex.ts')
  await writeFile(path.join(temporary, 'package.json'), '{"name":"benchmark-fixture"}')
  await writeFile(token, `${prefix}export const tokens=stylex.defineVars({color:'red'})`)
  const source = `${prefix}import {tokens} from './tokens.stylex';export const styles=stylex.create({root:{color:tokens.color}})`
  const session = new StylexSession()
  const consumers = Array.from({ length: 64 }, (_, i) => path.join(temporary, `consumer-${i}.ts`))
  const tokenHost = { ...host, resolve: async () => token }
  const watchRound = async () => {
    const before = session.getStats()
    const start = performance.now()
    await Promise.all(consumers.map(file => session.transform(source, file, tokenHost)))
    return { ms: performance.now() - start, calls: Object.fromEntries(Object.entries(session.getStats()).map(([key, value]) => [key, value - before[key]])) }
  }
  const initial = await watchRound()
  assert.equal(initial.calls.tokenReads, 1)
  assert.equal(initial.calls.babelTransforms, 65)
  const unchanged = []
  for (let i = 0; i < 7; i++) {
    session.beginBuild()
    unchanged.push(await watchRound())
  }
  assert.ok(unchanged.every(round => round.calls.babelTransforms === 0 && round.calls.parses === 0))
  await writeFile(token, `${prefix}export const tokens=stylex.defineVars({color:'blue'})`)
  session.change(token)
  const edited = await watchRound()
  assert.equal(edited.calls.tokenReads, 1)
  assert.ok(session.css().includes(':blue') && !session.css().includes(':red'))
  report.watch = { consumers: 64, initial, unchanged, edited }
  if (process.argv.includes('--full')) {
    report.fullBuild = {}
    for (const backend of ['babel', 'auto']) {
      // Warm each mode once, then measure three full root builds sequentially.
      const samples = []
      for (let round = 0; round < 4; round++) {
        process.stdout.write(`Full build ${backend} ${round === 0 ? 'warmup' : round}\n`)
        const start = performance.now()
        execFileSync('corepack', ['pnpm', 'build'], { cwd: new URL('..', import.meta.url), env: { ...process.env, WEAPP_STYLEX_BACKEND: backend }, stdio: 'ignore', timeout: 180000 })
        if (round) {
          samples.push(performance.now() - start)
        }
      }
      report.fullBuild[backend] = { samplesMs: samples, medianMs: median(samples) }
    }
  }
  await writeFile(new URL('benchmark.json', artifacts), `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}
finally {
  await rm(temporary, { recursive: true, force: true })
}
