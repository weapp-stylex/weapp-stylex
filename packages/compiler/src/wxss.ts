import type { MiniProgramExtensions, StylexTarget } from './target.js'
import path from 'node:path'
import { miniProgramExtensions } from './target.js'

export interface StyleAsset {
  type: 'asset'
  fileName: string
  source: string | Uint8Array
}
export interface ScriptChunk {
  type: 'chunk'
  fileName: string
  code: string
  modules?: Record<string, unknown>
}
export type StyleBundle = Record<string, StyleAsset | ScriptChunk>
export interface AssetSink {
  emit: (fileName: string, source: string) => void | Promise<void>
  remove?: (fileName: string) => void | Promise<void>
}
export function assetText(asset: StyleAsset): string {
  return typeof asset.source === 'string'
    ? asset.source
    : new TextDecoder().decode(asset.source)
}

function relativeOutputPath(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  if (
    !normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)
    || normalized.split('/').some(part => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid mini-program output path: ${value}`)
  }
  return normalized
}

interface PhysicalOutput {
  key: string
  output: StyleAsset | ScriptChunk
}

function physicalOutputs(bundle: StyleBundle): Map<string, PhysicalOutput> {
  const outputs = new Map<string, PhysicalOutput>()
  for (const [key, output] of Object.entries(bundle)) {
    const fileName = relativeOutputPath(output.fileName)
    if (relativeOutputPath(key) !== fileName) {
      throw new Error(`Mini-program bundle key does not match its output path: ${key}`)
    }
    if (outputs.has(fileName)) {
      throw new Error(`Duplicate mini-program physical output path: ${fileName}`)
    }
    outputs.set(fileName, { key, output })
  }
  return outputs
}

function validateIndependentRoots(roots: readonly string[]): string[] {
  if (!Array.isArray(roots)) {
    throw new TypeError('Independent mini-program package roots must be an array')
  }
  const normalized = roots.map((value) => {
    if (typeof value !== 'string') {
      throw new TypeError('Independent mini-program package requires a root')
    }
    const root = relativeOutputPath(value)
    if (root !== value) {
      throw new Error(`Independent mini-program package root must use forward slashes: ${value}`)
    }
    return root
  })
  if (
    new Set(normalized).size !== normalized.length
      || normalized.some(root => normalized.some(other => root !== other && root.startsWith(`${other}/`)))
  ) {
    throw new Error('Independent mini-program package roots must not overlap')
  }
  return normalized
}

function independentPackageRoots(outputs: Map<string, PhysicalOutput>): string[] {
  const app = outputs.get('app.json')?.output
  if (app?.type !== 'asset') {
    return []
  }
  const config = JSON.parse(assetText(app)) as {
    subPackages?: Array<{ root?: string, independent?: boolean }>
    subpackages?: Array<{ root?: string, independent?: boolean }>
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Mini-program app.json must contain an object')
  }
  if (config.subPackages && config.subpackages) {
    throw new Error('Ambiguous mini-program subPackages/subpackages configuration')
  }
  const packages = config.subPackages ?? config.subpackages ?? []
  if (!Array.isArray(packages)) {
    throw new TypeError('Mini-program subPackages must be an array')
  }
  return validateIndependentRoots(packages.filter(item => item?.independent).map((item) => {
    if (typeof item.root !== 'string') {
      throw new TypeError('Independent mini-program package requires a root')
    }
    return item.root
  }))
}

function commonConsumerDirectory(fileNames: string[]): string {
  const directories = fileNames.map(fileName =>
    path.posix.dirname(relativeOutputPath(fileName)).split('/').filter(part => part !== '.'),
  )
  const shared = directories[0] ?? []
  for (const directory of directories.slice(1)) {
    while (shared.some((part, index) => part !== directory[index])) {
      shared.pop()
    }
  }
  return shared.join('/')
}

/** Owns only generated assets/imports; user styles are never deleted. */
export class MiniProgramStyleEmitter {
  readonly extensions: MiniProgramExtensions
  constructor(
    readonly target: Exclude<StylexTarget, 'web'> = 'weapp',
    extensions?: MiniProgramExtensions,
  ) {
    const defaults = miniProgramExtensions(target)
    this.extensions = extensions ?? defaults
    for (const extension of Object.values(this.extensions)) {
      if (!/^[a-z][a-z0-9]*$/i.test(extension)) {
        throw new Error(`Invalid mini-program output extension: ${extension}`)
      }
    }
  }

  private assets = new Map<string, { source: string, asset?: StyleAsset | ScriptChunk }>()
  private imports = new Map<string, string>()
  clear(): void {
    this.assets.clear()
    this.imports.clear()
  }

  async generate(
    bundle: StyleBundle,
    css: string,
    sink: AssetSink,
  ): Promise<void> {
    const styleExtension = `.${this.extensions.style}`
    const templateExtension = `.${this.extensions.template}`
    const stylexName = `stylex${styleExtension}`
    const appStyle = `app${styleExtension}`
    if (!css.trim() && !this.assets.size && !this.imports.size) {
      return
    }
    // All planning, conflict checks and ownership checks must use the same
    // physical identity, including hosts that return Windows separators.
    const outputs = physicalOutputs(bundle)
    const owned = (name: string) => {
      const asset = outputs.get(name)?.output
      const previous = this.assets.get(name)
      return (
        asset?.type === 'asset' && previous?.asset === asset && previous.source === assetText(asset)
      )
    }
    // A stylesheet import keeps the receiving Page/Component's isolation
    // context, so one physical asset can serve all consumers in its package.
    // Independent packages must retain an asset inside their own boundary.
    const packageRoots = css.trim() ? independentPackageRoots(outputs) : []
    const generatedNames = new Set([
      stylexName,
      ...packageRoots.map(root => `${root}/${stylexName}`),
    ])
    let consumerRoot = ''
    const sharedAsset = (fileName: string) => {
      const normalized = relativeOutputPath(fileName)
      const root = packageRoots.find(candidate => normalized.startsWith(`${candidate}/`))
      const directory = root ?? consumerRoot
      return directory ? `${directory}/${stylexName}` : stylexName
    }
    const styleImport = (fileName: string) => {
      const relative = path.posix.relative(
        path.posix.dirname(relativeOutputPath(fileName)),
        sharedAsset(fileName),
      )
      return `@import "${relative.startsWith('.') ? relative : `./${relative}`}";\n`
    }
    const styles: Array<{ fileName: string, asset: StyleAsset }> = []
    for (const [fileName, { output }] of outputs) {
      if (
        output.type === 'asset'
        && !owned(fileName)
        && fileName.endsWith(styleExtension)
        && !generatedNames.has(fileName)
      ) {
        styles.push({ fileName, asset: output })
      }
    }
    const companions = new Set<string>()
    if (css.trim()) {
      for (const fileName of outputs.keys()) {
        if (fileName.endsWith(templateExtension)) {
          const stem = fileName.slice(0, -templateExtension.length)
          if (
            outputs.has(`${stem}.js`)
            && (!outputs.has(`${stem}${styleExtension}`) || owned(`${stem}${styleExtension}`))
          ) {
            companions.add(`${stem}${styleExtension}`)
          }
        }
      }
      if (
        (!outputs.has(appStyle) || owned(appStyle))
        && (outputs.has('app.js') || (styles.length === 0 && companions.size === 0))
      ) {
        companions.add(appStyle)
      }
    }
    if (!outputs.has('app.js') && !outputs.has('app.json')) {
      // Child builds may retain their package prefix while writing into the
      // application's output directory. Stay inside the consumers' shared
      // directory rather than assuming this bundle owns the application root.
      consumerRoot = commonConsumerDirectory([
        ...styles.map(style => style.fileName),
        ...companions,
      ])
    }
    const desired = new Set<string>()
    if (css.trim()) {
      for (const name of [
        ...styles.map(style => style.fileName),
        ...companions,
      ]) {
        desired.add(sharedAsset(name))
      }
      if (!desired.size) {
        desired.add(stylexName)
      }
    }
    for (const name of desired) {
      if (companions.has(name) || (outputs.has(name) && !owned(name))) {
        throw new Error(
          `StyleX ${this.extensions.style.toUpperCase()} 文件名冲突：构建输出已存在 ${name}。请重命名项目中的同名文件。`,
        )
      }
    }
    for (const name of this.assets.keys()) {
      if (
        !desired.has(name)
        && !companions.has(name)
        && (!outputs.has(name) || owned(name))
      ) {
        const previous = outputs.get(name)
        if (previous) {
          delete bundle[previous.key]
          outputs.delete(name)
        }
        await sink.remove?.(name)
      }
    }
    const imports = new Map<string, string>()
    for (const style of styles) {
      let source = assetText(style.asset)
      const previousImport = this.imports.get(style.fileName)
      if (previousImport && source.startsWith(previousImport)) {
        source = source.slice(previousImport.length)
      }
      if (css.trim()) {
        const nextImport = styleImport(style.fileName)
        if (!source.includes(nextImport.trim())) {
          source = nextImport + source
          imports.set(style.fileName, nextImport)
        }
      }
      style.asset.source = source
    }
    const emit = async (name: string, source: string) => {
      const previous = outputs.get(name)
      if (previous && previous.key !== name) {
        // Only previously owned generated assets can reach this branch.
        delete bundle[previous.key]
      }
      await sink.emit(name, source)
    }
    for (const name of desired) {
      await emit(name, css)
    }
    for (const name of companions) {
      await emit(name, styleImport(name))
    }
    const emitted = physicalOutputs(bundle)
    this.assets = new Map([...desired].map(name => [name, { source: css, asset: emitted.get(name)?.output }]))
    for (const name of companions) {
      this.assets.set(name, { source: styleImport(name), asset: emitted.get(name)?.output })
    }
    this.imports = imports
  }
}
/** Backwards-compatible WeChat emitter. */
export class WxssEmitter extends MiniProgramStyleEmitter {
  constructor() {
    super('weapp')
  }
}
