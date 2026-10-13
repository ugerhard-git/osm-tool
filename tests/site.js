// The tests load the app from a made-up web address instead of from disk (file://).
// The test browser sometimes throws away everything a file:// page saved in the browser when it
// reloads, which made the tests that reload the page fail at random. Requests to this address are
// answered with the files in dist/, so nothing goes out to the network.
const path = require("path");

const SITE = "https://lookout.test/";
const PAGE = SITE + "index.nokey.html";
const dist = path.resolve(__dirname, "../dist");

/** True for requests to the made-up address that serves dist/. */
const isSite = url => url.startsWith(SITE);

/** Answers a request to the made-up address with the matching file from dist/. */
function serveSite(route) {
  const file = path.join(dist, decodeURIComponent(new URL(route.request().url()).pathname));
  if (!file.startsWith(dist + path.sep)) return route.fulfill({ status: 404, body: "" });
  return route.fulfill({ path: file });
}

module.exports = { SITE, PAGE, isSite, serveSite };
