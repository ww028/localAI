# localAI

A Chrome extension for developing and testing Chrome Built-in AI APIs with browser-local models.

## What This Repo Contains

- A Manifest V3 Chrome extension built with Vite + React + TypeScript.
- A single Chrome AI adapter in `src/lib/chromeAi.ts`.
- Capability checks for `LanguageModel`, `Summarizer`, `Translator`, `LanguageDetector`, `Writer`, and `Rewriter`.
- An extension popup and side panel for prompt, summarize, translate, language detection, writing, and rewriting.
- Chinese and English UI switching, with Chinese as the default language.

## Requirements

- Node.js 20 or newer.
- Chrome Canary or a Chrome version with the relevant Built-in AI APIs enabled.
- Built-in AI flags and model assets configured in Chrome.

Chrome exposes these APIs in page-like contexts. This extension calls them from the popup page, not from a service worker. If an API is missing, verify the Chrome version, flags, origin-trial status, and model download state from Chrome's own internal pages.

## Development

```bash
npm install
npm run dev
```

This starts a normal Vite preview page for UI development. For extension testing, build and load the generated `dist/` directory.

## Load The Extension

```bash
npm run build
```

Then in Chrome:

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this repo's `dist/` directory.
5. Open `localAI` from the toolbar popup or Chrome side panel.

## Scripts

```bash
npm run dev        # start local development server
npm run build      # typecheck and create loadable extension build
npm run build:extension
npm run preview    # preview production build
npm run typecheck  # run TypeScript checks only
```

## Project Structure

```text
src/
  App.tsx              # Browser AI playground UI
  lib/chromeAi.ts      # Chrome Built-in AI adapter
  styles/main.css      # Application styles
  vite-env.d.ts        # Experimental Chrome AI type declarations
public/
  manifest.json        # Chrome extension manifest
docs/
  chrome-built-in-ai.md
```

## Design Direction

The code keeps API detection and execution behind a small adapter so product code can stay stable while Chrome's experimental AI APIs evolve.
