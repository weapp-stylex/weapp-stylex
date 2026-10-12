import type { AcceptedPlugin } from 'postcss'
import postcss from 'postcss'
import valueParser from 'postcss-value-parser'

const browserLengthUnits = new Set(['', '%', 'px', 'cm', 'mm', 'q', 'in', 'pt', 'pc', 'em', 'rem', 'ex', 'rex', 'cap', 'rcap', 'ch', 'rch', 'ic', 'ric', 'lh', 'rlh', 'vw', 'vh', 'vi', 'vb', 'vmin', 'vmax', 'svw', 'svh', 'svi', 'svb', 'svmin', 'svmax', 'lvw', 'lvh', 'lvi', 'lvb', 'lvmin', 'lvmax', 'dvw', 'dvh', 'dvi', 'dvb', 'dvmin', 'dvmax', 'cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax'])

function units(value: string, visitor: (value: string, unit: string) => string): string {
  const parsed = valueParser(value)
  parsed.walk((node) => {
    if (node.type === 'function' && node.value.toLowerCase() === 'url') {
      return false
    }
    if (node.type === 'word') {
      const dimension = valueParser.unit(node.value)
      if (dimension) {
        node.value = visitor(dimension.number, dimension.unit)
      }
    }
    return undefined
  })
  return parsed.toString()
}

function mapValues(css: string, convert: (value: string) => string): string {
  const root = postcss.parse(css)
  root.walkDecls((declaration) => {
    declaration.value = convert(declaration.value)
  })
  root.walkAtRules((rule) => {
    rule.params = convert(rule.params)
  })
  return root.toString()
}

/** Run only the host's rpx policy; ordinary StyleX pixels never enter pxtransform. */
export function createRpxOnlyPostcssTransformer(plugin: AcceptedPlugin | undefined, from: string) {
  return async (css: string): Promise<string> => {
    let hasRpx = false
    const originalUnits = new Map<string, number>()
    const protectedCss = mapValues(css, value => units(value, (number, unit) => {
      const normalized = unit.toLowerCase()
      originalUnits.set(normalized, (originalUnits.get(normalized) ?? 0) + 1)
      hasRpx ||= unit.toLowerCase() === 'rpx'
      return `${number}${unit.toLowerCase() === 'px' ? 'PX' : unit}`
    }))
    if (!hasRpx) {
      return css
    }
    if (!plugin) {
      throw new Error('StyleX H5 rpx requires the host rpx converter. Enable the host pxtransform plugin or use standard CSS units.')
    }
    const transformed = await postcss([plugin]).process(protectedCss, { from, map: false })
    let remaining = false
    let invalidUnit: string | undefined
    const output = mapValues(transformed.css, value => units(value, (number, unit) => {
      remaining ||= unit.toLowerCase() === 'rpx'
      const normalized = unit.toLowerCase()
      if (!browserLengthUnits.has(normalized)) {
        const original = originalUnits.get(normalized) ?? 0
        if (original > 0) {
          originalUnits.set(normalized, original - 1)
        }
        else {
          invalidUnit = unit
        }
      }
      return `${number}${unit === 'PX' ? 'px' : unit}`
    }))
    if (remaining) {
      throw new Error('The host rpx policy left unsupported rpx in StyleX H5 CSS. Check pxtransform exclusions and mediaQuery settings.')
    }
    if (invalidUnit !== undefined) {
      throw new Error(`The host rpx policy produced an invalid browser length unit: ${invalidUnit}. Configure a browser CSS length unit.`)
    }
    return output
  }
}

/** Apply the host's unit-only converter to declarations and conditional values. */
export function createCssValueTransformer(convert: (value: string) => string) {
  return (css: string): string => {
    let remaining = false
    let invalidUnit: string | undefined
    const output = mapValues(css, value => units(value, (number, unit) => {
      if (unit.toLowerCase() !== 'rpx') {
        return `${number}${unit}`
      }
      return units(convert(`${number}${unit}`), (convertedNumber, convertedUnit) => {
        remaining ||= convertedUnit.toLowerCase() === 'rpx'
        if (!browserLengthUnits.has(convertedUnit.toLowerCase())) {
          invalidUnit = convertedUnit
        }
        return `${convertedNumber}${convertedUnit}`
      })
    }))
    if (remaining) {
      throw new Error('The host unit converter left unsupported rpx in StyleX H5 CSS. Configure a browser CSS unit.')
    }
    if (invalidUnit !== undefined) {
      throw new Error(`The host unit converter produced an invalid browser length unit: ${invalidUnit}. Configure a browser CSS length unit.`)
    }
    return output
  }
}
