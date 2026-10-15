# Working on this repository

Notes for Claude. The project's own rules are in `CONTRIBUTING.md`, and how the code fits together is in `docs/how-the-code-works.md`; read both before changing code.

## Pull requests

- **Check earlier pull requests first.** Before starting work for a new pull request, and before pushing to an existing branch, look at the state of every earlier pull request.
  - If one has been merged, start a new branch from the latest `main`. Never push to a branch whose pull request is already merged.
  - If one is still open, ask the owner whether to add to it or open a separate pull request.
- **The owner approves and merges.** Open pull requests; never merge them.
- **Plan first when asked.** When the owner asks to plan or discuss a change, agree on it before building.
- Describe in each pull request what changed and how it was tested. For visual changes, include before/after screenshots.

## Before every pull request

```sh
npm run format      # Prettier
npm run lint        # ESLint; must be clean
npm run build
npm test            # Playwright browser tests; all files must pass
```

Add a test file or cases in `tests/` for new behaviour.

## How the code is organised

- The app is published as a single page, built from `src/page.html` (markup), `src/style.css` and `src/app.js`. Edit those (and `src/catalog.js` / `src/build.js` for build changes); never edit `dist/`.
- `docs/how-the-code-works.md` describes the structure. Keep it, the overview at the top of `src/app.js` and the section names in the three source files up to date.
- Tests simulate every outside service (Overpass, taginfo, Google) with Playwright routes. They load the page from `PAGE` (`tests/site.js`), not file://, and answer its requests with `isSite`/`serveSite`.
- `tests/pw.js` pre-dismisses the first-visit welcome dialog; use it unless the test is about that dialog.
- Interface text: plain language for non-technical users, sentence case, no jargon.

## Things that must not break

- **Saved settings.** The names saved in the browser (`lookout2.…`, listed at the top of `src/app.js`) stay as they are. When an option is removed, clear its saved value when the page loads.
- **Shared links.** Links people have already sent must keep opening: query links (`?k=…`), older `#` links, and links with parameters that no longer exist (they are ignored). Everything read from a link is checked before use.
- **The security policy.** The build fingerprints the inline scripts for the Content Security Policy, so inline event handlers and new external scripts will not run; wire events in script code. Do not loosen the policy to make a change work. `tests/security.js` checks it, and `SECURITY.md` lists the protections.
- **Keys.** Never commit API keys, and never put them in shared links or error messages. The site key comes from the `GOOGLE_API_KEY` environment variable at build time.
