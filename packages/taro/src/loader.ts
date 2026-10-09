import type {
  StylexCompilerOptions,
  StylexSession,
} from '@weapp-stylex/compiler'
import type { LoaderContext } from 'webpack'
import { formatDiagnostic } from '@weapp-stylex/compiler'

interface Context extends LoaderContext<StylexCompilerOptions> {
  stylexSession: StylexSession
}
export function stylexLoader(this: Context, code: string): void {
  this.cacheable(!Object.keys(this.stylexSession.options.babel ?? {}).length)
  const callback = this.async()
  this.stylexSession
    .transform(code, this.resourcePath, {
      resolve: (source, importer) =>
        new Promise((resolve, reject) => {
          this.resolve(
            importer.replace(/[/\\][^/\\]+$/, ''),
            source,
            (error, result) =>
              error ? reject(error) : resolve(result || undefined),
          )
        }),
      addWatchFile: id => this.addDependency(id),
      diagnostic: (diagnostic) => {
        if (diagnostic.level === 'warning') {
          this.emitWarning(new Error(formatDiagnostic(diagnostic)))
        }
      },
    })
    .then((result) => {
      if (this._module?.buildInfo) {
        Object.assign(this._module.buildInfo, {
          weappStylex: result
            ? { rules: result.rules, dependencies: result.dependencies, fingerprint: this.stylexSession.fingerprint }
            : undefined,
        })
      }
      callback(
        null,
        result?.code ?? code,
        result?.map ? JSON.parse(result.map) : undefined,
      )
    })
    .catch((error: Error) => callback(error))
}

export default stylexLoader
