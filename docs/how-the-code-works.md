# How the code works

A guide for developers. For using the app, see the [README](../README.md).

## The big picture

Lookout is a single web page with no server of its own. Everything happens in the visitor's browser:

1. **Kind of place and area.** The visitor picks a kind of place (an OpenStreetMap tag such as `historic=castle`), optionally words the name must contain, and where to search. Where OpenStreetMap's answer does not name a place's country (a whole-world search, an own result), the built-in country-coder library finds it from the position.
2. **Places from OpenStreetMap.** The page builds an [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API) query and sends it to the public Overpass servers (or the visitor's own one). Large searches are split into parts of a few countries.
3. **Street View near each place.** For each place, in random order, the page asks Google for the nearest panorama and checks the distance, whether it is official Google coverage, and whether it is a duplicate.
4. **Map and export.** Accepted spots appear on the map and are exported as a [map-making.app](https://map-making.app) JSON file, each camera turned towards its place.

## Files

| File             | What is in it                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/page.html`  | The markup, the site owner settings (Google key, default countries) and placeholders such as `/*APP_JS*/` that the build fills in.                                                         |
| `src/style.css`  | The styles.                                                                                                                                                                                |
| `src/icon.svg`   | The page icon. `npm run icons` (`tools/icons.js`) makes `icon-32.png` and `icon-180.png` from it for Safari and phones; the build puts all three into the page.                            |
| `src/app.js`     | All app code. Starts with an overview of how a search runs, the shared state and what is saved in the browser.                                                                             |
| `src/catalog.js` | Builds the place catalogue (names and search words in five languages) from the iD editor presets.                                                                                          |
| `src/build.js`   | Puts everything into one file, `dist/index.html`: markup, styles, app code, catalogue, Leaflet, country-coder and the font. Then fingerprints the scripts for the Content Security Policy. |
| `tests/run.js`   | Runs every test file. On GitHub it also reports failures as notes on the run.                                                                                                              |
| `tests/site.js`  | Serves `dist/` at the made-up address `https://lookout.test/` for the tests.                                                                                                               |
| `tests/pw.js`    | Playwright with the first-visit dialog already dismissed.                                                                                                                                  |
| `tests/*.js`     | One file per feature area. Every outside service (Overpass, taginfo, Google) is simulated with Playwright routes, so the tests run offline and need no key.                                |

The three source files use the same section names, in the same order as the page: steps 1 to 3, the expert panel, the map, the list of named locations, the search itself, export and the first-visit dialog. Search for `---------- step 2` (for example) to find the matching part in each file.

## Where to find things in app.js

| Section                   | What it does                                                                                                                                                                              | Main functions                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| data                      | Fixed lists and limits: countries with official Street View (for grouping the country list and for skipping places in a whole-world search), Overpass servers, timeouts, country weights. |                                                                 |
| helpers                   | Small tools: saving settings, the country at a position, distances and directions, escaping text, reading tags.                                                                           | `store`, `countryAt`, `distance`, `bearing`, `esc`, `parseTags` |
| catalogue search, taginfo | Suggestions while typing a kind of place, and how often a tag is used worldwide.                                                                                                          | `searchCatalogue`, `taginfoSearch`, `worldCount`                |
| step 1, step 2            | The form: kind of place, name, countries; keeps the expert query up to date.                                                                                                              | `onKindInput`, `renderPicked`, `renderCountries`                |
| your own Overpass server  | Saving and testing a paid or private Overpass server.                                                                                                                                     | `cleanServer`, `testServer`                                     |
| your own Overpass result  | Loading an Overpass Turbo export, or running your own query, instead of searching.                                                                                                        | `parseOwn`, `ownFromData`, `loadOwn`, `runOwnQuery`             |
| shareable links           | Writing and reading the settings in the page address.                                                                                                                                     | `shareLink`, `applyLink`                                        |
| map, list of named places | Drawing places and locations, popups, removing locations.                                                                                                                                 | `drawCandidates`, `drawLocation`, `renderNames`                 |
| OpenStreetMap             | Building the query, asking the servers, splitting large searches, explaining errors.                                                                                                      | `buildQuery`, `overpass`, `fetchPlaces`, `explainOsm`           |
| Google Street View        | Looking up panoramas, the second look for official coverage, street names.                                                                                                                | `lookup`, `officialNearby`, `roadInfo`                          |
| run                       | The search from start to finish, progress and messages.                                                                                                                                   | `startSearch`, `paint`, `setPhase`                              |
| export                    | The map-making.app file.                                                                                                                                                                  | `exportJson`                                                    |

The data shapes `Place`, `Location` and `PanoAnswer` are described at the top of `app.js`. VS Code shows these descriptions when you hover over a variable.

## Rules worth knowing before you change something

- **Edit `src/`, never `dist/`.** Run `npm run build && npm test` after every change.
- **No inline event handlers.** The page's security policy only runs the scripts the build fingerprinted, so `onclick="…"` in the HTML does nothing. Wire events up in `app.js`.
- **No new outside scripts or CDNs.** Libraries are installed with npm and embedded by the build.
- **Treat everything from outside as untrusted:** Overpass, taginfo, Google, uploaded files, shared links and saved settings. Check values before use, and put text on the page with `textContent` or through `esc()`.
- **Never put keys in the code, in shared links or in error messages.** The site key comes from the `GOOGLE_API_KEY` environment variable at build time.
- **Interface text is for non-technical people:** plain words, sentence case, say what happened and what to do.
- **Be gentle with the free OpenStreetMap servers.** Don't add features that multiply requests to them.

## Formatting

The code is formatted with [Prettier](https://prettier.io). `npm run format` formats everything, and `npm run format:check` checks it, which also runs on every pull request. With the recommended VS Code extension, files are formatted when you save.

The first formatting commit is listed in `.git-blame-ignore-revs`, so GitHub's "blame" view skips it. To do the same locally, run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once.

## Linting

[ESLint](https://eslint.org) looks for likely mistakes: names that do not exist, variables that are never used, code that has no effect. `npm run lint` runs it; it also runs on every pull request, and the recommended VS Code extension underlines problems as you type. The settings are in `eslint.config.mjs`. They know which names the page provides besides `app.js` (Leaflet's `L`, `CAT`, `FRAMED`, `google`), and they let the tests use `app.js`'s top-level names inside `page.evaluate`, read straight from `app.js`.

If a rule is wrong in one particular spot, switch it off for that line with a comment that says why, as for `officialVia` in `app.js`.

## Tests

```sh
npm run build
npm test              # all test files
npm test -- share     # only files whose name starts with "share"
```

Each test file prints `PASS …` or `FAIL …` lines and ends with `ALL PASS`. Screenshots of some states are saved in `dist/screens/`. To test something new, copy the setup of a test file close to your feature: it shows how to answer the page's requests to Overpass, taginfo or Google with made-up data.

When writing a test:

- **Load the page from `PAGE`** (`tests/site.js`), not from disk (`file://`). Answer its requests with `isSite`/`serveSite` and simulate every outside service with Playwright routes, so the tests run offline and need no key.
- **Start Playwright from `tests/pw.js`**, which dismisses the first-visit welcome dialog, unless the test is about that dialog.
- **End with `ALL PASS`** when every check held; `tests/run.js` looks for it.

## Updates

Dependabot (settings in `.github/dependabot.yml`) proposes updates once a month, as pull requests:

- **Development tools** (Playwright, Prettier, ESLint): their minor and patch updates come together in one pull request. A major update comes on its own, as it may need changes here.
- **Leaflet, country-coder, the place catalogue and the font:** one pull request each. These end up in the published page, so check the page itself after merging.
- **GitHub Actions:** together in one pull request.

Only versions that have been out for at least a week are proposed. Security fixes are proposed straight away.
