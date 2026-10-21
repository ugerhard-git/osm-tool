// Several kinds of place in step 1 ("or"): chips, "+ Add another kind of place", the limit of 3, the
// combined query and search, the summary and map name, "Name contains" for every kind, the "too many"
// check on the sum, links with one k= per kind, and that a single kind still gives the same query.
const { chromium } = require("./pw.js");
const { PAGE, isSite, serveSite } = require("./site.js");
const { chooseKind } = require("./helpers.js");
const H = { "access-control-allow-origin": "*" };
const area = cc => ({ type: "area", id: 3600000000 + cc.charCodeAt(0), tags: { "ISO3166-1": cc } });
const node = (id, lat, lon, name) => ({ type: "node", id, lat, lon, tags: { name } });

(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const log = { overpass: [], counts: { lighthouse: 23456, windmill: 1000 } };
  const ctx = await b.newContext({ viewport: { width: 1360, height: 1000 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e)));
  await p.route("**/*", async r => {
    const u = r.request().url();
    if (isSite(u)) return serveSite(r);
    if (u.includes("/api/interpreter")) {
      const q = decodeURIComponent(r.request().postData().slice(5));
      log.overpass.push(q);
      // A lighthouse, a windmill, and one place that is both (it must appear once).
      return r.fulfill({
        headers: H,
        json: {
          elements: [
            area("MT"),
            node(1, 35.9, 14.5, "Light"),
            node(2, 35.91, 14.51, "Mill"),
            node(3, 35.92, 14.52, "Mill with a light"),
            node(3, 35.92, 14.52, "Mill with a light"),
          ],
        },
      });
    }
    if (u.includes("taginfo.openstreetmap.org/api")) {
      const n = u.includes("windmill") ? log.counts.windmill : log.counts.lighthouse;
      return r.fulfill({ headers: H, json: { data: [{ type: "all", count: n }] } });
    }
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
  });
  const state = () =>
    p.evaluate(() => ({
      chips: [...document.querySelectorAll("#kindChips .chip")].map(c => c.textContent).join(" | "),
      field: !document.getElementById("kindCombo").hidden,
      add: !document.getElementById("addKind").hidden,
      full: !document.getElementById("kindsFull").hidden,
      picked: document.getElementById("picked").textContent.replace(/\s+/g, " "),
      name: document.getElementById("mapName").placeholder,
      query: document.getElementById("queryText").value,
    }));
  const addKind = async text => {
    await p.click("#addKind");
    await p.fill("#kind", text);
    await p.keyboard.press("Enter");
  };

  await p.goto(PAGE);
  await p.fill("#apiKey", "KEY");
  await p.check("input[name=scope][value=pick]");
  await p.check("#countries input[value=MT]");
  let s = await state();
  ok(s.field && !s.add && !s.chips, "at first: just the field, no chips, no link");

  // one kind: a chip, the field steps aside, the link appears; the query is unchanged from before
  await chooseKind(p, "Lighthouse");
  await p.waitForFunction(() => /23,456/.test(document.getElementById("picked").textContent));
  s = await state();
  ok(
    s.chips === "Lighthouse" &&
      !s.field &&
      s.add &&
      /About 23,456/.test(s.picked) &&
      s.name === "Lighthouse (Malta)",
    "one kind: chip, link to add another, summary and map name as before",
  );
  ok(
    s.query.includes('  node["man_made"="lighthouse"](area.c);\n  out body;') &&
      s.query.includes(
        '  (way["man_made"="lighthouse"](area.c);relation["man_made"="lighthouse"](area.c););',
      ),
    "one kind: the query is written exactly as before",
  );

  // a second kind: "or" in the summary and the map name, a union in the query
  await addKind("Windmill");
  await p.waitForFunction(() => /24,456/.test(document.getElementById("picked").textContent));
  s = await state();
  ok(
    s.chips === "Lighthouse | Windmill" &&
      /Searching for man_made=lighthouse or man_made=windmill/.test(s.picked) &&
      /At most 24,456 on OpenStreetMap worldwide/.test(s.picked) &&
      s.name === "Lighthouse or Windmill (Malta)",
    'two kinds: "or" in the summary, counts added up, map name "Lighthouse or Windmill"',
  );
  ok(
    s.query.includes(
      '  (node["man_made"="lighthouse"](area.c);node["man_made"="windmill"](area.c););\n  out body;',
    ) &&
      s.query.includes(
        '  (way["man_made"="lighthouse"](area.c);relation["man_made"="lighthouse"](area.c);way["man_made"="windmill"](area.c);relation["man_made"="windmill"](area.c););',
      ),
    "two kinds: the query asks for places of either kind",
  );

  // the search finds both kinds, a place matching both only once
  await p.click("#go");
  await p.waitForFunction(() => !running && /Done/.test(document.getElementById("now").textContent));
  ok(
    log.overpass.length === 1 &&
      /node\["man_made"="windmill"\]/.test(log.overpass[0]) &&
      (await p.evaluate(() =>
        results
          .map(r => r.poi.name)
          .sort()
          .join(),
      )) === "Light,Mill,Mill with a light",
    "one search finds places of both kinds; a place of both kinds appears once",
  );

  // "Name contains" goes with every kind
  await p.fill("#nameHas", "harbour");
  s = await state();
  ok(
    s.query.includes('node["man_made"="lighthouse"]["name"~"harbour",i](area.c);') &&
      s.query.includes('node["man_made"="windmill"]["name"~"harbour",i](area.c);') &&
      /with a name containing harbour/.test(s.picked),
    '"Name contains" applies to every kind',
  );
  await p.fill("#nameHas", "");

  // a third kind is the most; the same kind twice is ignored
  await p.click("#addKind");
  await p.fill("#kind", "Windmill");
  await p.keyboard.press("Enter");
  s = await state();
  ok(s.chips === "Lighthouse | Windmill" && s.add, "the same kind twice is added only once");
  await addKind("amenity=pub|bar");
  s = await state();
  ok(
    s.chips === "Lighthouse | Windmill | amenity=pub|bar" &&
      !s.field &&
      !s.add &&
      s.full &&
      s.name === "Lighthouse + 2 more (Malta)",
    'three kinds: no field or link, a note that 3 is the most, map name "Lighthouse + 2 more"',
  );
  // the example buttons add nothing more once there are 3
  await p.evaluate(() => (document.getElementById("help").open = true));
  await p.click("#examples button >> nth=0");
  ok((await state()).chips.split(" | ").length === 3, "an example adds nothing more once there are 3");

  // removing a chip
  await p.click('#kindChips .chip[aria-label="Remove Windmill"]');
  s = await state();
  ok(s.chips === "Lighthouse | amenity=pub|bar" && s.add && !s.full, "the × on a chip removes that kind");
  // an example adds a chip while there is room
  await p.click("#examples button >> nth=0");
  ok(
    (await p.evaluate(() => kinds.map(k => k.tag).join(" | "))) ===
      "man_made=lighthouse | amenity=pub|bar | tourism=viewpoint" &&
      (await state()).chips.endsWith("Viewpoint"),
    "an example adds a chip, named from the catalogue where it has a name",
  );

  // links carry one k= per kind, and open with the same chips
  await p.click("#share");
  const link = await p.evaluate(() => navigator.clipboard.readText());
  ok(
    /\?k=man_made%3Dlighthouse&k=amenity%3Dpub%7Cbar&k=tourism%3Dviewpoint&/.test(link),
    "the link has one k= per kind, in order",
  );
  const p2 = await ctx.newPage();
  await p2.route("**/*", r =>
    isSite(r.request().url()) ? serveSite(r) : r.fulfill({ status: 204, body: "" }),
  );
  await p2.goto(link);
  await p2.waitForTimeout(400);
  ok(
    (await p2.evaluate(() => kinds.map(k => k.tag).join(" | "))) ===
      "man_made=lighthouse | amenity=pub|bar | tourism=viewpoint",
    "the recipient sees the same kinds",
  );
  // a link with more than 3 kinds, repeats and a broken one: cleaned
  await p2.goto(
    PAGE + "?k=man_made%3Dlighthouse&k=man_made%3Dlighthouse&k=not%20a%20tag&k=a%3Db&k=c%3Dd&k=e%3Df&s=pick",
  );
  await p2.waitForTimeout(400);
  ok(
    (await p2.evaluate(() => kinds.map(k => k.tag).join(" | "))) === "man_made=lighthouse | a=b | c=d",
    "links: broken tags and repeats dropped, at most 3 kinds kept",
  );
  await p2.close();

  // "too many" looks at the sum of the kinds
  await chooseKind(p, "Lighthouse");
  log.counts.lighthouse = 100000;
  log.counts.windmill = 60000;
  await p.evaluate(() => countCache.clear());
  await chooseKind(p, "Lighthouse");
  await addKind("Windmill");
  await p.waitForFunction(() => /160,000/.test(document.getElementById("picked").textContent));
  await p.check("input[name=scope][value=world]");
  const n = log.overpass.length;
  await p.click("#go");
  ok(
    /too many to search at once/.test(await p.textContent("#message")) && log.overpass.length === n,
    "two kinds that are fine alone but too many together are refused for the whole world",
  );

  ok(errs.length === 0, "no page errors " + errs.join(" | "));
  await b.close();
  console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
  process.exit(fail ? 1 : 0);
})();
