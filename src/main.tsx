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
