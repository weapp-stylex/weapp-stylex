export type StylexTarget = 'weapp' | 'alipay' | 'tt' | 'web'

export interface MiniProgramExtensions {
  template: string
  style: string
}

const extensions: Record<Exclude<StylexTarget, 'web'>, MiniProgramExtensions> = {
  weapp: { template: 'wxml', style: 'wxss' },
  alipay: { template: 'axml', style: 'acss' },
  tt: { template: 'ttml', style: 'ttss' },
}

export function assertStylexTarget(target: string): asserts target is StylexTarget {
  if (!['weapp', 'alipay', 'tt', 'web'].includes(target)) {
    throw new Error(`Unsupported StyleX target: ${target}. Supported targets: weapp, alipay, tt, web.`)
  }
}

export function miniProgramExtensions(target: Exclude<StylexTarget, 'web'>): MiniProgramExtensions {
  assertStylexTarget(target)
  if (!(target in extensions)) {
    throw new Error('The web target requires browser CSS delivery, not mini-program style emission.')
  }
  return { ...extensions[target] }
}

/** Resolve once from the active host; never silently override an explicit target. */
export function resolveStylexTarget<T extends object>(options: T & { target?: StylexTarget }, target: StylexTarget): T & { target: StylexTarget } {
  assertStylexTarget(target)
  if (options.target !== undefined && options.target !== target) {
    throw new Error(`StyleX target ${options.target} conflicts with the active host target ${target}.`)
  }
  return { ...options, target }
}
