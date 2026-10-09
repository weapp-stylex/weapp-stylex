export interface StylexDiagnostic {
  level: 'warning' | 'error'
  code: 'STYLEX_FALLBACK' | 'STYLEX_COMPILE_ERROR'
  message: string
  file: string
  line?: number
  column?: number
  hint: string
}

export function formatDiagnostic(diagnostic: StylexDiagnostic): string {
  const location = diagnostic.line ? `:${diagnostic.line}:${diagnostic.column ?? 1}` : ''
  return `[weapp-stylex] ${diagnostic.file}${location}: ${diagnostic.message}\n${diagnostic.hint}`
}

export class StylexCompileError extends Error {
  constructor(readonly diagnostic: StylexDiagnostic, cause?: unknown) {
    super(formatDiagnostic(diagnostic), { cause })
    this.name = 'StylexCompileError'
  }
}

export function compileError(cause: unknown, file: string): StylexCompileError {
  if (cause instanceof StylexCompileError) {
    return cause
  }
  const error = cause as { message?: string, loc?: { line: number, column: number } }
  return new StylexCompileError({
    level: 'error',
    code: 'STYLEX_COMPILE_ERROR',
    file,
    message: error?.message ?? String(cause),
    line: error?.loc?.line,
    column: error?.loc ? error.loc.column + 1 : undefined,
    hint: 'Check the StyleX expression and directly import tokens from a tokens.stylex.ts file. Use backend: "babel" for expressions outside the SWC subset.',
  }, cause)
}
