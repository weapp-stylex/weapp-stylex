import { deploymentMessage } from './identity.mjs'

const versionPattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu

export function cloudflareClient(env, request = fetch) {
  const token = env.CLOUDFLARE_API_TOKEN
  const account = env.CLOUDFLARE_ACCOUNT_ID
  if (!token || !/^[a-f\d]{32}$/iu.test(account ?? '')) {
    throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required to verify documentation deployments.')
  }
  return async (worker, endpoint, allowMissing = false) => {
    const response = await request(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}/${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    })
    const payload = await response.json()
    if (allowMissing && response.status === 404 && payload.errors?.some(error => error.code === 10007)) {
      return undefined
    }
    if (!response.ok || payload.success !== true) {
      throw new Error(`Cloudflare ${endpoint} verification failed (HTTP ${response.status}, codes: ${(payload.errors ?? []).map(error => error.code).join(', ')}).`)
    }
    return payload.result
  }
}

// Recover an interrupted upload only when its exact identity serves all traffic.
export async function activeMatchingVersion(client, worker, identity) {
  const result = await client(worker, 'deployments', true)
  if (result === undefined) {
    return undefined
  }
  if (!Array.isArray(result?.deployments)
    || result.deployments.some(deployment => !Number.isFinite(Date.parse(deployment.created_on)))) {
    throw new TypeError('Cloudflare returned an invalid deployments response.')
  }
  const deployment = [...result.deployments].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0]
  if (!deployment) {
    return undefined
  }
  if (!Array.isArray(deployment.versions) || deployment.versions.length !== 1 || deployment.versions[0].percentage !== 100) {
    throw new Error('Documentation Worker must have exactly one active version receiving 100% of traffic.')
  }
  const versionId = deployment.versions[0].version_id
  if (typeof versionId !== 'string' || !versionPattern.test(versionId)) {
    throw new Error('Cloudflare returned an invalid active version ID.')
  }
  const version = await client(worker, `versions/${versionId}`)
  if (version?.id !== versionId) {
    throw new Error('Cloudflare returned a different version than the active deployment.')
  }
  return version.annotations?.['workers/message'] === deploymentMessage(identity) ? versionId : undefined
}

export function readDeploymentVersion(output, worker, environment) {
  const entries = output.split(/\r?\n/u).filter(line => line.trim()).map(line => JSON.parse(line))
  const deployment = entries.findLast(entry => entry?.type === 'deploy' && entry.worker_name === worker
    && (entry.wrangler_environment ?? '') === environment)
  if (typeof deployment?.version_id !== 'string' || !versionPattern.test(deployment.version_id)) {
    throw new Error(`Wrangler did not report a deployed version for ${worker}.`)
  }
  return deployment.version_id
}
