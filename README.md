# Universal AI Prompt Generator

A production-quality, premium web application for generating high-quality AI prompts — offline or with your own AI API keys.

## Features

- **Offline Prompt Engine** — Generate structured prompts without any API key or internet connection
- **Multi-AI Provider Support** — 13+ providers: OpenAI, Google Gemini, Anthropic Claude, OpenRouter, Groq, Mistral, DeepSeek, xAI, Cohere, Together AI, Perplexity, Ollama, and generic OpenAI-compatible endpoints
- **Hinglish Support** — First-class detection of Roman Hindi, Devanagari, and mixed Hinglish text
- **Multilingual** — 16 languages supported with translation dictionaries
- **Local Database** — IndexedDB-powered prompt library with 40+ built-in templates
- **AI Database Updates** — AI-generated template updates with schema validation, review workflow, and rollback
- **PWA** — Installable, offline-capable Progressive Web App
- **Privacy-First** — No accounts, no backend, no tracking. API keys never leave your browser
- **Responsive** — Works on mobile, tablet, and desktop
- **Accessible** — Keyboard navigation, ARIA, reduced motion support

## Tech Stack

- React 18 + TypeScript
- Vite
- Tailwind CSS
- IndexedDB
- Service Worker / PWA
- Vitest (testing)

## Quick Start

```bash
# Install dependencies
npm install

# Run dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run tests
npm test
```

## Deploy to GitHub Pages

1. Fork or clone this repository
2. Push to the `main` branch
3. GitHub Actions will automatically build and deploy to GitHub Pages
4. Go to Settings → Pages to configure your custom domain (optional)

The workflow is defined in `.github/workflows/deploy.yml`.

## Architecture

```
UI (React + TypeScript + Tailwind)
    ↓
Application Services (Context + Hooks)
    ↓
Prompt Engine (Language Detection + Intent Detection + Prompt Builder)
    ↓
AI Provider Layer (Common Adapter Interface + Provider Manager)
    ↓
Database Layer (IndexedDB Repository)
    ↓
IndexedDB
```

### Project Structure

```
prompt-generator/
├── src/
│   ├── components/      # UI components (Layout, etc.)
│   ├── context/         # React context (App, Toast)
│   ├── data/            # Built-in templates, categories, Hinglish patterns
│   ├── database/        # IndexedDB layer + repository
│   ├── engine/          # Prompt engine (detection, builder, actions)
│   ├── i18n/             # Internationalization
│   ├── pages/           # Route pages (Home, Generator, Settings, etc.)
│   ├── providers/       # AI provider adapters + registry + manager
│   ├── styles/          # Global CSS + Tailwind
│   ├── types/           # TypeScript type definitions
│   └── updates/         # AI database update system
├── locales/             # Translation JSON files
├── public/              # Static assets (manifest, service worker, icons)
├── tests/               # Vitest test files
├── .github/workflows/   # GitHub Actions
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── README.md
```

## Configuring AI Providers

1. Go to **Settings** → **AI Providers**
2. Click **Add Provider**
3. Select a provider (e.g., OpenAI, Gemini)
4. Enter your API key (stored locally in your browser only)
5. Select a model
6. Click **Test Connection** to verify

### Security Note

Browser-side API usage may expose keys to browser extensions, local malware, or network inspection. Keys are stored locally only when you explicitly choose to save them. Use at your own discretion.

## Supported AI Providers

| Provider | Auth | Streaming |
|----------|------|-----------|
| OpenAI | Bearer | ✅ |
| Google Gemini | API Key (query) | ✅ |
| Anthropic Claude | x-api-key | ✅ |
| OpenRouter | Bearer | ✅ |
| Groq | Bearer | ✅ |
| Mistral | Bearer | ✅ |
| DeepSeek | Bearer | ✅ |
| xAI (Grok) | Bearer | ✅ |
| Cohere | Bearer | ✅ |
| Together AI | Bearer | ✅ |
| Perplexity | Bearer | ✅ |
| Ollama (Local) | None | ✅ |
| Generic | Bearer | ✅ |

## Privacy

- No accounts or login required
- API keys are stored locally only when you choose to save them
- Prompt data and history stored in browser IndexedDB
- AI requests go directly from browser to the selected provider
- No data is sent to any server controlled by this application

## License

MIT
