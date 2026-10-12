export function taroAlipayViteCompat(platform: string | undefined): {
  name: string
  enforce: 'pre'
  apply: 'build'
  generateBundle: (this: {
    emitFile: (asset: { type: 'asset', fileName: string, source: string }) => unknown
  }, options: unknown, bundle: Record<string, unknown>) => void
}
