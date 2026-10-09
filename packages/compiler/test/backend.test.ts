import type { StylexDiagnostic } from '../src/index'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
import ts from 'typescript'
import { afterEach, expect, it, vi } from 'vitest'
import * as backend from '../src/backend'
import { StylexSession } from '../src/index'

const require = createRequire(new URL('../../core/package.json', import.meta.url))
const runtime = require('@stylexjs/stylex')

const host = { resolve: async () => undefined, addWatchFile() {} }
const file = path.resolve('artifacts/parity.tsx')
const prefix = 'import * as stylex from \'@weapp-stylex/core\';'
const normalize = (rules: unknown[][]) => rules.map(([name, data, priority]) => [name, { ...(data as object), rtl: (data as { rtl?: unknown }).rtl ?? null }, priority]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
function execute(code: string) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: () => runtime, View() {} })
  return JSON.parse(JSON.stringify(exports))
}
afterEach(() => vi.restoreAllMocks())

const cases = [
  ['static and units', 'root:{padding:16,marginTop:"12rpx",color:"red",lineHeight:1.5,marginInlineStart:12}', ''],
  ['dynamic', 'root:(width:number)=>({width,height:12})', 'export const dynamic=stylex.attrs(styles.root(80));'],
  ['condition and reset', 'root:{color:"red",padding:16},override:{color:"blue",paddingLeft:8},reset:{color:null}', 'export const out=[false,true].map(active=>stylex.attrs(styles.root,active&&styles.override));export const reset=stylex.props(styles.root,styles.reset);'],
  ['keyframes', 'root:{animationName:fade,animationDuration:"300ms"}', ''],
  ['fallback values', 'root:{display:stylex.firstThatWorks("grid","flex")}', ''],
  ['nested conditions', 'root:{color:{default:"red",":hover":"blue","@media (min-width:600px)":"green"}}', ''],
  ...['padding', 'margin', 'borderRadius', 'borderWidth', 'inset', 'gap', 'overflow'].map(property => [`shorthand ${property}`, `root:{${property}:${property === 'overflow' ? '"hidden"' : 16}},reset:{${property}:null}`, 'export const out=stylex.attrs(styles.root,styles.reset);']),
]
it.each(cases)('matches official class, complete rules, RTL, priority and runtime: %s', async (name, declaration, consumer) => {
  const code = `${prefix}${name === 'keyframes' ? 'const fade=stylex.keyframes({from:{opacity:0},to:{opacity:1}});' : ''}export const styles=stylex.create({${declaration}});export default styles;${consumer}`
  const babel = new StylexSession()
  const swc = new StylexSession({ backend: 'auto' })
  const [a, b] = await Promise.all([babel.transform(code, file, host), swc.transform(code, file, host)])
  expect(normalize(b!.rules)).toEqual(normalize(a!.rules))
  expect(execute(b!.code)).toEqual(execute(a!.code))
  expect(swc.css()).toBe(babel.css())
  expect(swc.getStats()).toMatchObject({ swcTransforms: 1, babelTransforms: 0 })
  expect(JSON.parse(b!.map!).sourcesContent).toEqual([code])
})
it('handles named/default imports, TS and JSX without loading host frameworks', async () => {
  for (const declaration of ['import stylex from "weapp-stylex";', 'import {create as make,props} from "@stylexjs/stylex";']) {
    const source = `${declaration}const styles=${declaration.includes('make') ? 'make' : 'stylex.create'}({root:{padding:16}});export const render=()=> <View {...${declaration.includes('make') ? 'props' : 'stylex.props'}(styles.root)} />;`
    const a = await new StylexSession().transform(source, file, host)
    const session = new StylexSession({ backend: 'swc' })
    const b = await session.transform(source, file, host)
    expect(normalize(b!.rules)).toEqual(normalize(a!.rules))
    expect(b!.code).toContain('<View')
    expect(session.getStats().swcTransforms).toBe(1)
  }
})
it.each([
  [`${prefix}export const tokens=stylex.defineVars({color:'red'})`, {}],
  [`${prefix}export const tokens=stylex.defineVars({color:'red'});export const theme=stylex.createTheme(tokens,{color:'blue'})`, {}],
  [`${prefix}const spacing={padding:16};export const styles=stylex.create({root:{...spacing,color:'red'}})`, {}],
  [`${prefix}export const constants=stylex.defineConsts({color:'red'})`, {}],
  [`${prefix}const spacing=4*4;export const styles=stylex.create({root:{padding:spacing}})`, {}],
  ['import * as stylex from \'weapp-stylex/core\';export const styles=stylex.create({root:{padding:16}})', {}],
  [`${prefix}export const styles=stylex.create({root:{padding:16}})`, { babel: { enableMinifiedKeys: false } }],
])('explicitly falls back for unsupported capabilities and deduplicates watch notices', async (source, options) => {
  const messages: StylexDiagnostic[] = []
  const session = new StylexSession({ backend: 'auto', ...options })
  const hooks = { ...host, diagnostic: (diagnostic: StylexDiagnostic) => {
    messages.push(diagnostic)
  } }
  await session.transform(source, (/defineVars|defineConsts/.test(source)) ? file.replace('.tsx', '.stylex.ts') : file, hooks)
  session.beginBuild()
  await session.transform(`${source}\n// watch edit`, (/defineVars|defineConsts/.test(source)) ? file.replace('.tsx', '.stylex.ts') : file, hooks)
  expect(session.getStats().swcTransforms).toBe(0)
  expect(messages.filter(message => message.code === 'STYLEX_FALLBACK')).toHaveLength(1)
  await expect(new StylexSession({ backend: 'swc', ...options }).transform(source, file, host)).rejects.toThrow('SWC cannot compile')
})
it('falls back only for native addon availability, never unknown compile failures', async () => {
  const source = `${prefix}export const styles=stylex.create({root:{padding:16}})`
  const mock = vi.spyOn(backend, 'transformSwc').mockRejectedValue(new backend.NativeBackendUnavailable('native addon missing'))
  const session = new StylexSession({ backend: 'auto' })
  await session.transform(source, file, host)
  expect(session.getStats().babelTransforms).toBe(1)
  await expect(new StylexSession({ backend: 'swc' }).transform(source, file, host)).rejects.toThrow('native addon missing')
  mock.mockRejectedValue(new Error('unexpected SWC failure'))
  await expect(new StylexSession({ backend: 'auto' }).transform(source, file, host)).rejects.toThrow('unexpected SWC failure')
})
it('reports exact syntax error positions from SFC scripts while retaining cause', async () => {
  const messages: StylexDiagnostic[] = []
  const source = `<template><view /></template>\n<script setup lang="ts">\n${prefix}\nconst invalid = ;\n</script>`
  await expect(new StylexSession({ backend: 'auto' }).transform(source, file.replace('.tsx', '.vue'), { ...host, diagnostic: d => messages.push(d) })).rejects.toThrow('Unexpected token')
  expect(messages).toHaveLength(1)
  expect(messages[0]).toMatchObject({ level: 'error', line: 4, column: 17, file: file.replace('.tsx', '.vue') })
})
it('preserves template-only bindings, macros and components in raw SFC scripts', async () => {
  const source = `<script setup lang="ts">\nimport Card from './Card.vue';\n${prefix}\nconst styles=stylex.create({root:{padding:16}});\nconst sx=stylex.attrs(styles.root);\nconst props=defineProps<{active:boolean}>();\nconst label='mapped';\n</script><template><Card :class="sx.class">{{label}}</Card></template><style scoped>.local{}</style>`
  const session = new StylexSession({ backend: 'auto' })
  const id = file.replace('.tsx', '.vue')
  const result = await session.transform(source, id, host)
  expect(result!.code).toContain('import Card from \'./Card.vue\'')
  expect(result!.code).toContain('const sx =')
  expect(result!.code).toContain('defineProps')
  expect(result!.code).toContain('<template><Card :class="sx.class">{{label}}</Card></template><style scoped>.local{}</style>')
  expect(session.getStats()).toMatchObject({ swcTransforms: 0, babelTransforms: 1 })
  const offset = result!.code.indexOf('label =')
  const before = result!.code.slice(0, offset).split('\n')
  const position = originalPositionFor(new TraceMap(result!.map!), { line: before.length, column: before.at(-1)!.length })
  expect(position).toMatchObject({ source: id, line: 7, column: 6 })
  await expect(new StylexSession({ backend: 'swc' }).transform(source, id, host)).rejects.toThrow('template-binding preservation')
})

it('keeps external captured parameters outside the verified dynamic subset', async () => {
  const session = new StylexSession({ backend: 'auto' })
  const source = `${prefix}export function make(value:number){return stylex.create({root:()=>({width:value})})}`
  const result = await session.transform(source, file, host)
  const official = await new StylexSession().transform(source, file, host)
  expect(result!.code).toBe(official!.code)
  expect(session.getStats().swcTransforms).toBe(0)
})
