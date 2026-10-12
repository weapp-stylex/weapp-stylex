import type { StylexSession } from '@weapp-stylex/compiler'
import { readFile } from 'node:fs/promises'
import { createRequire, findPackageJSON } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import babel from '@babel/core'
import { createWebStylePlugins } from '@weapp-stylex/compiler'
import postcss from 'postcss'

const WEB_CSS_ID = 'virtual:weapp-stylex/web-css'
const RUNTIME_IDS = new Set(['virtual:weapp-vite/runtime', 'weapp-vite/runtime'])
const METADATA_ARGUMENTS = new Map([
  ['registerPage', 1],
  ['registerComponent', 1],
  ['registerWebWevuComponent', 1],
  ['registerWebWevuComponentFactory', 1],
  ['installWebModuleRegistration', 0],
])

type WxssTransform = (source: string, options?: Record<string, unknown>) => { css: string }

let wxssTransform: Promise<WxssTransform> | undefined

/** Load the active host's public CSS transformer, preserving its dependency isolation. */
async function hostWxssTransform(): Promise<WxssTransform> {
  wxssTransform ??= (async () => {
    const require = createRequire(import.meta.url)
    const hostManifest = require.resolve('weapp-vite/package.json')
    const webManifest = findPackageJSON('@weapp-vite/web', pathToFileURL(hostManifest))
    if (!webManifest) {
      throw new Error('The active weapp-vite installation does not provide its Web runtime.')
    }
    const manifest = JSON.parse(await readFile(webManifest, 'utf8')) as {
      exports: { '.': { import: string } }
    }
    const runtime = await import(/* @vite-ignore */ pathToFileURL(path.resolve(path.dirname(webManifest), manifest.exports['.'].import)).href) as {
      transformWxssToCss: WxssTransform
    }
    return runtime.transformWxssToCss
  })()
  return wxssTransform
}

/** Component defaults must inherit from the page instead of resetting every shadow host. */
export function componentCss(css: string): string {
  const root = postcss.parse(css)
  root.walkRules((rule) => {
    const selectors = rule.selectors.filter(selector => selector.trim() !== ':root')
    if (!selectors.length) {
      rule.remove()
    }
    else {
      rule.selectors = selectors
    }
  })
  return root.toString()
}

/** The host CSS transformer maps native page selectors to the page shadow host. */
function pageCss(css: string): string {
  const root = postcss.parse(css)
  root.walkRules((rule) => {
    rule.selectors = rule.selectors.map(selector => selector.trim() === ':root' ? 'page' : selector)
  })
  return root.toString()
}

/** Alter only calls bound to the host's public registration imports. */
export function transformShadowMetadata(code: string, id: string) {
  if (![...RUNTIME_IDS].some(source => code.includes(source))) {
    return null
  }
  const ast = babel.parseSync(code, {
    filename: id.split('?')[0],
    babelrc: false,
    configFile: false,
    parserOpts: { sourceType: 'module', plugins: ['typescript', 'jsx'] },
  })
  if (!ast) {
    return null
  }
  const t = babel.types
  let changed = false
  let pageName = ''
  let componentName = ''
  babel.traverse(ast, {
    Program(program) {
      const bindings = new Map<string, { imported: string, node: object }>()
      for (const statement of program.node.body) {
        if (!t.isImportDeclaration(statement) || !RUNTIME_IDS.has(statement.source.value)) {
          continue
        }
        for (const specifier of statement.specifiers) {
          if (!t.isImportSpecifier(specifier) || !t.isIdentifier(specifier.imported) || !METADATA_ARGUMENTS.has(specifier.imported.name)) {
            continue
          }
          bindings.set(specifier.local.name, { imported: specifier.imported.name, node: specifier })
        }
      }
      if (!bindings.size) {
        return
      }
      const page = program.scope.generateUidIdentifier('stylexPageCss')
      const component = program.scope.generateUidIdentifier('stylexComponentCss')
      pageName = page.name
      componentName = component.name
      program.traverse({
        CallExpression(call) {
          if (!t.isIdentifier(call.node.callee)) {
            return
          }
          const imported = bindings.get(call.node.callee.name)
          if (!imported || call.scope.getBinding(call.node.callee.name)?.path.node !== imported.node) {
            return
          }
          const argumentIndex = METADATA_ARGUMENTS.get(imported.imported)!
          const metadata = call.node.arguments[argumentIndex]
          if (!t.isObjectExpression(metadata)) {
            return
          }
          let kind = imported.imported === 'registerPage' ? 'page' : imported.imported === 'registerComponent' ? 'component' : undefined
          const kindProperty = metadata.properties.find(property =>
            t.isObjectProperty(property) && !property.computed && t.isIdentifier(property.key, { name: 'kind' }),
          )
          if (t.isObjectProperty(kindProperty) && t.isStringLiteral(kindProperty.value)) {
            kind = kindProperty.value.value
          }
          if (kind !== 'page' && kind !== 'component') {
            return
          }
          const styleIndex = metadata.properties.findIndex(property =>
            t.isObjectProperty(property) && !property.computed && t.isIdentifier(property.key, { name: 'style' }),
          )
          const existing = styleIndex >= 0 ? metadata.properties[styleIndex] : undefined
          const style = t.isObjectProperty(existing) && t.isExpression(existing.value) ? existing.value : t.stringLiteral('')
          if (styleIndex >= 0) {
            metadata.properties.splice(styleIndex, 1)
          }
          metadata.properties.push(t.objectProperty(t.identifier('style'), t.binaryExpression('+', t.identifier(kind === 'page' ? pageName : componentName), style)))
          changed = true
        },
      })
      if (changed) {
        program.unshiftContainer('body', t.importDeclaration([
          t.importSpecifier(page, t.identifier('pageCss')),
          t.importSpecifier(component, t.identifier('componentCss')),
        ], t.stringLiteral(WEB_CSS_ID)))
      }
    },
  })
  if (!changed) {
    return null
  }
  const result = babel.transformFromAstSync(ast, code, {
    filename: id.split('?')[0],
    sourceFileName: id.split('?')[0],
    babelrc: false,
    configFile: false,
    sourceMaps: true,
  })
  return result?.code ? { code: result.code, map: result.map } : null
}

export function createShadowStylePlugins(session: () => StylexSession, enabled: () => boolean) {
  let wxssOptions: Record<string, unknown> | undefined
  const transformCss = async (css: string) => (await hostWxssTransform())(css, wxssOptions).css
  return [
    {
      name: 'weapp-stylex:shadow-metadata',
      enforce: 'post' as const,
      configResolved(resolved: { weapp?: { web?: { pluginOptions?: { wxss?: Record<string, unknown> } } } }) {
        wxssOptions = resolved.weapp?.web?.pluginOptions?.wxss
      },
      transform(code: string, id: string) {
        if (!enabled() || id.startsWith('\0')) {
          return null
        }
        return transformShadowMetadata(code, id)
      },
    },
    ...createWebStylePlugins(session, {
      enabled,
      delivery: 'shadow',
      policyKey: 'weapp-vite-shadow',
      transformCss,
      async transformShadowCss(css: string) {
        const [defaultsCss, inheritedCss] = await Promise.all([transformCss(pageCss(css)), transformCss(componentCss(css))])
        return { pageCss: defaultsCss, componentCss: inheritedCss }
      },
    }),
  ]
}
