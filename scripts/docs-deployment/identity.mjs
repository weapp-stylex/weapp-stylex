import { resolveDeploymentContext } from '../../apps/docs/scripts/deployment-context.mjs'

export const docsTargets = {
  preview: { worker: 'weapp-stylex-docs-preview', environment: 'preview' },
  stable: { worker: 'weapp-stylex-docs', environment: '' },
}

export function buildIdentity(env, sourceSha) {
  const { channel } = resolveDeploymentContext(env)
  if (!/^[a-f\d]{40}$/u.test(sourceSha ?? '') || (env.REPO_DOCS_SOURCE_SHA && env.REPO_DOCS_SOURCE_SHA !== sourceSha)) {
    throw new Error('Documentation source must match the checked-out Git commit.')
  }
  return {
    channel,
    sourceSha,
    releaseId: env.REPO_DOCS_RELEASE_ID || '',
    deploymentId: env.REPO_DOCS_DEPLOYMENT_ID || '',
  }
}

export function assertDeploymentContext(env, channel) {
  const context = resolveDeploymentContext(env)
  if (!Object.hasOwn(docsTargets, channel) || env.REPO_DOCS_SITE !== 'stylex'
    || env.REPO_DOCS_CHANNEL !== channel || context.channel !== channel
    || !/^[a-f\d]{40}$/u.test(env.REPO_DOCS_SOURCE_SHA ?? '')
    || !/^[a-f\d]{64}$/u.test(env.REPO_DOCS_DEPLOYMENT_ID ?? '')
    || !env.REPO_DOCS_RESULT_FILE || env.REPO_DOCS_URL !== context.origin) {
    throw new Error('Direct documentation deployment is disabled. Use repo docs deploy stylex with a verified source and channel.')
  }
  if (channel === 'stable' && (!env.REPO_DOCS_RELEASE_ID || env.GITHUB_ACTIONS !== 'true'
    || !/^[1-9]\d*$/u.test(env.GITHUB_RUN_ID ?? '') || env.REPO_DOCS_CONCURRENCY_GROUP !== 'docs-stylex-stable')) {
    throw new Error('Stable documentation requires a completed release and the managed docs-stylex-stable workflow.')
  }
  return { ...docsTargets[channel], url: context.origin }
}

export function assertBuildIdentity(actual, expected) {
  if (!actual || typeof actual !== 'object'
    || Object.entries(expected).some(([key, value]) => actual[key] !== value)) {
    throw new Error('Documentation artifact does not match this deployment; rebuild the selected snapshot.')
  }
}

export const deploymentMessage = identity => `repoctl-docs:${identity.deploymentId}`
