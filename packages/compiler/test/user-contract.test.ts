import type { TransformHost } from '../src/index'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { StylexSession } from '../src/index'

const require = createRequire(new URL('../../core/package.json', import.meta.url))
const runtime = require('@stylexjs/stylex')

const directories: string[] = []
const source = 'import * as stylex from "@weapp-stylex/core";'
const host: TransformHost = { resolve: async () => undefined, addWatchFile() {} }

function execute(code: string, acceptedSource = '@weapp-stylex/core') {
  const exports: Record<string, any> = {}
  vm.runInNewContext(ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    require(specifier: string) {
      expect(specifier).toBe(acceptedSource)
      return runtime
    },
  })
  return exports
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe.each(['babel', 'auto'] as const)('documented consumer contracts (%s)', (backend) => {
  it('accepts custom runtime sources with named aliases without compiling unrelated modules', async () => {
    const session = new StylexSession({ backend, importSources: ['@company/stylex'] })
    const code = 'import {create as make,attrs as attributes} from "@company/stylex";const styles=make({root:{padding:16}});export const result=attributes(styles.root);'
    const result = await session.transform(code, path.resolve('artifacts/custom-source.ts'), host)
    expect(result!.code).not.toContain('make(')
    expect(execute(result!.code, '@company/stylex').result.class).toMatch(/sx\w+/)
    expect(session.css()).toContain('padding:16px')
    const unrelated = `${source}export const untouched=stylex.create({root:{color:'red'}});`
    expect(await session.transform(unrelated, path.resolve('artifacts/unrelated.ts'), host)).toBeNull()
    expect(session.css()).not.toContain('color:red')
  })

  it('keeps multiple dynamic fields, zero, string units and removal independent', async () => {
    const session = new StylexSession({ backend })
    const result = await session.transform(`${source}
      const styles=stylex.create({box:(width,height,opacity)=>({width,height,opacity})});
      export const initial=stylex.props(styles.box(80,12,1));
      export const zero=stylex.props(styles.box(0,'50%',0));
      export const removed=stylex.props(styles.box(null,null,null));
      export const restored=stylex.props(styles.box(120,'2rem',0.25));`, path.resolve('artifacts/dynamic-fields.ts'), host)
    const values = execute(result!.code)
    const property = (name: string) => {
      const match = session.css().match(new RegExp(`(?:^|[;{])${name}:var\\((--[^),]+)`))
      expect(match, name).not.toBeNull()
      return match![1]!
    }
    const width = property('width')
    const height = property('height')
    const opacity = property('opacity')
    expect(values.initial.style).toMatchObject({ [width]: '80px', [height]: '12px', [opacity]: 1 })
    expect(values.zero.style).toMatchObject({ [width]: '0px', [height]: '50%', [opacity]: 0 })
    expect(values.removed.style?.[width]).toBeUndefined()
    expect(values.removed.style?.[height]).toBeUndefined()
    expect(values.removed.style?.[opacity]).toBeUndefined()
    expect(values.restored.style).toMatchObject({ [width]: '120px', [height]: '2rem', [opacity]: 0.25 })
  })

  it('preserves nested conditional composition and explicit null property resets', async () => {
    const session = new StylexSession({ backend })
    const result = await session.transform(`${source}
      const styles=stylex.create({base:{color:'red',padding:16},override:{color:'blue'},reset:{color:null}});
      export const base=stylex.attrs(styles.base);
      export const override=stylex.attrs(styles.override);
      export const nested=stylex.attrs([styles.base,false,[null,styles.override]]);
      export const reset=stylex.attrs(styles.base,styles.reset);
      export const restored=stylex.attrs(styles.base,null,false);`, path.resolve('artifacts/nested-composition.ts'), host)
    const values = execute(result!.code)
    const colorClass = result!.rules.find(rule => rule[1].ltr.includes('color:red'))![0]
    const paddingClass = result!.rules.find(rule => rule[1].ltr.includes('padding:16px'))![0]
    expect(values.nested.class.split(' ')).toContain(values.override.class)
    expect(values.nested.class.split(' ')).not.toContain(colorClass)
    expect(values.reset.class.split(' ')).not.toContain(colorClass)
    expect(values.reset.class.split(' ')).toContain(paddingClass)
    expect(values.restored).toEqual(values.base)
  })

  it('resolves aliased cross-file constants and refreshes consumers after edits', async () => {
    const artifacts = path.resolve(import.meta.dirname, '../artifacts')
    await mkdir(artifacts, { recursive: true })
    const directory = await mkdtemp(path.join(artifacts, 'constants-'))
    directories.push(directory)
    await writeFile(path.join(directory, 'package.json'), '{"name":"constant-consumer","type":"module"}')
    const constants = path.join(directory, 'tokens.stylex.ts')
    const watched = new Set<string>()
    const hooks: TransformHost = {
      resolve: async specifier => specifier === '@tokens/tokens.stylex' ? constants : undefined,
      addWatchFile: id => watched.add(id),
    }
    const session = new StylexSession({ backend })
    const code = `${source}import {spacing} from '@tokens/tokens.stylex';export const styles=stylex.create({root:{padding:spacing.base,marginTop:spacing.gap}});`
    const filename = path.join(directory, 'consumer.ts')
    await writeFile(constants, `${source}export const spacing=stylex.defineConsts({base:'16px',gap:'12rpx'});`)
    await session.transform(code, filename, hooks)
    expect(session.css()).toContain('padding:16px')
    expect(session.css()).toContain('margin-top:12rpx')
    expect(watched.has(constants)).toBe(true)
    session.prune([filename])
    await writeFile(constants, `${source}export const spacing=stylex.defineConsts({base:'24px',gap:'8rpx'});`)
    session.change(constants)
    expect(session.dirty.has(filename)).toBe(true)
    await session.transform(code, filename, hooks)
    expect(session.css()).toContain('padding:24px')
    expect(session.css()).toContain('margin-top:8rpx')
    expect(session.css()).not.toContain('padding:16px')
    expect(session.css()).not.toContain('margin-top:12rpx')
  })
})
