# Contributing

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Reporting a problem

Open an issue and include:

- what you searched for (the "Copy a link to this search" link is ideal),
- what you expected and what happened,
- the error text and the "Technical details" from the error card, if there was one,
- your browser.

Please don't post API keys or keyed server addresses in issues.

## Making a change

For a bigger change or a new feature, open an issue first so we can agree on the approach before you build it. Small fixes can go straight to a pull request.

1. Fork the repository and create a branch.
2. `npm install`, then `npm run build` and `npm test`. See the README.
3. Make your change in `src/`. Never edit `dist/`; it is generated. [How the code works](docs/how-the-code-works.md) explains where things are.
4. Add or update a test in `tests/` for what you changed. The tests simulate OpenStreetMap, taginfo and Google, so they run offline.
5. Run the checks:

   ```sh
   npm run format      # Prettier
   npm run lint        # ESLint; must be clean
   npm run build
   npm test            # browser tests; all files must pass
   ```

6. Open a pull request that says what changed, why, and how you tested it. For visual changes, include before and after screenshots.

The formatting check, the linter and the tests run automatically on every pull request. In VS Code, install the recommended extensions when asked: files are then formatted when you save, and likely mistakes are underlined as you type.

## Code for people

The code is read by the owner and by developers who don't know the project. Write it so they can follow it without help.

- **Clear before clever.** Choose the plain version over the shortest or fastest one, unless the speed matters and a comment says why.
- **Every file explains itself.** Start with a short comment on what the file does. In `src/app.js`, the overview at the top covers how a search runs, the shared state and what is saved in the browser.
- **Comments say why, not what.** Explain decisions, limits and edge cases ("wait 20 s: the servers asked to slow down"); the code already shows what it does.
- **Keep to the sections.** `app.js` is one file, split into sections with the same names as in `page.html` and `style.css`. Put new code in the section it belongs to. Functions that only compute (such as `buildQuery`, `parseOwn`, `distance`) don't touch the page, so they can be tested on their own.
- **Names a reader understands:** whole words, matching the interface where possible, no private abbreviations.
- **Type notes (JSDoc)** on shared data shapes and central functions, so editors can help.
- **Follow the existing patterns.** Reuse the helpers (`$`, `store`, `esc`, `cleanText`, `makeElement`) before writing new ones.
- **No new tools without a reason.** Every dependency or build step is one more thing to learn; propose it in an issue first.
- **Keep the documentation true.** When the code changes, update its comments, the overview in `app.js`, [How the code works](docs/how-the-code-works.md) and `README.md` in the same pull request.

## Things that must not break

- **Saved settings.** The names saved in the browser (`lookout2.…`, listed at the top of `src/app.js`) stay as they are, so visitors keep their choices. When an option is removed, clear its saved value when the page loads. When a choice is removed, map its saved value to the closest remaining one (a saved "cov" becomes "world"). When a saved setting changes shape, move the old one over on load (one saved `kind` becomes the list `kinds`). Entries in the saved history of searches (`lookout2.history`) must keep running again after a change, like shared links, and never hold a key or the own server's address.
- **Shared links.** Links people have already sent must keep opening: query links (`?k=…`, with one `k` per kind of place; older links have just one), older `#` links, links with parameters that no longer exist (they are ignored), and retired values: `s=cov`, the former "Countries with Street View", opens as "Whole world". Everything read from a link is checked before use.
- **The security policy.** Only the page's own scripts may run. The build fingerprints them, so inline event handlers (`onclick="…"`) and new outside scripts will not run; wire events up in `app.js`. Do not loosen the policy to make a change work. `tests/security.js` checks it, and [SECURITY.md](SECURITY.md) lists the protections.
- **Untrusted input.** Treat everything from outside (Overpass, taginfo, Google, uploaded files, shared links, saved settings) as untrusted: check it, and put it on the page as text, never as HTML.
- **Keys.** Never put keys in the repository, in shared links or in error messages. The site key comes from the `GOOGLE_API_KEY` environment variable at build time.

## Also keep in mind

- **One self-contained page.** No runtime CDNs or trackers. Libraries are installed with npm and embedded by the build.
- **Interface text for non-technical users:** plain words, sentence case, no jargon; say what happened and what to do next.
- **Be kind to the free OpenStreetMap servers.** Don't add features that multiply requests to them.
