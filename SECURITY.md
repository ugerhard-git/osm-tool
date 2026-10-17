# Security

## Reporting a problem

Please do not report security problems in public issues. Use GitHub's private reporting instead: on the repository page, open the **Security** tab and choose **Report a vulnerability**. Describe what you found and how to reproduce it. You will get an answer as soon as possible.

## How the app protects itself

- Everything the page receives from outside (OpenStreetMap servers, taginfo, Google, uploaded files, shared links) is checked before use and shown as text, never as HTML.
- A Content Security Policy only lets the page's own scripts run, plus Google's Street View script. The build fingerprints the page's scripts, so changed or injected scripts are refused.
- The page refuses to run inside another site's frame.
- No libraries are loaded from CDNs at runtime; they are embedded by the build (Leaflet, country-coder), pinned to exact versions and covered by the script fingerprints.
- API keys are never committed. The site's Google key is added at publish time from a GitHub secret. It is visible in the published page, as for any browser app, so it must be restricted in the Google Cloud console to the site's address, to the Street View Static API and Maps JavaScript API, with a daily quota.
- A visitor's own Google key is kept only for the browser tab. A visitor's own Overpass server address (which contains their key) is kept in that browser only, never put in shared links or error messages.
