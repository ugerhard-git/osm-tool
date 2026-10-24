// Regions of one country in step 2: the "Only part of …" link only with exactly one country, the list
// fetched once from OpenStreetMap (first level only, sorted, names in the chosen language), chips, the
// query and map name, the search, links (r=), the history, the saved setting, and what clears them.
const { chromium } = require("./pw.js");
const { PAGE, isSite, serveSite } = require("./site.js");
const { chooseKind } = require("./helpers.js");
const H = { "access-control-allow-origin": "*" };
const region = (id, code, level, name, more = {}) => ({
  type: "relation",
  id,
  tags: { boundary: "administrative", admin_level: String(level), "ISO3166-2": code, name, ...more },
});
// Germany: three states (level 4), a district with a code (level 6, not first level), junk.
const GERMANY = [
  region(1, "DE-BY", 4, "Bayern", { "name:en": "Bavaria", "name:de": "Bayern" }),
  region(2, "DE-HE", 4, "Hessen", { "name:en": "Hesse", "name:de": "Hessen" }),
  region(3, "DE-BW", 4, "Baden-Württemberg"),
  region(4, "DE-BY", 4, "Bayern (copy)"),
  region(5, "DE-XX9", 6, "A district"),
  region(6, "FR-ARA", 4, "Not German"),
  region(7, "<b>", 4, "Broken code"),
  { type: "relation", id: 8 },
];

(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const log = { regionAsks: [], searches: [], failNext: false };
  const ctx = await b.newContext({ viewport: { width: 1360, height: 1000 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const route = async r => {
    const u = r.request().url();
    if (isSite(u)) return serveSite(r);
    if (u.includes("/api/interpreter")) {
      const q = decodeURIComponent(r.request().postData().slice(5));
      if (q.includes('rel["ISO3166-2"~')) {
        log.regionAsks.push(q);
        if (log.failNext) return r.abort();
        const cc = /\^(\w\w)-/.exec(q)[1];
        return r.fulfill({ headers: H, json: { elements: cc === "DE" ? GERMANY : [] } });
      }
      log.searches.push(q);
      return r.fulfill({
        headers: H,
        json: {
          elements: [
            { type: "area", id: 3600000001, tags: { "ISO3166-2": "DE-BY", name: "Bayern" } },
            { type: "node", id: 10, lat: 48.1, lon: 11.5, tags: { name: "Tower" } },
          ],
        },
      });
    }
    if (u.includes("taginfo.openstreetmap.org/api"))
      return r.fulfill({ headers: H, json: { data: [{ type: "all", count: 23456 }] } });
    if (u.includes("streetview/metadata")) {
      const m = /location=([-\d.]+),([-\d.]+)/.exec(u);
      return r.fulfill({
        headers: H,
        json: {
          status: "OK",
          pano_id: "PANO_" + m[1].replace(".", "_") + "_0000",
          location: { lat: +m[1] - 0.0001, lng: +m[2] },
          copyright: "© Google",
          date: "2022-05",
        },
      });
    }
    return r.fulfill({ status: 204, body: "" });
  };
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e)));
  await p.route("**/*", route);
  const state = () =>
    p.evaluate(() => ({
      box: !document.getElementById("regionBox").hidden,
      link: document.getElementById("regionOpen").hidden
        ? ""
        : document.getElementById("regionOpen").textContent,
      pick: !document.getElementById("regionPick").hidden,
      countries: !document.getElementById("countryPick").hidden,
      list: [...document.querySelectorAll("#regionList label")].map(l => l.textContent).join(" | "),
      listText: document.getElementById("regionList").textContent,
      chips: [...document.querySelectorAll("#regionChips .chip")].map(c => c.textContent).join(" | "),
      name: document.getElementById("mapName").placeholder,
      query: document.getElementById("queryText").value,
      saved: localStorage.getItem("lookout2.regions"),
    }));
  const tick = label => p.click(`#regionList label:has-text("${label}") input`);

  await p.goto(PAGE);
  await p.fill("#apiKey", "KEY");
  await chooseKind(p, "Lighthouse");
  await p.check("input[name=scope][value=pick]");
  await p.check("#countries input[value=DE]");
  await p.check("#countries input[value=AT]");
  let s = await state();
  ok(!s.box, "two countries: no region link");
  await p.uncheck("#countries input[value=AT]");
  s = await state();
  ok(
    s.box && s.link === "Only part of Germany…" && !s.pick && s.countries,
    'one country: "Only part of Germany…"',
  );
  ok(log.regionAsks.length === 0, "nothing is asked before the link is used");

  // opening the list: asked once, first level only, sorted, the country list steps aside
  await p.click("#regionOpen");
  await p.waitForFunction(() => document.querySelectorAll("#regionList label").length > 0);
  s = await state();
  ok(
    s.list === "Baden-Württemberg | Bavaria | Hesse" && s.pick && !s.countries && !s.link,
    "the list shows the first-level regions, sorted, in place of the country list: " + s.list,
  );
  ok(
    log.regionAsks.length === 1 &&
      log.regionAsks[0].includes('rel["ISO3166-2"~"^DE-"]["boundary"="administrative"]'),
    "one small query asks OpenStreetMap for the regions of Germany",
  );
  await p.fill("#regionSearch", "hes");
  ok((await state()).list === "Hesse", "the region list can be searched");
  await p.fill("#regionSearch", "");
  await p.dispatchEvent("#regionSearch", "input");

  // choosing regions: chips, map name, query
  await tick("Bavaria");
  s = await state();
  ok(
    s.chips === "Bavaria" && s.name === "Lighthouse (Bavaria)",
    'one region: chip, map name "Lighthouse (Bavaria)"',
  );
  ok(
    s.query.includes('area["ISO3166-2"~"^(DE-BY)$"]->.all;') && !s.query.includes("ISO3166-1"),
    "the query searches the region instead of the country",
  );
  await tick("Hesse");
  s = await state();
  ok(
    s.chips === "Bavaria | Hesse" &&
      s.name === "Lighthouse (2 regions of Germany)" &&
      s.saved === '["DE-BY","DE-HE"]',
    'two regions: "2 regions of Germany", saved in this browser',
  );

  // the search: the regions are asked for, the places get the country
  await p.click("#go");
  await p.waitForFunction(() => !running && /Done/.test(document.getElementById("now").textContent));
  const found = await p.evaluate(() => results.map(r => r.poi.cc).join());
  ok(
    log.searches.length === 1 &&
      log.searches[0].includes('area["ISO3166-2"~"^(DE-BY|DE-HE)$"]') &&
      found === "DE" &&
      JSON.parse(await p.evaluate(() => exportJson())).customCoordinates[0].countryCode === "DE",
    "the search covers the two regions, and the locations are tagged with the country",
  );
  ok(
    /2 regions of Germany/.test(await p.evaluate(() => lastFetch.where)),
    'the search is described as "2 regions of Germany"',
  );

  // the link carries the regions and opens with them
  await p.click("#share");
  const link = await p.evaluate(() => navigator.clipboard.readText());
  ok(/[?&]c=DE&r=DE-BY%2CDE-HE&/.test(link), "the shared link has r=DE-BY,DE-HE");
  const p2 = await ctx.newPage();
  p2.on("pageerror", e => errs.push(String(e)));
  await p2.route("**/*", route);
  await p2.goto(link);
  await p2.waitForFunction(() => document.querySelectorAll("#regionChips .chip").length === 2);
  await p2.waitForFunction(() => /Bavaria/.test(document.getElementById("regionChips").textContent));
  ok(
    (await p2.evaluate(() => [...regions].join())) === "DE-BY,DE-HE" &&
      (await p2.evaluate(() => document.getElementById("mapName").value)) === "",
    "the recipient sees the same regions, named once the list has arrived",
  );
  // links: regions of another country, broken codes and regions with two countries are dropped
  await p2.goto(PAGE + "?k=man_made%3Dlighthouse&s=pick&c=DE&r=DE-BY,FR-ARA,%3Cb%3E");
  await p2.waitForTimeout(300);
  ok(
    (await p2.evaluate(() => [...regions].join())) === "DE-BY",
    "links: regions of other countries and broken codes are dropped",
  );
  await p2.goto(PAGE + "?k=man_made%3Dlighthouse&s=pick&c=DE-AT&r=DE-BY");
  await p2.waitForTimeout(300);
  ok((await p2.evaluate(() => regions.size)) === 0, "links: regions with two countries are ignored");
  await p2.goto(PAGE + "?k=man_made%3Dlighthouse&s=pick&c=DE");
  await p2.waitForTimeout(300);
  ok((await p2.evaluate(() => regions.size)) === 0, "a link without regions searches the whole country");
  await p2.close();

  // the history keeps the regions
  const entry = await p.evaluate(() => JSON.parse(localStorage.getItem("lookout2.history"))[0]);
  ok(/(^|&)r=DE-BY%2CDE-HE(&|$)/.test(entry.params), "the history entry keeps the regions");
  await p.click("#historyBtn");
  ok(
    /Germany: 2 regions/.test(await p.textContent("#historyList li:first-child")),
    'the history shows "Germany: 2 regions"',
  );
  await p.keyboard.press("Escape");

  // the same regions again: no second request; language switch renames them
  const asked = log.regionAsks.length;
  await p.click("#regionAll");
  s = await state();
  ok(
    !s.pick && s.countries && s.link && s.chips === "" && s.name === "Lighthouse (Germany)",
    '"Search all of Germany" clears the regions',
  );
  await p.click("#regionOpen");
  await p.waitForFunction(() => document.querySelectorAll("#regionList label").length > 0);
  ok(log.regionAsks.length === asked, "the list is kept for the visit, not asked again");
  await tick("Bavaria");
  await p.selectOption("#lang", "de");
  ok((await state()).chips === "Bayern", "region names follow the language");
  await p.selectOption("#lang", "en");

  // "Use these settings" from the history brings the regions back
  await p.click("#historyBtn");
  await p.click('#historyList li:first-child button:has-text("Use these settings")');
  ok((await state()).chips === "Bavaria | Hesse", "history: Use these settings brings the regions back");

  // saved regions come back after a reload
  await p.reload();
  await p.waitForFunction(() => /Bavaria/.test(document.getElementById("regionChips").textContent));
  s = await state();
  ok(s.chips === "Bavaria | Hesse" && s.pick && !s.countries, "saved regions come back on the next visit");

  // removing a region chip, then the country, clears them
  await p.click('#regionChips .chip[aria-label="Remove Hesse"]');
  ok((await state()).chips === "Bavaria", "the × on a region chip removes it");
  await p.click('#chips .chip[data-c="DE"]');
  s = await state();
  ok(!s.box && s.countries && s.saved === "[]", "removing the country removes its regions");
  await p.check("#countries input[value=DE]");
  ok(
    (await state()).link === "Only part of Germany…",
    "choosing the country again offers the link again, no regions",
  );
  await p.click("#regionOpen");
  await p.waitForFunction(() => document.querySelectorAll("#regionList label").length > 0);
  await tick("Hesse");
  await p.check("input[name=scope][value=world]");
  s = await state();
  ok(!s.box && s.saved === "[]" && !s.query.includes("ISO3166-2"), '"Whole world" drops the regions');

  // a list that cannot be loaded, then loads; a country without regions
  await p.check("input[name=scope][value=pick]");
  await p.click('#chips .chip[data-c="DE"]');
  await p.check("#countries input[value=FR]");
  log.failNext = true;
  await p.click("#regionOpen");
  await p.waitForFunction(() => document.getElementById("regionRetry"));
  ok(
    /could not be loaded/.test((await state()).listText),
    "a list that cannot be loaded says so, with Try again",
  );
  log.failNext = false;
  await p.click("#regionRetry");
  await p.waitForFunction(() =>
    /only be searched as a whole/.test(document.getElementById("regionList").textContent),
  );
  ok(true, "Try again asks again; a country without regions says it can only be searched as a whole");

  // the parts that only compute
  const pure = await p.evaluate(() => ({
    one: regionsFromAnswer(
      [
        { tags: { "ISO3166-2": "FR-ARA", admin_level: "4", name: "Auvergne" } },
        { tags: { "ISO3166-2": "FR-01", admin_level: "6", name: "Ain" } },
      ],
      "FR",
    )
      .map(r => r.code)
      .join(),
    bad: regionsFromAnswer("nonsense", "FR").length,
    clean: cleanRegions(["DE-BY", "DE-BY", "AT-9", "de-by", "DE-TOOLONG", 5], "DE").join(),
  }));
  ok(
    pure.one === "FR-ARA" && pure.bad === 0 && pure.clean === "DE-BY",
    "regionsFromAnswer and cleanRegions keep only what they should",
  );

  ok(errs.length === 0, "no page errors " + errs.join(" | "));
  await b.close();
  console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
  process.exit(fail ? 1 : 0);
})();
