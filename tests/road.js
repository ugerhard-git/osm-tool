const { chromium } = require("./pw.js");
const { PAGE, isSite, serveSite } = require("./site.js");
const H = { "access-control-allow-origin": "*" };
const N = (id, lat, lon, name) => ({ type: "node", id, lat, lon, tags: { name } });
const els = [
  { type: "area", id: 1, tags: { "ISO3166-1": "MT" } },
  N(1, 35.9, 14.5, "One"),
  N(2, 35.91, 14.51, "Two"),
  N(3, 35.92, 14.52, "Three"),
];
const js = `window.google={maps:{importLibrary:async()=>({StreetViewService:class{getPanorama(req,cb){ window.__road=(window.__road||0)+1;
  if (!req.pano) return cb(null,'ZERO_RESULTS');
  if (req.pano.includes('35_90')) return cb({location:{pano:req.pano}, links:[{heading:10, description:'Triq il-Wied <b>x</b>', pano:'n1'},{heading:190, description:'', pano:'n2'}]}, 'OK');
  if (req.pano.includes('35_91')) return cb({location:{pano:req.pano}, links:[{heading:10, description:'', pano:'n3'}]}, 'OK');
  return cb(null, 'UNKNOWN_ERROR'); }}})}}; window.__lookoutReady();`;
async function run(b, name, { script, tick, check }) {
  const p = await b.newPage({ viewport: { width: 1360, height: 860 } });
  const errs = [];
  p.on("pageerror", e => errs.push(String(e)));
  await p.addInitScript(() => {
    const st = window.setTimeout;
    window.setTimeout = (f, ms, ...a) => st(f, ms >= 12000 && ms <= 15000 ? 300 : ms, ...a);
  });
  await p.route("**/*", async r => {
    const u = r.request().url();
    if (isSite(u)) return serveSite(r);
    if (u.includes("/api/interpreter")) return r.fulfill({ headers: H, json: { elements: els } });
    if (u.includes("streetview/metadata")) {
      const m = /location=([-\d.]+),([-\d.]+)/.exec(u);
      return r.fulfill({
        headers: H,
        json: {
          status: "OK",
          pano_id: "PANO_" + (+m[1]).toFixed(2).replace(".", "_") + "_000000",
          location: { lat: +m[1] - 0.0001, lng: +m[2] },
          copyright: "© Google",
          date: "2022-05",
        },
      });
    }
    if (u.includes("maps/api/js"))
      return script ? r.fulfill({ contentType: "text/javascript", body: script }) : r.abort();
    if (u.includes("taginfo"))
      return r.fulfill({ headers: H, json: { data: [{ type: "all", count: 100 }] } });
    return r.fulfill({ status: 204, body: "" });
  });
  await p.goto(PAGE);
  await p.fill("#apiKey", "KEY");
  await p.fill("#kind", "Lighthouse");
  await p.keyboard.press("Enter");
  await p.check("input[name=scope][value=pick]");
  await p.check("#countries input[value=MT]");
  if (tick) await p.check("#tagRoad");
  await p.click("#go");
  await p.waitForFunction(() => !running && /Done/.test(document.getElementById("now").textContent), null, {
    timeout: 60000,
  });
  const o = await p.evaluate(() => ({
    tags: Object.fromEntries(
      JSON.parse(exportJson()).customCoordinates.map(c => [
        c.panoId.slice(5, 10),
        (c.extra?.tags || []).join(" | "),
      ]),
    ),
    calls: window.__road || 0,
    tally: document.getElementById("tally").textContent,
    note: document.getElementById("message").hidden ? "" : document.getElementById("message").textContent,
  }));
  await p.evaluate(() => {
    const l = results.find(r => r.poi.name === "One");
    map.setView([l.lat, l.lng], 16, { animate: false });
    l.layers[2].openPopup();
  });
  o.popup = await p.textContent(".leaflet-popup .pop");
  console.log(
    `\n[${name}] ${JSON.stringify(o.tags)} | road calls ${o.calls}\n  tally: ${o.tally.replace(/Select a muted.*$/, "")}\n  note: ${o.note}\n  popup: ${o.popup.replace(/\s+/g, " ")}`,
  );
  const good = check(o) && errs.length === 0;
  console.log(good ? "  PASS" : "  FAIL " + errs.join("|"));
  await p.close();
  return good ? 0 : 1;
}
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const p = await b.newPage();
  await p.route("**/*", r =>
    isSite(r.request().url()) ? serveSite(r) : r.fulfill({ status: 204, body: "" }),
  );
  await p.goto(PAGE);
  const off = !(await p.isChecked("#tagRoad"));
  console.log(off ? "PASS option off by default" : "FAIL option on by default");
  fail += off ? 0 : 1;
  await p.close();
  fail += await run(b, "tagged", {
    script: js,
    tick: true,
    check: o =>
      o.tags["35_90"] === "Malta | Has road name" &&
      o.tags["35_91"] === "Malta | No road name" &&
      o.tags["35_92"] === "Malta" &&
      /1 with a road name, 1 without/.test(o.tally) &&
      /1 location could not be checked for a road name.*gave no answer for them/.test(o.note) &&
      /Road name shown: Triq il-Wied <b>x<\/b>/.test(o.popup),
  });
  fail += await run(b, "no-script", {
    script: null,
    tick: true,
    check: o =>
      Object.values(o.tags).every(t => t === "Malta") &&
      /3 locations could not be checked for a road name.*Maps JavaScript API could not be used/.test(
        o.note,
      ) &&
      !/road name/i.test(o.popup),
  });
  fail += await run(b, "option-off", {
    script: js,
    tick: false,
    check: o =>
      o.calls === 0 &&
      Object.values(o.tags).every(t => t === "Malta") &&
      !/road name/.test(o.tally) &&
      !o.note,
  });
  await b.close();
  console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
})();
