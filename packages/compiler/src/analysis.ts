import babel from '@babel/core'

export type ScriptAst = NonNullable<ReturnType<typeof babel.parseSync>>

/** Runtime imports belong to the bundler; only compile-time reads need resolving. */
export function analyzeScript(ast: ScriptAst, importSources: readonly string[], checkCapabilities = false) {
  const imports = new Map<string, string>()
  const runtimeSources = new Set<string>()
  const dependencies = new Set<string>()
  const methods = new Set<string>()
  let unsupported: string | undefined
  const compileTime = new Set(['create', 'keyframes', 'defineVars', 'defineConsts', 'createTheme', 'firstThatWorks'])

  let externalImports = false
  // Plain static modules need no scope crawl. Scan declarations before opting into analysis.
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration' || node.importKind === 'type') {
      continue
    }
    const source = node.source.value
    if (importSources.includes(source)) {
      runtimeSources.add(source)
      for (const specifier of node.specifiers) {
        imports.set(specifier.local.name, source)
      }
    }
    else {
      externalImports = true
      if (/\.stylex(?:\.|$)/.test(source)) {
        dependencies.add(source)
      }
    }
  }
  if (!checkCapabilities && !externalImports) {
    return { dependencies, methods, runtimeSources, unsupported }
  }
  babel.traverse(ast, {
    CallExpression(p) {
      const callee = p.get('callee')
      let method: string | undefined
      let bindingName: string | undefined
      if (callee.isMemberExpression() && !callee.node.computed && callee.get('object').isIdentifier() && callee.get('property').isIdentifier()) {
        bindingName = (callee.node.object as babel.types.Identifier).name
        method = (callee.node.property as babel.types.Identifier).name
      }
      else if (callee.isIdentifier()) {
        bindingName = callee.node.name
        const binding = p.scope.getBinding(bindingName)
        if (binding?.path.isImportSpecifier()) {
          const imported = binding.path.node.imported
          method = imported.type === 'Identifier' ? imported.name : imported.value
        }
      }
      if (!bindingName || !imports.has(bindingName) || !method) {
        return
      }
      const binding = p.scope.getBinding(bindingName)
      if (!binding?.path.parentPath?.isImportDeclaration() || !importSources.includes(binding.path.parentPath.node.source.value)) {
        return
      }
      methods.add(method)
      if (!compileTime.has(method)) {
        return
      }
      const visited = new Set<babel.NodePath>()
      const inspect = (reference: babel.NodePath) => {
        if (!reference.isIdentifier() || !reference.isReferencedIdentifier()) {
          return
        }
        const declaration = reference.scope.getBinding(reference.node.name)?.path
        if (!declaration || visited.has(declaration)) {
          return
        }
        visited.add(declaration)
        if (declaration.parentPath?.isImportDeclaration()) {
          const source = declaration.parentPath.node.source.value
          if (!importSources.includes(source) && declaration.parentPath.node.importKind !== 'type' && !(declaration.isImportSpecifier() && declaration.node.importKind === 'type')) {
            dependencies.add(source)
          }
        }
        else if (declaration.isVariableDeclarator()) {
          declaration.traverse({ Identifier: inspect })
        }
      }
      p.traverse({ Identifier: inspect })
      if (!checkCapabilities) {
        return
      }
      const constants = new Set<babel.NodePath>()
      const verified = (value: babel.NodePath, dynamic: ReadonlySet<babel.NodePath> = new Set()): boolean => {
        if (value.isStringLiteral() || value.isNumericLiteral() || value.isBooleanLiteral() || value.isNullLiteral()) {
          return true
        }
        if (value.isTSAsExpression() || value.isTSSatisfiesExpression() || value.isTSNonNullExpression()) {
          return verified(value.get('expression') as babel.NodePath, dynamic)
        }
        if (value.isUnaryExpression() && ['+', '-'].includes(value.node.operator)) {
          return verified(value.get('argument'), dynamic)
        }
        if (value.isObjectExpression()) {
          return value.get('properties').every(property => property.isObjectProperty() && !property.node.computed && verified(property.get('value'), dynamic))
        }
        if (value.isArrayExpression()) {
          return value.get('elements').every(element => element.node && verified(element as babel.NodePath, dynamic))
        }
        if (value.isArrowFunctionExpression() && value.node.params.every(param => param.type === 'Identifier')) {
          return value.get('body').isObjectExpression() && verified(value.get('body'), new Set(value.get('params')))
        }
        if (value.isIdentifier()) {
          const binding = value.scope.getBinding(value.node.name)
          if (!binding) {
            return false
          }
          if (dynamic.has(binding.path) && binding.kind === 'param') {
            return true
          }
          const declaration = binding.path
          if (!binding.constant || !declaration.isVariableDeclarator() || constants.has(declaration)) {
            return false
          }
          constants.add(declaration)
          const init = declaration.get('init')
          const valid = !!init.node && verified(init as babel.NodePath, dynamic)
          constants.delete(declaration)
          return valid
        }
        if (value.isCallExpression()) {
          const target = value.get('callee')
          let method: string | undefined
          if (target.isMemberExpression() && !target.node.computed && target.get('object').isIdentifier() && target.get('property').isIdentifier()) {
            const object = target.get('object') as babel.NodePath<babel.types.Identifier>
            const binding = object.scope.getBinding(object.node.name)?.path
            if (binding?.parentPath?.isImportDeclaration() && importSources.includes(binding.parentPath.node.source.value)) {
              method = (target.node.property as babel.types.Identifier).name
            }
          }
          else if (target.isIdentifier()) {
            const declaration = target.scope.getBinding(target.node.name)?.path
            if (declaration?.isImportSpecifier() && declaration.parentPath?.isImportDeclaration() && importSources.includes(declaration.parentPath.node.source.value)) {
              const imported = declaration.node.imported
              method = imported.type === 'Identifier' ? imported.name : imported.value
            }
          }
          return !!method && ['firstThatWorks', 'keyframes'].includes(method) && value.get('arguments').every(argument => verified(argument, dynamic))
        }
        // Arbitrary folding, spread, computed keys, methods and external reads stay on Babel.
        return false
      }
      if (!p.get('arguments').every(argument => verified(argument))) {
        unsupported = 'compile-time expressions outside the verified SWC subset'
      }
    },
  })
  if (checkCapabilities) {
    babel.traverse(ast, {
      MemberExpression(p) {
        const object = p.get('object')
        if (!object.isIdentifier()) {
          return
        }
        const declaration = object.scope.getBinding(object.node.name)?.path
        if (!declaration?.parentPath?.isImportDeclaration() || !importSources.includes(declaration.parentPath.node.source.value)) {
          return
        }
        const property = p.get('property')
        if (p.node.computed || !property.isIdentifier() || !['create', 'attrs', 'props', 'keyframes', 'firstThatWorks', 'defineVars', 'defineConsts', 'createTheme'].includes(property.node.name)
          || !p.parentPath.isCallExpression() || p.parentPath.node.callee !== p.node) {
          unsupported = 'StyleX API references outside the verified SWC subset'
        }
      },
    })
  }
  return { dependencies, methods, runtimeSources, unsupported }
}
