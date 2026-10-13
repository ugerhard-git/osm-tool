# Notes for Claude

- The app is a single page. Edit `src/template.html` (and `src/catalog.js` / `src/build.js` for build changes); never edit `dist/`.
- After any change: `npm run build && npm test`. All test files must pass. Add a test file or cases in `tests/` for new behaviour; tests simulate every outside service with Playwright routes.
- `tests/pw.js` pre-dismisses the first-visit welcome dialog; use it unless the test is about that dialog.
- The build fingerprints the inline scripts for the Content Security Policy, so inline event handlers and new external scripts will not run. Wire events in script code.
- Never commit API keys. The site key comes from the `GOOGLE_API_KEY` environment variable at build time.
- Interface text: plain language for non-technical users, sentence case, no jargon.
