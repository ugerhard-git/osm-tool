// "Check Street View again on the same places": reruns only the Street View step on the places of the
// last OpenStreetMap search, with new settings, and keeps those places when step 1 changes.
const { chromium } = require("./pw.js");
const { PAGE, isSite, serveSite } = require("./site.js");
const H = { "access-control-allow-origin": "*" };
const N = (id, lat, lon, name) => ({ type: "node", id, lat, lon, tags: { name } });
const els = [
  { type: "area", id: 1, tags: { "ISO3166-1": "MT" } },
  N(1, 35.9, 14.5, "Near"),
  N(2, 35.91, 14.51, "Middle"),
  N(3, 35.92, 14.52, "Far"),
];
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const p = await b.newPage({ viewport: { width: 1360, height: 860 } });
  const errs = [];
  let osm = 0,
    sv = 0,
    mode = "timeout",
    deny = false;
  p.on("pageerror", e => errs.push(String(e)));
  await p.route("**/*", async r => {
    const u = r.request().url();
    if (isSite(u)) return serveSite(r);
    if (u.includes("/api/interpreter")) {
      osm++;
      return r.fulfill({
        headers: H,
        json:
          mode === "timeout"
            ? {
                elements: [],
                remark: 'runtime error: Query timed out in "query" at line 1 after 91 seconds.',
              }
            : { elements: els },
      });
    }
    if (u.includes("streetview/metadata")) {
      sv++;
      if (deny)
        return r.fulfill({ headers: H, json: { status: "REQUEST_DENIED", error_message: "bad key" } });
      const m = /location=([-\d.]+),([-\d.]+)/.exec(u);
      const k = (+m[1]).toFixed(2);
      const d = k === "35.90" ? 0.00009 : k === "35.91" ? 0.00036 : 0.0009; // about 10 m, 40 m, 100 m
      return r.fulfill({
        headers: H,
        json: {
          status: "OK",
          pano_id: "PANO_" + k.replace(".", "_") + "_000000",
          location: { lat: +m[1] - d, lng: +m[2] },
          copyright: "© Google",
          date: "2022-05",
        },
      });
    }
    if (u.includes("taginfo"))
      return r.fulfill({ headers: H, json: { data: [{ type: "all", count: 100 }] } });
    return r.fulfill({ status: 204, body: "" });
  });
  const done = () =>
    p.waitForFunction(() => !running && !/Ready/.test(document.getElementById("now").textContent));
  const names = () =>
    p.evaluate(() =>
      results
        .map(r => r.poi.name)
        .sort()
        .join(","),
    );
  await p.goto(PAGE);
  await p.fill("#maxDist", "25");
  await p.fill("#apiKey", "KEY");
  await p.fill("#kind", "Lighthouse");
  await p.keyboard.press("Enter");
  await p.check("input[name=scope][value=pick]");
  await p.check("#countries input[value=MT]");
  ok(await p.isHidden("#againBox"), "recheck button hidden before any search");
  await p.click("#go");
  await done();
  ok(
    (await p.isVisible("#fail")) &&
      /ran out of time/.test(await p.textContent("#failTitle")) &&
      (await p.isVisible("#failRetry")) &&
      (await p.isHidden("#againBox")),
    'OpenStreetMap error card offers "Try again"',
  );
  await p.screenshot({ path: require("path").join(__dirname, "../dist/screens/o1.png") });
  const n0 = osm;
  await p.click("#failRetry");
  await done();
  ok(
    osm > n0 &&
      /ran out of time/.test(await p.textContent("#failTitle")) &&
      (await p.isVisible("#failRetry")),
    "try again repeats the search (still failing)",
  );
  mode = "ok";
  const n1 = osm;
  await p.click("#failRetry");
  await done();
  ok(
    osm > n1 && (await p.isHidden("#fail")) && (await names()) === "Near",
    "try again succeeds once the server answers: " + (await names()),
  );
  ok(
    (await p.isVisible("#againBox")) &&
      /Uses the 3 places already found for "Lighthouse" \(Malta\)/.test(await p.textContent("#againHint")),
    "recheck button appears: " + (await p.textContent("#againHint")),
  );
  await p.evaluate(() => document.getElementById("again").scrollIntoView({ block: "center" }));
  await p.screenshot({ path: require("path").join(__dirname, "../dist/screens/o2.png") });
  // change only Street View settings
  const n2 = osm,
    s2 = sv;
  await p.fill("#maxDist", "60");
  await p.click("#again");
  await done();
  ok(
    osm === n2 && sv > s2 && (await names()) === "Middle,Near",
    "recheck with 60 m: no OpenStreetMap request, more locations: " + (await names()),
  );
  let j = JSON.parse(await p.evaluate(() => exportJson()));
  ok(
    j.name === "Lighthouse (Malta)" &&
      j.customCoordinates.every(c => c.countryCode === "MT" && c.extra.tags.join() === "Malta"),
    "map name, country codes and tags as in the original search",
  );
  await p.fill("#maxDist", "150");
  await p.fill("#target", "2");
  await p.click("#again");
  await done();
  ok(
    osm === n2 &&
      (await p.evaluate(() => results.length)) === 2 &&
      /Found the 2 locations/.test(await p.textContent("#now")),
    'recheck honours "Locations wanted"',
  );
  // editing step 1 afterwards does not change what the recheck uses
  await p.fill("#kind", "Windmill");
  await p.keyboard.press("Enter");
  await p.fill("#target", "500");
  await p.fill("#mapName", "My own name");
  await p.click("#again");
  await done();
  j = JSON.parse(await p.evaluate(() => exportJson()));
  ok(
    osm === n2 &&
      j.customCoordinates.length === 3 &&
      j.name === "My own name" &&
      j.customCoordinates[0].extra.tags.join() === "Malta" &&
      /for "Lighthouse"/.test(await p.textContent("#againHint")),
    "recheck keeps the earlier places even after step 1 changed",
  );
  // while running the button is disabled; a normal search replaces the kept places
  await p.fill("#mapName", "");
  await p.click("#go");
  await done();
  ok(
    osm > n2 && /for "Windmill"/.test(await p.textContent("#againHint")),
    "a new search replaces the kept places: " + (await p.textContent("#againHint")),
  );
  // Google error: no retry button (OpenStreetMap was fine)
  deny = true;
  await p.click("#again");
  await done();
  ok(
    (await p.isVisible("#fail")) &&
      /rejected the API key/.test(await p.textContent("#failTitle")) &&
      (await p.isHidden("#failRetry")),
    "Google error has no OpenStreetMap retry button",
  );
  deny = false;
  await p.click("#failClose");
  // own result mode hides the recheck button
  await p.click("#expert summary");
  await p.fill("#ownText", JSON.stringify({ elements: els }));
  await p.click("#ownUse");
  ok(await p.isHidden("#againBox"), "hidden while an own Overpass result is loaded");
  await p.click("#ownRemove");
  ok(await p.isVisible("#againBox"), "back after removing the own result");
  ok(errs.length === 0, "no page errors " + errs.join("|"));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
