import { createChatGptGrokCapability } from './chatgpt-grok/capability.js'
import { createAntigravityCapability } from './antigravity/capability.js'

export { createChatGptGrokCapability } from './chatgpt-grok/capability.js'
export { createAntigravityCapability } from './antigravity/capability.js'

/**
 * Single construction facade for later host-index wiring. It creates exactly
 * one owner for each provider capability and deliberately registers nothing.
 */
export function createProviderCapabilities({ chatgptGrok = {}, antigravity = {} } = {}) {
  const subscription = createChatGptGrokCapability(chatgptGrok)
  const google = createAntigravityCapability(antigravity)
  let disposed = false

  return {
    chatgptGrok: subscription,
    antigravity: google,
    all: [subscription, google],
    async dispose() {
      if (disposed) return
      disposed = true
      await Promise.allSettled([subscription.dispose(), google.dispose()])
    },
  }
}
