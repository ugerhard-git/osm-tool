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

1. Fork the repository and create a branch.
2. `npm install`, then `npm run build` and `npm test`. See the README.
3. Make your change in `src/`. Never edit `dist/`; it is generated. [How the code works](docs/how-the-code-works.md) explains where things are.
4. Add or update a test in `tests/` for what you changed. The tests simulate OpenStreetMap, taginfo and Google, so they run offline.
5. Run `npm run format`, then `npm run build && npm test`, and open a pull request describing the change and why.

The formatting check and the tests run automatically on every pull request. In VS Code, install the recommended extensions when asked; files are then formatted when you save.

## Guidelines

- **Keep it one self-contained page.** No runtime CDNs or trackers. Libraries are installed with npm and embedded by the build.
- **Keep the security policy intact.** Only the page's own scripts may run. Treat everything from outside (Overpass, taginfo, Google, uploaded files, shared links) as untrusted: validate it, and put it on the page as text, never as HTML.
- **Never put keys in the repository, in shared links or in error messages.**
- **Write interface text for non-technical users:** plain words, sentence case, say what happened and what to do next.
- **Be kind to the free OpenStreetMap servers.** Don't add features that multiply requests to them.
