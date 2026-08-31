import test from 'node:test'
import assert from 'node:assert/strict'
import { glmMonitorEndpoints, selectGlmCredential } from '../lib/accounts/glm-credential.js'

test('GLM observation prefers the model-selector CN key and bigmodel.cn origin', () => {
  assert.deepEqual(
    selectGlmCredential({
      ZAI_CODING_CN_API_KEY: ' cn-key ',
      ANTHROPIC_AUTH_TOKEN: 'global-token',
    }),
    { ref: 'ZAI_CODING_CN_API_KEY', origin: 'https://open.bigmodel.cn', value: 'cn-key' },
  )
  assert.deepEqual(
    selectGlmCredential({ ANTHROPIC_AUTH_TOKEN: 'global-token' }),
    { ref: 'ANTHROPIC_AUTH_TOKEN', origin: 'https://api.z.ai', value: 'global-token' },
  )
  assert.equal(selectGlmCredential({}), null)
  assert.deepEqual(glmMonitorEndpoints('https://open.bigmodel.cn'), {
    endpoint: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
    modelUsageEndpoint: 'https://open.bigmodel.cn/api/monitor/usage/model-usage',
    toolUsageEndpoint: 'https://open.bigmodel.cn/api/monitor/usage/tool-usage',
  })
})
