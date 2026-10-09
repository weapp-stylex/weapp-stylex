import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { StylexSession } from '@weapp-stylex/compiler'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)

it.each(['weapp-stylex', 'weapp-stylex/core'])('compiles %s and composes classes through ESM and CJS runtime entries', async (source) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'weapp-stylex-runtime-'))
  try {
    const filename = path.join(directory, 'styles.mjs')
    const session = new StylexSession()
    const result = await session.transform(
      `import * as stylex from '${source}';
export const styles=stylex.create({base:{color:'red',padding:16},override:{color:'blue'},active:{opacity:0.6},dynamic:width=>({width})});
export const attrs=stylex.attrs(styles.base,styles.override,styles.active);
export const dynamic=stylex.attrs(styles.dynamic(80));`,
      filename,
      { resolve: async () => undefined, addWatchFile() {} },
    )
    expect(result).not.toBeNull()
    expect(result!.code).not.toContain('stylex.create')
    await writeFile(filename, result!.code.replaceAll(source, import.meta.resolve(source)))
    const values = await import(pathToFileURL(filename).href)
    const cjs = require(source)
    expect(cjs.attrs(values.styles.base, values.styles.override, values.styles.active)).toEqual(values.attrs)
    expect(cjs.attrs(values.styles.dynamic(80))).toEqual(values.dynamic)
    expect(values.dynamic.style).toContain('80px')
    expect(values.attrs.class).toContain(cjs.attrs(values.styles.override).class)
    const redClass = result!.rules.find(rule => rule[1].ltr.includes('color:red'))![0]
    expect(values.attrs.class.split(' ')).not.toContain(redClass)
    expect(session.css()).toContain('padding:16px')
    expect(session.css()).not.toMatch(/@layer|:not\(#/)
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})
