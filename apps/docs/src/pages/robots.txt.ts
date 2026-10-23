import { withBase } from '@cloudflare/nimbus-docs/runtime'
import { config } from 'virtual:nimbus/config'
import { resolveDeploymentContext } from '../../scripts/deployment-context.mjs'

export const prerender = true

export function GET() {
  const deployment = resolveDeploymentContext()
  const body = [
    'User-agent: *',
    deployment.preview ? 'Disallow: /' : 'Allow: /',
    '',
    ...deployment.preview ? [] : [`Sitemap: ${new URL(withBase('/sitemap-index.xml', import.meta.env.BASE_URL), config.site).href}`],
    '',
  ].join('\n')

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
