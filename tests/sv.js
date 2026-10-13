const { chromium } = require("./pw.js");
const { PAGE, isSite, serveSite } = require("./site.js");
const H = { "access-control-allow-origin": "*" };
const P = (id, lat, lon, name) => ({ type: "node", id, lat, lon, tags: { name } });
const off = (lat, lng, name) => ({
  status: "OK",
  pano_id: name,
  location: { lat, lng },
  copyright: "© Google",
  date: "2023-04",
});
const unoff = (lat, lng, name) => ({
  status: "OK",
  pano_id: name,
  location: { lat, lng },
  copyright: "© Jane Doe",
  date: "2021-01",
});
const jsMock =
  fn => `window.google={maps:{importLibrary:async()=>({StreetViewService:class{getPanorama(req,cb){ window.__js=(window.__js||[]); window.__js.push(req.sources.join('+'));
  const a=(${fn})(req); if(!a) return cb(null,'ZERO_RESULTS'); cb({location:{pano:a.id,latLng:{lat:()=>a.lat,lng:()=>a.lng}},copyright:'© 2024 Google',imageDate:'2023-04'},'OK');}}})}}; window.__lookoutReady();`;
async function run(b, name, { places, rest, js, check }) {
  const p = await b.newPage({ viewport: { width: 1360, height: 860 } });
  const errs = [],
    reqs = [];
  p.on("pageerror", e => errs.push(String(e)));
  await p.addInitScript(() => {
    const st = window.setTimeout;
    window.setTimeout = (f, ms, ...a) => st(f, ms >= 1000 && ms < 10000 ? 20 : ms, ...a);
  });
  await p.route("**/*", async r => {
    const u = r.request().url();
    if (isSite(u)) return serveSite(r);
    if (u.includes("/api/interpreter"))
      return r.fulfill({
        headers: H,
        json: { elements: [{ type: "area", id: 1, tags: { "ISO3166-1": "MT" } }, ...places] },
      });
    if (u.includes("streetview/metadata")) {
      const m = /location=([-\d.]+),([-\d.]+)&radius=(\d+)/.exec(u);
      reqs.push({ lat: +m[1], lng: +m[2], radius: +m[3] });
      const a = rest(+m[1], +m[2], reqs.length);
      return a === "abort" ? r.abort() : r.fulfill({ headers: H, json: a });
    }
    if (u.includes("maps/api/js"))
      return js === "abort" ? r.abort() : r.fulfill({ contentType: "text/javascript", body: js });
    if (u.includes("taginfo"))
      return r.fulfill({ headers: H, json: { data: [{ type: "all", count: 100 }] } });
    return r.fulfill({ status: 204, body: "" });
  });
  await p.goto(PAGE);
  await p.fill("#maxDist", "25");
  await p.fill("#apiKey", "KEY");
  await p.fill("#kind", "Lighthouse");
  await p.keyboard.press("Enter");
  await p.check("input[name=scope][value=pick]");
  await p.check("#countries input[value=MT]");
  await p.click("#go");
  await p.waitForFunction(() => !running && !/Ready/.test(document.getElementById("now").textContent), null, {
    timeout: 60000,
  });
  const o = await p.evaluate(() => {
    const pops = {};
    dots.eachLayer(l => {
      const h = l.getPopup().getContent()(l);
      pops[/<b>(.*?)<\/b>/.exec(h)[1]] = h
        .replace(/<a[\s\S]*$/, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();
    });
    return {
      found: results.map(r => r.poi.name + "=" + r.panoId),
      S: {
        rescued: searchStats.rescued,
        unofficial: searchStats.unofficial,
        failed: searchStats.failed,
        why: searchStats.failWhy,
        none: searchStats.none,
      },
      via: officialVia,
      js: window.__js || [],
      pops,
      note: document.getElementById("message").hidden ? "" : document.getElementById("message").textContent,
      tally: document.getElementById("tally").textContent,
    };
  });
  console.log(
    `\n[${name}] found: ${o.found.join(", ") || "-"} | via ${o.via || "-"} | js calls: ${o.js.join(", ") || "-"} | REST calls: ${reqs.length}`,
  );
  for (const v of Object.values(o.pops)) console.log("  popup:", v);
  if (o.note) console.log("  note:", o.note);
  console.log("  tally:", o.tally.replace(/Select a muted.*$/, ""));
  const good = check(o, reqs) && errs.length === 0;
  console.log(good ? "  PASS" : "  FAIL " + JSON.stringify(o.S) + errs.join("|"));
  await p.screenshot({ path: require("path").join(__dirname, "../dist/screens/" + `s_${name}.png`) });
  await p.close();
  return good ? 0 : 1;
}
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const A = P(1, 35.9, 14.5, "Alpha"),
    B = P(2, 36.0, 14.6, "Beta");
  // nearest is someone's photo; Google's script finds official coverage a little further away
  fail += await run(b, "official-via-script", {
    places: [A, B],
    rest: lat =>
      lat < 35.95
        ? unoff(35.90001, 14.50001, "CAoSLEFGMVFpcE5.user=photo")
        : unoff(36.00001, 14.60001, "CAoSLEFGMVFpcE5.other"),
    js: jsMock(
      `req => req.sources.includes('google') && req.location.lat < 35.95 ? {id:'OFFICIALPANO_0001', lat:35.90010, lng:14.5} : null`,
    ),
    check: o =>
      o.found.join() === "Alpha=OFFICIALPANO_0001" &&
      o.S.rescued === 1 &&
      o.S.unofficial === 1 &&
      o.via === "script" &&
      o.js.every(x => x === "google+outdoor") &&
      /only photos uploaded by other people/.test(o.pops.Beta) &&
      /1 found by a second, official-only look/.test(o.tally),
  });
  // Google's script cannot be loaded: six probe points around the place find the official coverage
  fail += await run(b, "official-via-probes", {
    places: [A],
    rest: (lat, lng) =>
      Math.abs(lat - 35.9) < 1e-9 && Math.abs(lng - 14.5) < 1e-9
        ? unoff(35.90001, 14.50001, "USERPHOTO_000001")
        : lat > 35.9001
          ? off(35.90013, 14.5, "OFFICIALPANO_0002")
          : { status: "ZERO_RESULTS" },
    js: "abort",
    check: (o, reqs) =>
      o.found.join() === "Alpha=OFFICIALPANO_0002" &&
      o.S.rescued === 1 &&
      o.via === "ring" &&
      reqs.length === 7 &&
      reqs.slice(1).every(r => r.radius === 15),
  });
  // official-only off: the unofficial photo is simply used, no second look
  // each failure reason is recorded
  const places5 = [
    P(1, 35.9, 14.5, "Limit"),
    P(2, 35.91, 14.51, "Temporary"),
    P(3, 35.92, 14.52, "Network"),
    P(4, 35.93, 14.53, "Odd answer"),
    P(5, 35.94, 14.54, "Invalid"),
    P(6, 35.95, 14.55, "Fine"),
    P(7, 35.96, 14.56, "Strange status"),
  ];
  fail += await run(b, "failure-reasons", {
    places: places5,
    rest: (lat, lng, n) => {
      const k = lat.toFixed(2);
      return k === "35.90"
        ? {
            status: "OVER_QUERY_LIMIT",
            error_message: "You have exceeded your daily request quota for this API.",
          }
        : k === "35.91"
          ? { status: "UNKNOWN_ERROR" }
          : k === "35.92"
            ? n > 7
              ? "abort"
              : { status: "UNKNOWN_ERROR" }
            : k === "35.93"
              ? {
                  status: "OK",
                  pano_id: "has space <b>",
                  location: { lat: 35.93, lng: 14.53 },
                  copyright: "© Google",
                }
              : k === "35.94"
                ? { status: "INVALID_REQUEST" }
                : k === "35.96"
                  ? { status: "SOMETHING_NEW" }
                  : off(35.9501, 14.55, "CAoSLEFGMVFp.odd=id~ok");
    },
    js: "abort",
    check: o =>
      o.found.join() === "Fine=CAoSLEFGMVFp.odd=id~ok" &&
      o.S.failed === 6 &&
      /failed after 4 tries\. Google's request limit was reached/.test(o.pops.Limit) &&
      /after 4 tries\. Google reported a temporary error/.test(o.pops.Temporary) &&
      /did not reach Google/.test(o.pops.Network) &&
      /lookup failed\. Google's answer could not be used: the panorama ID had an unexpected form/.test(
        o.pops["Odd answer"],
      ) &&
      /lookup failed\. Google said the request was invalid/.test(o.pops.Invalid) &&
      /Google answered "SOMETHING_NEW"/.test(o.pops["Strange status"]) &&
      /6 Street View lookups failed/.test(o.note) &&
      /1 × Google's request limit/.test(o.note) &&
      /1 × a connection problem/.test(o.note),
  });
  await b.close();
  console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
})();
