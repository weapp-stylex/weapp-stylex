import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { resolveDeploymentContext, withDeploymentHeaders } from './deployment-context.mjs'

describe('documentation deployment context', () => {
  it('uses the production origin for existing local builds', () => {
    const context = resolveDeploymentContext({})
    assert.equal(context.channel, 'stable')
    assert.equal(context.origin, 'https://stylex.weapp.dev')
    assert.equal(context.preview, false)
  })

  it('keeps preview metadata on its own origin and links to the stable site', () => {
    const context = resolveDeploymentContext({ REPO_DOCS_CHANNEL: 'preview', REPO_DOCS_URL: 'https://preview.stylex.weapp.dev' })
    assert.equal(context.origin, 'https://preview.stylex.weapp.dev')
    assert.equal(context.stableOrigin, 'https://stylex.weapp.dev')
    assert.equal(context.preview, true)
  })

  it('rejects unknown channels and mismatched deployment targets', () => {
    assert.throws(() => resolveDeploymentContext({ REPO_DOCS_CHANNEL: 'production' }), /Unknown documentation channel/)
    assert.throws(() => resolveDeploymentContext({ REPO_DOCS_CHANNEL: 'preview', REPO_DOCS_URL: 'https://stylex.weapp.dev' }), /does not match/)
    assert.throws(() => resolveDeploymentContext({ REPO_DOCS_URL: 'https://preview.stylex.weapp.dev' }), /does not match/)
  })

  it('adds preview indexing protection without changing existing header rules', () => {
    const headers = '/*\n  X-Content-Type-Options: nosniff\n\n/_astro/*\n  Cache-Control: public, max-age=31536000, immutable\n'
    assert.equal(withDeploymentHeaders(headers, resolveDeploymentContext({})), headers)
    const preview = withDeploymentHeaders(headers, resolveDeploymentContext({ REPO_DOCS_CHANNEL: 'preview' }))
    assert.match(preview, /^\/\*\n {2}X-Robots-Tag: noindex, nofollow\n/)
    assert.equal(preview.replace('  X-Robots-Tag: noindex, nofollow\n', ''), headers)
  })
})
