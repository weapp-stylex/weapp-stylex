export interface DeploymentContext {
  channel: 'stable' | 'preview'
  origin: string
  preview: boolean
  stableOrigin: string
}

export function resolveDeploymentContext(env?: Record<string, string | undefined>): DeploymentContext
export function withDeploymentHeaders(headers: string, context: DeploymentContext): string
