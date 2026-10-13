const { chromium } = require("./pw.js");
const { PAGE, isSite, serveSite } = require("./site.js");
const path = require("path");
const fs = require("fs");
const H = { "access-control-allow-origin": "*" };
const X = '"><img src=x onerror="window.__xss=1">';
const grouped = {
  version: 0.6,
  elements: [
    { type: "area", id: 3600365307, tags: { "ISO3166-1": "MT", name: "Malta" } },
    { type: "node", id: 1, lat: 35.9, lon: 14.5, tags: { name: "Alpha " + X } },
    { type: "way", id: 2, center: { lat: 35.91, lon: 14.51 }, tags: { name: "Beta" } },
    { type: "area", id: 3600365331, tags: { "ISO3166-1": "IT" } },
    { type: "relation", id: 3, center: { lat: 41.9, lon: 12.5 }, tags: { name: "Gamma" } },
    { type: X, id: 9, lat: 1, lon: 1, tags: { name: "bad" } },
  ],
};
const loose = {
  elements: [
    { type: "node", id: 10, lat: 48.1, lon: 11.5, tags: { name: "Tagged node" } },
    { type: "way", id: 20, nodes: [101, 102, 103, 101], tags: { name: "Outline from corner nodes" } },
    { type: "node", id: 101, lat: 48.2, lon: 11.6 },
    { type: "node", id: 102, lat: 48.2004, lon: 11.6 },
    { type: "node", id: 103, lat: 48.2004, lon: 11.6006 },
    {
      type: "way",
      id: 21,
      geometry: [
        { lat: 48.3, lon: 11.7 },
        { lat: 48.3002, lon: 11.7002 },
        { lat: 48.3, lon: 11.7 },
      ],
      tags: { name: "Outline with geometry" },
    },
    {
      type: "way",
      id: 22,
      bounds: { minlat: 48.4, minlon: 11.8, maxlat: 48.4002, maxlon: 11.8004 },
      tags: { name: "Outline with bounds" },
    },
    { type: "way", id: 23, nodes: [201, 202], tags: { highway: "residential", name: "A road" } },
    { type: "node", id: 201, lat: 48.5, lon: 11.9 },
    { type: "node", id: 202, lat: 48.501, lon: 11.9 },
    { type: "way", id: 24, tags: { name: "No position at all" } },
    {
      type: "relation",
      id: 30,
      members: [
        {
          type: "way",
          ref: 1,
          role: "outer",
          geometry: [
            { lat: 48.6, lon: 12.0 },
            { lat: 48.6004, lon: 12.0004 },
          ],
        },
      ],
      tags: { name: "Relation with member geometry" },
    },
  ],
};
fs.writeFileSync(path.join(__dirname, "../dist/malta_castles.json"), JSON.stringify(grouped));
fs.writeFileSync(path.join(__dirname, "../dist/loose-export.json"), JSON.stringify(loose));
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const errs = [],
    osm = [];
  p.on("pageerror", e => errs.push(String(e)));
  await p.route("**/*", async r => {
    const u = r.request().url();
    if (isSite(u)) return serveSite(r);
    if (u.includes("/api/interpreter")) {
      osm.push(u);
      return r.fulfill({ headers: H, json: { elements: [] } });
    }
    if (u.includes("streetview/metadata")) {
      const m = /location=([-\d.]+),([-\d.]+)/.exec(u);
      return r.fulfill({
        headers: H,
        json: {
          status: "OK",
          pano_id: "PANO_" + m[1].replace(/\W/g, "_") + "_" + m[2].replace(/\W/g, "_") + "_00",
          location: { lat: +m[1] - 0.0001, lng: +m[2] },
          copyright: "© Google",
          date: "2022-05",
        },
      });
    }
    if (u.includes("taginfo"))
      return r.fulfill({ headers: H, json: { data: [{ type: "all", count: 100 }] } });
    return r.fulfill({ status: 204, body: "" });
  });
  await p.goto(PAGE);
  await p.fill("#apiKey", "KEY");
  await p.click("#expert summary");
  ok(
    /Only one format is accepted: raw OSM data as JSON/.test(
      (await p.textContent("#expert")).replace(/\s+/g, " "),
    ) &&
      /GeoJSON, GPX, KML and XML files are not accepted/.test(
        (await p.textContent("#expert")).replace(/\s+/g, " "),
      ),
    "format constraint stated in the panel",
  );
  await p.evaluate(() => document.getElementById("ownText").scrollIntoView({ block: "center" }));
  await p.screenshot({ path: require("path").join(__dirname, "../dist/screens/l1.png") });
  const bad = {
    geojson: JSON.stringify({ type: "FeatureCollection", features: [] }),
    xml: '<?xml version="1.0"?><osm></osm>',
    mma: JSON.stringify({ name: "x", customCoordinates: [] }),
    broken: '{"elements":[{"type":"node"',
    noelements: '{"foo":1}',
    empty: JSON.stringify({ elements: [], remark: "runtime error: Query timed out" }),
    nopos: JSON.stringify({ elements: [{ type: "way", id: 1, tags: { a: "b" } }] }),
    blank: "   ",
  };
  for (const [k, v] of Object.entries(bad)) {
    await p.fill("#ownText", v);
    await p.click("#ownUse");
    const m = (await p.isVisible("#ownError")) ? await p.textContent("#ownError") : "(none)";
    console.log(`  ${k}: ${m}`);
    ok(
      m !== "(none)" &&
        (await p.isHidden("#ownStep")) &&
        {
          geojson: /GeoJSON/,
          xml: /XML/,
          mma: /map-making/,
          broken: /not valid JSON/,
          noelements: /no "elements"/,
          empty: /empty.*timed out/,
          nopos: /out center/,
          blank: /nothing to read/,
        }[k].test(m),
      `rejected: ${k}`,
    );
  }
  // grouped file through the file picker
  await p.setInputFiles("#ownFile", path.join(__dirname, "../dist/malta_castles.json"));
  await p.waitForSelector("#ownStep:not([hidden])");
  console.log("  summary:", (await p.innerText("#ownSummary")).replace(/\n/g, " | "));
  ok(
    (await p.textContent("#lastStepNo")) === "2" &&
      /Your places are loaded/.test(await p.textContent("#empty")),
    "step renumbered and map hint updated",
  );
  ok(
    (await p.isHidden("#stepKind")) &&
      (await p.isHidden("#stepWhere")) &&
      (await p.isHidden("#share")) &&
      (await p.isHidden("#ownError")),
    "steps 1 and 2 replaced, link sharing hidden",
  );
  ok(
    /3 places from malta_castles\.json/.test(await p.textContent("#ownSummary")) &&
      /2 countries/.test(await p.textContent("#ownSummary")) &&
      (await p.inputValue("#ownLabel")) === "malta castles" &&
      !(await p.isDisabled("#tagCountry")),
    "summary, label from file name, country tag available",
  );
  await p.fill("#ownLabel", "Castles");
  await p.check("#tags");
  await p.screenshot({ path: require("path").join(__dirname, "../dist/screens/l2.png") });
  await p.click("#go");
  await p.waitForFunction(() => !running && /Done/.test(document.getElementById("now").textContent));
  const j = JSON.parse(await p.evaluate(() => exportJson()));
  console.log("  export:", JSON.stringify(j).slice(0, 330));
  ok(osm.length === 0, "no request to OpenStreetMap");
  ok(
    j.name === "Castles" &&
      j.customCoordinates.length === 3 &&
      j.customCoordinates
        .map(c => c.countryCode)
        .sort()
        .join() === "IT,MT,MT" &&
      j.customCoordinates.some(c => c.extra.tags.join() === "Castles,Italy"),
    "results carry label, country codes and tags",
  );
  await p.evaluate(() => {
    layer.eachLayer(l => {
      if (l.getPopup) l.openPopup();
    });
  });
  await p.waitForTimeout(200);
  ok(
    (await p.evaluate(() => window.__xss)) === undefined &&
      (await p.$$eval('img[src="x"]', e => e.length)) === 0,
    "hostile name in the file shown as text",
  );
  // run twice: places are reused cleanly
  await p.click("#go");
  await p.waitForFunction(() => !running && /Done/.test(document.getElementById("now").textContent));
  ok((await p.evaluate(() => results.length)) === 3, "second run works on the same file");
  // loose file by drag and drop
  await p.evaluate(async txt => {
    const dt = new DataTransfer();
    dt.items.add(new File([txt], "loose-export.json", { type: "application/json" }));
    const d = document.getElementById("ownDrop");
    d.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
    d.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, JSON.stringify(loose));
  await p.waitForFunction(() => /loose-export/.test(document.getElementById("ownSummary").textContent));
  console.log("  summary:", (await p.innerText("#ownSummary")).replace(/\n/g, " | "));
  const st = await p.evaluate(() => ({
    n: own.places.length,
    names: own.places.map(x => x.name).join("; "),
    worked: own.worked,
    noPos: own.noPosition,
    lines: own.lines,
    cc: own.hasCc,
    c20: own.places.find(x => x.id === 20),
  }));
  console.log("  ", JSON.stringify(st));
  ok(
    st.n === 6 &&
      st.worked === 5 &&
      st.noPos === 1 &&
      st.lines === 1 &&
      !st.cc &&
      !/undefined/.test(st.names),
    "outlines get a centre, corner nodes ignored, object without position skipped, line noticed",
  );
  ok(
    Math.abs(st.c20.lat - 48.2002) < 1e-6 && Math.abs(st.c20.lng - 11.6003) < 1e-6,
    "centre computed from corner nodes",
  );
  ok(
    (await p.isDisabled("#tagCountry")) &&
      /does not say which country/.test(await p.textContent("#tagCountryHint")) &&
      (await p.inputValue("#ownLabel")) === "Castles",
    "country tag off without country info; label kept",
  );
  await p.click("#go");
  await p.waitForFunction(() => !running && /Done/.test(document.getElementById("now").textContent));
  const j2 = JSON.parse(await p.evaluate(() => exportJson()));
  ok(
    j2.customCoordinates.length === 6 &&
      j2.customCoordinates.every(c => !("countryCode" in c) && c.extra.tags.join() === "Castles"),
    "loose result runs; no country code or country tag",
  );
  // pasted text, then back to normal
  await p.fill("#ownText", JSON.stringify(grouped));
  await p.click("#ownUse");
  await p.waitForFunction(() => /pasted text/.test(document.getElementById("ownSummary").textContent));
  ok(
    (await p.inputValue("#ownText")) === "" &&
      /3 places from pasted text/.test(await p.textContent("#ownSummary")),
    "pasted text accepted",
  );
  await p.click("#ownRemove");
  await p.check("input[name=scope][value=cov]");
  ok((await p.textContent("#lastStepNo")) === "3", "step number restored");
  ok(
    (await p.isHidden("#ownStep")) &&
      (await p.isVisible("#stepKind")) &&
      (await p.isVisible("#stepWhere")) &&
      (await p.isVisible("#share")) &&
      !(await p.isDisabled("#tagCountry")),
    "remove returns to the normal search",
  );
  await p.fill("#kind", "Lighthouse");
  await p.keyboard.press("Enter");
  await p.click("#go");
  await p.waitForFunction(() => !running && !/Ready/.test(document.getElementById("now").textContent));
  ok(osm.length > 0, "normal search asks OpenStreetMap again");
  ok(errs.length === 0, "no page errors " + errs.join("|"));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
