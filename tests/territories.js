// How territories are tagged ("Tag territories with" under the country tag): by default their
// own name and their country's tag, or only one of the two. Also: shown only while countries are tagged,
// the export, shared links (gt=), the saved setting, the history and edited values.
const { chromium } = require("./pw.js");
const { PAGE, isSite, serveSite } = require("./site.js");
const { chooseKind } = require("./helpers.js");
const H = { "access-control-allow-origin": "*" };
const area = cc => ({
  type: "area",
  id: 3600000000 + cc.charCodeAt(0) * 100 + cc.charCodeAt(1),
  tags: { "ISO3166-1": cc },
});

(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const ctx = await b.newContext({ viewport: { width: 1360, height: 1000 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const route = async r => {
    const u = r.request().url();
    if (isSite(u)) return serveSite(r);
    if (u.includes("/api/interpreter"))
      // one lighthouse in Puerto Rico (a territory of the US), one in Malta (a country)
      return r.fulfill({
        headers: H,
        json: {
          elements: [
            area("PR"),
            { type: "node", id: 1, lat: 18.47, lon: -66.12, tags: { name: "Morro" } },
            area("MT"),
            { type: "node", id: 2, lat: 35.9, lon: 14.5, tags: { name: "Light" } },
          ],
        },
      });
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
  // The export's country tags, by place: "PR: Puerto Rico+USA | MT: Malta"
  const tags = async () => {
    const j = JSON.parse(await p.evaluate(() => exportJson()));
    return j.customCoordinates
      .map(c => `${c.countryCode}: ${(c.extra?.tags || []).join("+")}`)
      .sort()
      .join(" | ");
  };
  const done = () =>
    p.waitForFunction(() => !running && /Done/.test(document.getElementById("now").textContent));

  await p.goto(PAGE);
  await p.fill("#apiKey", "KEY");
  await chooseKind(p, "Lighthouse");
  await p.check("input[name=scope][value=pick]");
  await p.check("#countries input[value=PR]");
  await p.check("#countries input[value=MT]");
  ok(
    (await p.isVisible("#territoryRow")) && (await p.inputValue("#territoryTag")) === "both",
    'the "Tag territories with" setting is shown under the country tag, set to both names',
  );
  await p.uncheck("#tagCountry");
  ok(await p.isHidden("#territoryRow"), "it is hidden while countries are not tagged");
  await p.check("#tagCountry");
  ok(await p.isVisible("#territoryRow"), "and shown again when they are");

  // the export, for each choice ("check again" uses the same places with the new setting)
  await p.click("#go");
  await done();
  let t = await tags();
  ok(
    t === "MT: Malta | PR: Puerto Rico+USA",
    "by default a territory gets its own name and its country: " + t,
  );
  await p.selectOption("#territoryTag", "own");
  await p.click("#again");
  await done();
  t = await tags();
  ok(t === "MT: Malta | PR: Puerto Rico", "only their own name: " + t);
  await p.selectOption("#territoryTag", "parent");
  await p.click("#again");
  await done();
  t = await tags();
  ok(t === "MT: Malta | PR: USA", "only their country: " + t);
  ok(
    (await p.evaluate(() => localStorage.getItem("lookout2.territoryTag"))) === '"parent"',
    "the choice is saved in this browser",
  );

  // links and the history
  await p.click("#share");
  const link = await p.evaluate(() => navigator.clipboard.readText());
  ok(/[?&]gt=parent(&|$)/.test(link), "the shared link has gt=parent");
  const entry = await p.evaluate(() => JSON.parse(localStorage.getItem("lookout2.history"))[0]);
  ok(!/(^|&)gt=/.test(entry.params), "the history entry of the first search has no gt (it used both names)");
  const p2 = await ctx.newPage();
  p2.on("pageerror", e => errs.push(String(e)));
  await p2.route("**/*", route);
  await p2.goto(link);
  await p2.waitForTimeout(300);
  ok((await p2.inputValue("#territoryTag")) === "parent", "the recipient gets the same choice");
  await p2.goto(PAGE + "?k=man_made%3Dlighthouse&s=pick&c=PR");
  await p2.waitForTimeout(300);
  ok((await p2.inputValue("#territoryTag")) === "both", "a link without gt tags territories with both names");
  await p2.goto(PAGE + "?k=man_made%3Dlighthouse&s=pick&c=PR&gt=%3Cb%3E");
  await p2.waitForTimeout(300);
  ok((await p2.inputValue("#territoryTag")) === "both", "an unknown gt counts as both names");
  await p2.close();
  await p.click("#historyBtn");
  await p.click('#historyList li:first-child button:has-text("Use these settings")');
  ok(
    (await p.inputValue("#territoryTag")) === "both",
    "history: Use these settings brings back the choice of that search",
  );

  // saved and edited values on the next visit
  await p.evaluate(() => localStorage.setItem("lookout2.territoryTag", JSON.stringify("own")));
  await p.goto(PAGE);
  await p.waitForTimeout(300);
  ok((await p.inputValue("#territoryTag")) === "own", "the saved choice comes back on the next visit");
  await p.evaluate(() => localStorage.setItem("lookout2.territoryTag", JSON.stringify({ x: 1 })));
  await p.goto(PAGE);
  await p.waitForTimeout(300);
  ok((await p.inputValue("#territoryTag")) === "both", "an edited saved value counts as both names");

  ok(errs.length === 0, "no page errors " + errs.join(" | "));
  await b.close();
  console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
  process.exit(fail ? 1 : 0);
})();
