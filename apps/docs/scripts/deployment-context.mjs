import process from 'node:process'

const origins = {
  stable: 'https://stylex.weapp.dev',
  preview: 'https://preview.stylex.weapp.dev',
}

/** Resolve the public build context without exposing deployment credentials. */
export function resolveDeploymentContext(env = process.env) {
  const channel = env.REPO_DOCS_CHANNEL || 'stable'
  if (!Object.hasOwn(origins, channel)) {
    throw new Error(`Unknown documentation channel: ${channel}`)
  }
  const origin = origins[channel]
  if (env.REPO_DOCS_URL && env.REPO_DOCS_URL !== origin) {
    throw new Error(`Documentation URL does not match the ${channel} channel`)
  }
  return { channel, origin, preview: channel === 'preview', stableOrigin: origins.stable }
}

/** Keep the existing security, cache and discovery rules in both channels. */
export function withDeploymentHeaders(headers, context) {
  if (!context.preview) {
    return headers
  }
  const rule = '  X-Robots-Tag: noindex, nofollow\n'
  return /^\/\*\r?\n/m.test(headers)
    ? headers.replace(/^\/\*\r?\n/m, match => `${match}${rule}`)
    : `${headers.trimEnd()}\n\n/*\n${rule}`
}
