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
const IMPORT = '@import "./stylex.wxss";\n'

/** Owns only generated assets/imports; user styles are never deleted. */
export class WxssEmitter {
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
        && output.fileName.endsWith('.wxss')
        && !/(?:^|\/)stylex\.wxss$/.test(output.fileName),
    )
    const companions = new Set<string>()
    if (css.trim()) {
      for (const output of Object.values(bundle)) {
        if (output.fileName.endsWith('.wxml')) {
          const stem = output.fileName.slice(0, -5)
          if (
            bundle[`${stem}.js`]
            && (!bundle[`${stem}.wxss`] || owned(`${stem}.wxss`))
          ) {
            companions.add(`${stem}.wxss`)
          }
        }
      }
      if (
        (!bundle['app.wxss'] || owned('app.wxss'))
        && (bundle['app.js'] || styles.length === 0)
      ) {
        companions.add('app.wxss')
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
      [...directories].map(directory => `${directory}stylex.wxss`),
    )
    for (const name of desired) {
      if (companions.has(name) || (bundle[name] && !owned(name))) {
        throw new Error(
          `StyleX WXSS 文件名冲突：构建输出已存在 ${name}。请重命名项目中的同名文件。`,
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
      if (this.imports.has(style.fileName) && source.startsWith(IMPORT)) {
        source = source.slice(IMPORT.length)
      }
      if (css.trim()) {
        if (!source.includes(IMPORT.trim())) {
          source = IMPORT + source
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
      await sink.emit(name, IMPORT)
    }
    this.assets = new Map([...desired].map(name => [name, { source: css, asset: bundle[name] }]))
    for (const name of companions) {
      this.assets.set(name, { source: IMPORT, asset: bundle[name] })
    }
    this.imports = imports
  }
}
