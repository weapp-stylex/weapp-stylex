import type { MiniProgramExtensions, StylexTarget } from './target.js'
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
  private imports = new Set<string>()
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
    const styleImport = `@import "./${stylexName}";\n`
    if (!css.trim() && !this.assets.size && !this.imports.size) {
      return
    }
    const owned = (name: string) => {
      const asset = bundle[name]
      const previous = this.assets.get(name)
      return (
        asset?.type === 'asset' && previous?.asset === asset && previous.source === assetText(asset)
      )
    }
    const styles = Object.values(bundle).filter(
      (output): output is StyleAsset =>
        output.type === 'asset'
        && !owned(output.fileName)
        && output.fileName.endsWith(styleExtension)
        && output.fileName.split('/').pop() !== stylexName,
    )
    const companions = new Set<string>()
    if (css.trim()) {
      for (const output of Object.values(bundle)) {
        if (output.fileName.endsWith(templateExtension)) {
          const stem = output.fileName.slice(0, -templateExtension.length)
          if (
            bundle[`${stem}.js`]
            && (!bundle[`${stem}${styleExtension}`] || owned(`${stem}${styleExtension}`))
          ) {
            companions.add(`${stem}${styleExtension}`)
          }
        }
      }
      if (
        (!bundle[appStyle] || owned(appStyle))
        && (bundle['app.js'] || styles.length === 0)
      ) {
        companions.add(appStyle)
      }
    }
    const directories = new Set<string>()
    if (css.trim()) {
      for (const name of [
        ...styles.map(style => style.fileName),
        ...companions,
      ]) {
        const slash = name.lastIndexOf('/')
        directories.add(slash < 0 ? '' : name.slice(0, slash + 1))
      }
      if (!directories.size) {
        directories.add('')
      }
    }
    const desired = new Set(
      [...directories].map(directory => `${directory}${stylexName}`),
    )
    for (const name of desired) {
      if (companions.has(name) || (bundle[name] && !owned(name))) {
        throw new Error(
          `StyleX ${this.extensions.style.toUpperCase()} 文件名冲突：构建输出已存在 ${name}。请重命名项目中的同名文件。`,
        )
      }
    }
    for (const name of this.assets.keys()) {
      if (
        !desired.has(name)
        && !companions.has(name)
        && (!bundle[name] || owned(name))
      ) {
        delete bundle[name]
        await sink.remove?.(name)
      }
    }
    const imports = new Set<string>()
    for (const style of styles) {
      let source = assetText(style)
      if (this.imports.has(style.fileName) && source.startsWith(styleImport)) {
        source = source.slice(styleImport.length)
      }
      if (css.trim()) {
        if (!source.includes(styleImport.trim())) {
          source = styleImport + source
          imports.add(style.fileName)
        }
        else if (this.imports.has(style.fileName)) {
          imports.add(style.fileName)
        }
      }
      style.source = source
    }
    for (const name of desired) {
      await sink.emit(name, css)
    }
    for (const name of companions) {
      await sink.emit(name, styleImport)
    }
    this.assets = new Map([...desired].map(name => [name, { source: css, asset: bundle[name] }]))
    for (const name of companions) {
      this.assets.set(name, { source: styleImport, asset: bundle[name] })
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
