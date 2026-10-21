// Large searches in parts: countries are asked a few at a time, a part that is too big is split, a
// country that still fails is skipped and named, and the search waits when the servers ask it to slow down.
const { chromium } = require("./pw.js");
const { PAGE, isSite, serveSite } = require("./site.js");
const { chooseKind } = require("./helpers.js");
const H = { "access-control-allow-origin": "*" };
const codesOf = q => /\^\(([A-Z|]+)\)\$/.exec(q)[1].split("|");
const answer = codes => ({
  elements: codes.flatMap(c => [
    { type: "area", id: 3600000000 + c.charCodeAt(0) * 100 + c.charCodeAt(1), tags: { "ISO3166-1": c } },
    {
      type: "node",
      id: c.charCodeAt(0) * 1000 + c.charCodeAt(1),
      lat: (c.charCodeAt(0) - 77) * 3 + 0.1,
      lon: (c.charCodeAt(1) - 77) * 6 + 0.1,
      tags: { name: "Place in " + c },
    },
  ]),
});
const timeout = {
  elements: [],
  remark: 'runtime error: Query timed out in "query" at line 1 after 91 seconds.',
};
const scenarios = {
  // a part containing Germany is too big unless Germany is alone; the United States always times out
  split: {
    handle: codes =>
      codes.includes("US") ? timeout : codes.includes("DE") && codes.length > 1 ? timeout : answer(codes),
  },
  // the servers ask to slow down twice, then answer
  rate: {
    n: 0,
    handle(codes) {
      return ++this.n <= 6 ? 429 : answer(codes);
    },
  },
  // stop pressed while parts are still arriving
  stop: { slow: 700, handle: codes => answer(codes) },
};
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  for (const [name, sc] of Object.entries(scenarios)) {
    const p = await b.newPage({ viewport: { width: 1360, height: 860 } });
    const errs = [],
      qs = [];
    p.on("pageerror", e => errs.push(String(e)));
    await p.addInitScript(() => {
      const st = window.setTimeout;
      window.setTimeout = (f, ms, ...a) => st(f, ms >= 20000 && ms < 100000 ? 2500 : ms, ...a);
    });
    await p.route("**/*", async r => {
      const u = r.request().url();
      if (isSite(u)) return serveSite(r);
      if (u.includes("/api/interpreter")) {
        const q = decodeURIComponent(r.request().postData().slice(5));
        const codes = codesOf(q);
        qs.push(codes);
        if (sc.slow) await new Promise(x => setTimeout(x, sc.slow));
        const a = sc.handle(codes);
        return a === 429
          ? r.fulfill({ status: 429, headers: H, body: "slow down" })
          : r.fulfill({ headers: H, json: a });
      }
      if (u.includes("streetview/metadata")) {
        const m = /location=([-\d.]+),([-\d.]+)/.exec(u);
        return r.fulfill({
          headers: H,
          json: {
            status: "OK",
            pano_id: "PANO_" + m[1].replace(/\W/g, "_") + "_" + m[2].replace(/\W/g, "_") + "_0000",
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
    await p.check("input[name=scope][value=pick]");
    // tick every Street View country, so the search runs in parts
    await p.evaluate(() => {
      for (const c of COVERAGE) selected.add(c);
      renderCountries();
    });
    await chooseKind(p, "Lighthouse");
    await p.click("#go");
    if (name === "rate") {
      await p.waitForFunction(() => /slow down/.test(document.getElementById("liveSub").textContent), null, {
        timeout: 20000,
      });
      console.log("  card:", await p.textContent("#liveSub"));
    }
    if (name === "stop") {
      await p.waitForFunction(
        () => /% done/.test(document.getElementById("liveSub").textContent) && searchStats.places > 0,
      );
      console.log("  card:", await p.textContent("#liveSub"));
      await p.screenshot({ path: require("path").join(__dirname, "../dist/screens/k1.png") });
      await p.click("#go");
    }
    await p.waitForFunction(
      () => !running && !/Ready/.test(document.getElementById("now").textContent),
      null,
      { timeout: 60000 },
    );
    const o = await p.evaluate(() => ({
      now: document.getElementById("now").textContent,
      n: results.length,
      places: searchStats.places,
      skipped: searchStats.skipped,
      cc: results
        .map(r => r.poi.cc)
        .sort()
        .join(" "),
      note: document.getElementById("message").hidden ? "" : document.getElementById("message").textContent,
      tally: document.getElementById("tally").textContent,
      fail: !document.getElementById("fail").hidden,
    }));
    console.log(`[${name}] ${qs.length} requests; ${o.now}\n  note: ${o.note}\n  tally: ${o.tally}`);
    if (name === "split") {
      ok(
        o.places === 118 &&
          o.n === 118 &&
          o.skipped === 1 &&
          !o.cc.split(" ").includes("US") &&
          o.cc.split(" ").includes("DE"),
        "all countries but the one that always fails were read: " + o.places,
      );
      ok(
        /One country was left out.*United States/.test(o.note) &&
          /1 country left out/.test(o.tally) &&
          !o.fail,
        "skipped country is named",
      );
      ok(
        qs.some(c => c.length === 1 && c[0] === "DE") && qs.filter(c => c.includes("DE")).length >= 2,
        "the part with Germany was split until it worked",
      );
      await p.screenshot({ path: require("path").join(__dirname, "../dist/screens/k2.png") });
    }
    if (name === "rate")
      ok(o.n === 119 && !o.fail, "search completes after waiting for the rate limit: " + o.n);
    if (name === "stop") {
      const n = qs.length;
      await p.waitForTimeout(1500);
      ok(
        /Stopped/.test(o.now) && !o.fail && qs.length <= n + 0,
        "stop ends the OpenStreetMap step and sends nothing further: " + o.now,
      );
    }
    ok(errs.length === 0, "no page errors " + errs.join("|"));
    await p.close();
  }
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
