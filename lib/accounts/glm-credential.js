/** GLM Coding Plan observation credentials. The model selector uses ZAI_CODING_CN_API_KEY. */

export const GLM_CREDENTIAL_PREFERENCE = Object.freeze([
  { ref: 'ZAI_CODING_CN_API_KEY', origin: 'https://open.bigmodel.cn' },
  { ref: 'ANTHROPIC_AUTH_TOKEN', origin: 'https://api.z.ai' },
])

export function selectGlmCredential(resolvedByRef = {}) {
  for (const option of GLM_CREDENTIAL_PREFERENCE) {
    const value = resolvedByRef[option.ref]
    if (typeof value === 'string' && value.trim()) {
      return { ref: option.ref, origin: option.origin, value: value.trim() }
    }
  }
  return null
}

export function glmMonitorEndpoints(origin) {
  const base = String(origin ?? '').replace(/\/$/, '')
  return {
    endpoint: `${base}/api/monitor/usage/quota/limit`,
    modelUsageEndpoint: `${base}/api/monitor/usage/model-usage`,
    toolUsageEndpoint: `${base}/api/monitor/usage/tool-usage`,
  }
}
