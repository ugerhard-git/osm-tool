# Lookout (osm-tool)

Lookout builds maps for [map-making.app](https://map-making.app) and GeoGuessr: Street View locations that stand near a kind of place and face it. Every lighthouse, windmill or castle with Street View nearby, for example.

It runs entirely in the browser as a single HTML page. There is no server of its own.

**Use it here: [ugerhard-git.github.io/osm-tool](https://ugerhard-git.github.io/osm-tool/)**

## How it works

1. **Find the places.** Up to three kinds of place (each an OpenStreetMap tag such as `man_made=lighthouse`, chosen through a searchable catalogue in English, German, French, Spanish and Portuguese) and optional name words are turned into an [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) query that finds places of any of those kinds. Searches over chosen countries are sent in parts, a few countries at a time; parts that time out are split and retried. A whole-world search is a single query.
2. **Check Street View.** For each place, Google's free Street View metadata service is asked for the nearest panorama within the chosen distance. If the nearest one is a user photo, a second, official-only look is made.
3. **Face the place.** Each accepted location gets a heading from the panorama towards the place.
4. **Export.** The result downloads as a map-making.app JSON file with each location's country code, optionally tagged with the country and with whether a road name is shown. Where OpenStreetMap's answer does not say which country a place is in (a whole-world search, your own Overpass result), the country is found from the place's position, offline in the browser.

More features: a shareable link for each search, uploading your own Overpass Turbo result or running your own Overpass query, using your own (paid) Overpass server (under Settings), a list of found locations by name, and removing locations before export.

## Using it

Open the published page, or build it yourself (below) and open `dist/index.html` in a browser.

A Google API key is needed for the Street View checks. Either the site has one built in, or visitors enter their own. The key needs these APIs enabled:

- **Street View Static API**: required, for the panorama lookups.
- **Maps JavaScript API**: optional, for the official-only second look and the road-name tag.

## Building

Requires Node.js 20 or newer.

```sh
npm install
npm run build                          # dist/index.html without a key
GOOGLE_API_KEY=your-key npm run build  # dist/index.html with your key built in
```

The build writes one self-contained file, `dist/index.html` (about 1.75 MB, about 630 KB when sent compressed). It embeds the place catalogue, the Leaflet map library, the country-coder country lookup and the Overpass font, and it adds a Content Security Policy that only allows the page's own scripts to run.

Never commit a key. The key is inserted by the build from the `GOOGLE_API_KEY` environment variable; the published site gets it from a GitHub secret.

## Tests

```sh
npx playwright install chromium   # once
npm run build
npm test                          # all test files
npm test -- share                 # only files whose name starts with "share"
```

The tests drive the page in a headless browser. OpenStreetMap, taginfo and Google are simulated, so they need no network and no key.

## Project layout

| Path                 | What it is                                                                            |
| -------------------- | ------------------------------------------------------------------------------------- |
| `src/page.html`      | The page's markup and site owner settings                                             |
| `src/style.css`      | The page's styles                                                                     |
| `src/icon.svg`       | The page icon; `npm run icons` makes the PNG versions next to it                      |
| `src/app.js`         | The app code                                                                          |
| `src/catalog.js`     | Builds the place catalogue from the iD editor presets                                 |
| `src/build.js`       | Assembles everything into the single file `dist/index.html`, with its security policy |
| `tests/`             | Browser tests, one file per feature area; `run.js` runs them all                      |
| `docs/`              | [How the code works](docs/how-the-code-works.md), a guide for developers              |
| `.github/workflows/` | Tests on every pull request; publishing to GitHub Pages from `main`                   |

## Publishing (GitHub Pages)

Pushing to `main` builds the page with the key from the repository secret `GOOGLE_API_KEY`, runs the tests and publishes it to GitHub Pages. The key is visible in the published page, as it is for any browser app. Protect it in the Google Cloud console: restrict it to the site's address and to the two APIs above, and set a daily quota.

## Credits and licenses

- Code: MIT License, see [LICENSE](LICENSE).
- Place data: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL, fetched live through the Overpass API and taginfo.
- Place catalogue and translations: [id-tagging-schema](https://github.com/openstreetmap/id-tagging-schema) (ISC License).
- Map: [Leaflet](https://leafletjs.com) (BSD 2-Clause License) with OpenStreetMap tiles.
- Country lookup: [country-coder](https://github.com/rapideditor/country-coder) (ISC License). Its borders are simplified, so a place within a few metres of a border can get the neighbouring country.
- Font: [Overpass](https://github.com/RedHatOfficial/Overpass) via Fontsource (SIL Open Font License 1.1).
- Street View data: Google Maps Platform, under Google's terms.

The list of countries with official Street View started from the world weights in [Vali](https://github.com/slashP/Vali).
