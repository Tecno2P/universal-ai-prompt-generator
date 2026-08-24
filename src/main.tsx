import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { setTestMode } from './updates/updateService'

// E2E test hook: if window.__updateTestMode is set (by Playwright addInitScript),
// enable the corresponding test fixture in UpdateService.
const testMode = (window as unknown as { __updateTestMode?: string }).__updateTestMode
if (testMode) {
  setTestMode(testMode as 'VALID_UPDATE' | 'INVALID_JSON' | 'INVALID_SCHEMA' | 'DUPLICATE_RECORD' | 'VERSION_CONFLICT' | 'MALFORMED_JSON')
}

// E2E test hook: if window.__testProviderConfig is set, inject a real provider
// credential for integration testing. This calls the same credentialService
// the Settings page uses, so the full security pipeline is exercised.
const testProviderConfig = (window as unknown as {
  __testProviderConfig?: { providerId: string; apiKey: string; model: string; customEndpoint?: string }
}).__testProviderConfig
if (testProviderConfig) {
  import('./services/credentialService').then(async (cs) => {
    const reg = (await import('./providers/registry')).PROVIDER_REGISTRY.find(
      (p) => p.id === testProviderConfig.providerId,
    )
    await cs.saveCredential({
      providerId: testProviderConfig.providerId,
      name: reg?.name || 'Test Provider',
      apiKey: testProviderConfig.apiKey,
      model: testProviderConfig.model,
      customEndpoint: testProviderConfig.customEndpoint,
      storageMode: 'session',
    })
    // Signal that the provider is ready
    ;(window as unknown as { __testProviderReady?: boolean }).__testProviderReady = true
  }).catch(() => {
    // Provider injection failed — test will see no provider configured
  })
}

// Register service worker for PWA
if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // SW registration failed — app still works without offline caching
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
