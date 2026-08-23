import { HashRouter, Routes, Route } from 'react-router-dom'
import { AppProvider } from '@/context/AppContext'
import { ToastProvider } from '@/context/ToastContext'
import { Layout } from '@/components/Layout'
import { HomePage } from '@/pages/HomePage'
import { GeneratorPage } from '@/pages/GeneratorPage'
import { TemplatesPage } from '@/pages/TemplatesPage'
import { PlaygroundPage } from '@/pages/PlaygroundPage'
import { LibraryPage } from '@/pages/LibraryPage'
import { UpdatesPage } from '@/pages/UpdatesPage'
import { HistoryPage } from '@/pages/HistoryPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { AboutPage } from '@/pages/AboutPage'
import { ToolsPage } from '@/pages/ToolsPage'
import { SandboxPage } from '@/pages/SandboxPage'
import { DatabaseHealthPage } from '@/pages/DatabaseHealthPage'
import { ProviderHealthPage } from '@/pages/ProviderHealthPage'
import { DiagnosticsPage } from '@/pages/DiagnosticsPage'

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <HashRouter>
          <Layout>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/generator" element={<GeneratorPage />} />
              <Route path="/templates" element={<TemplatesPage />} />
              <Route path="/playground" element={<PlaygroundPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/updates" element={<UpdatesPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/tools" element={<ToolsPage />} />
              <Route path="/sandbox" element={<SandboxPage />} />
              <Route path="/database-health" element={<DatabaseHealthPage />} />
              <Route path="/provider-health" element={<ProviderHealthPage />} />
              <Route path="/diagnostics" element={<DiagnosticsPage />} />
            </Routes>
          </Layout>
        </HashRouter>
      </ToastProvider>
    </AppProvider>
  )
}
