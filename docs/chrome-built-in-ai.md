# Chrome Built-in AI Notes

## Runtime Model

Chrome Built-in AI APIs are exposed as globals on `window` when the browser, feature flags, platform, and model assets support them.

In this extension, AI calls run from the popup or side-panel page (`index.html`). Do not move these calls into a Manifest V3 service worker unless Chrome explicitly supports the target API there.

This project treats every API through the same sequence:

1. Locate the global factory.
2. Ask for `availability()` when the API supports it.
3. Create a session with a download progress monitor.
4. Execute the task-specific method.
5. Destroy the session when available.

## Supported Adapter Tasks

| Task            | Global                    | Session method |
| --------------- | ------------------------- | -------------- |
| Prompt          | `window.LanguageModel`    | `prompt()`     |
| Summarize       | `window.Summarizer`       | `summarize()`  |
| Translate       | `window.Translator`       | `translate()`  |
| Detect language | `window.LanguageDetector` | `detect()`     |
| Write           | `window.Writer`           | `write()`      |
| Rewrite         | `window.Rewriter`         | `rewrite()`    |

## Compatibility Rule

Chrome AI APIs are still moving across versions and channels. Keep direct browser API calls inside `src/lib/chromeAi.ts`; UI components should call the adapter by task name.

## Manual Checks

- Open `chrome://flags/` and enable the relevant Built-in AI APIs.
- Open `chrome://on-device-internals/` to inspect model download and runtime state.
- Build with `npm run build` and load the generated `dist/` folder from `chrome://extensions/`.
- Test in Chrome, not Safari or Firefox.
- Use `npm run typecheck` before committing changes.
