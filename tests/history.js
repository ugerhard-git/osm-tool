// The history of searches: entries with title, settings and outcome, newest first and without repeats;
// "Run again", "Use these settings", "Copy link", "Remove" and "Clear history"; searches with your own
// query; uploaded results not kept; at most 20; a tampered history; the switch in Settings; and that
// neither the Google key nor the own server's address is ever stored.
const { chromium } = require("./pw.js");
const { PAGE, isSite, serveSite } = require("./site.js");
const { chooseKind } = require("./helpers.js");
const H = { "access-control-allow-origin": "*" };
const KEY = "AIzaTESTKEY0123456789abcdefghijklmnop";
const SERVER = "https://tile.tracestrack.com/overpass/SECRETSERVERKEY/";
const area = cc => ({ type: "area", id: 3600000000 + cc.charCodeAt(0), tags: { "ISO3166-1": cc } });
const node = (id, lat, lon, name) => ({ type: "node", id, lat, lon, tags: { name } });

(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const log = { overpass: [], answer: "ok" };
  const ctx = await b.newContext({ viewport: { width: 1360, height: 1000 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e)));
  await p.route("**/*", async r => {
    const u = r.request().url();
    if (isSite(u)) return serveSite(r);
    if (u.includes("interpreter")) {
      const q = decodeURIComponent(r.request().postData().slice(5));
      log.overpass.push(q);
      if (log.answer === "timeout")
        return r.fulfill({
          headers: H,
          json: {
            elements: [],
            remark: 'runtime error: Query timed out in "query" at line 1 after 181 seconds.',
          },
        });
      if (log.answer === "slow") await new Promise(res => setTimeout(res, 3000));
      return r
        .fulfill({
          headers: H,
          json: { elements: [area("MT"), node(1, 35.9, 14.5, "Light"), node(2, 35.91, 14.51, "Mill")] },
        })
        .catch(() => {});
    }
    if (u.includes("taginfo"))
      return r.fulfill({ headers: H, json: { data: [{ type: "all", count: 500 }] } });
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
  const done = () =>
    p.waitForFunction(
      () => !running && !/Ready|Asking/.test(document.getElementById("now").textContent),
      null,
      {
        timeout: 30000,
      },
    );
  const entries = () => p.evaluate(() => loadHistory());
  const openHistory = async () => {
    if (await p.isHidden("#history")) await p.click("#historyBtn");
  };
  const rows = () => p.$$eval("#historyList li", ls => ls.map(l => l.innerText.replace(/\s+/g, " ").trim()));

  await p.goto(PAGE);
  await p.fill("#apiKey", KEY);
  await openHistory();
  ok(
    /No searches yet/.test(await p.textContent("#historyEmpty")) && (await p.isHidden("#historyClear")),
    "empty at first, with a short explanation",
  );
  await p.keyboard.press("Escape");

  // search A: Lighthouse in Malta
  await chooseKind(p, "Lighthouse");
  await p.check("input[name=scope][value=pick]");
  await p.check("#countries input[value=MT]");
  await p.click("#go");
  await done();
  // search B: Windmill, whole world, 100 m, 5 wanted
  await chooseKind(p, "Windmill");
  await p.check("input[name=scope][value=world]");
  await p.fill("#maxDist", "100");
  await p.fill("#target", "5");
  await p.click("#go");
  await done();
  await openHistory();
  let r = await rows();
  console.log("  ", JSON.stringify(r));
  ok(
    r.length === 2 &&
      /^Windmill \(World\) Whole world · 100 m · up to 5 · official only Today, \d\d:\d\d · 2 locations/.test(
        r[0],
      ) &&
      /^Lighthouse \(Malta\) Malta · 50 m · up to 1,000 · official only Today, \d\d:\d\d · 2 locations/.test(
        r[1],
      ),
    "two entries, newest first, with title, settings, time and outcome",
  );
  const stored = JSON.stringify(await p.evaluate(() => localStorage.getItem("lookout2.history")));
  ok(!stored.includes(KEY) && !stored.includes("AIza"), "the Google key is not in the history");

  // "Use these settings" on A: the form is filled, nothing runs
  let n = log.overpass.length;
  await p.click("#historyList li:nth-child(2) >> text=Use these settings");
  ok(
    (await p.isHidden("#history")) &&
      (await p.evaluate(() => kinds.map(k => k.tag).join())) === "man_made=lighthouse" &&
      (await p.isChecked("input[name=scope][value=pick]")) &&
      (await p.evaluate(() => [...selected].join())) === "MT" &&
      (await p.inputValue("#maxDist")) === "50" &&
      (await p.inputValue("#target")) === "1000" &&
      /come from your history/.test(await p.textContent("#message")) &&
      log.overpass.length === n,
    '"Use these settings": the form gets the settings back, nothing runs yet',
  );

  // running the same search again moves it to the top instead of adding it twice
  await p.click("#go");
  await done();
  await openHistory();
  r = await rows();
  ok(
    r.length === 2 && /^Lighthouse \(Malta\)/.test(r[0]),
    "the same search again moves to the top, no repeat",
  );

  // "Run again" on B
  n = log.overpass.length;
  await p.click("#historyList li:nth-child(2) >> text=Run again");
  await done();
  ok(
    log.overpass.length === n + 1 &&
      /node\["man_made"="windmill"\];/.test(log.overpass.at(-1)) &&
      (await p.inputValue("#target")) === "5" &&
      (await p.evaluate(() => results.length)) === 2,
    '"Run again" runs the search with its settings straight away',
  );

  // "Copy link"
  await openHistory();
  await p.click("#historyList li:nth-child(2) >> text=Copy link");
  const link = await p.evaluate(() => navigator.clipboard.readText());
  ok(
    /\?k=man_made%3Dlighthouse&s=pick&c=MT&d=50&t=1000/.test(link) && !link.includes(KEY),
    '"Copy link" gives the shared link of that search',
  );

  // "Remove"
  await p.click("#historyList li:nth-child(2) >> text=Remove");
  r = await rows();
  ok(r.length === 1 && /^Windmill/.test(r[0]), '"Remove" takes one entry out');
  await p.keyboard.press("Escape");

  // a search with your own query: kept with the query text; "Run again" runs the query and Street View
  await p.click("#expert summary");
  await p.click("#partQuery summary");
  const myQuery = 'nwr["man_made"="lighthouse"](35.8,14.4,36.1,14.6);\nout center;';
  await p.fill("#ownQuery", myQuery);
  await p.check("#ownQueryAuto");
  await p.click("#ownQueryRun");
  await p.waitForFunction(() => /from your query/.test(document.getElementById("ownSummary").textContent));
  await done();
  await p.uncheck("#ownQueryAuto");
  let h = await entries();
  ok(
    h.length === 2 && h[0].query === myQuery.trim() && !/[?&]k=/.test("?" + h[0].params),
    "a search with your own query is kept with its query text (steps 1 and 2 left out)",
  );
  await openHistory();
  ok(
    /^My places Your own query · 100 m · up to 5/.test((await rows())[0]),
    "shown as a search with your own query",
  );
  await p.keyboard.press("Escape");
  await p.click("#ownRemove");
  await p.fill("#ownQuery", "");
  n = log.overpass.length;
  await openHistory();
  await p.click("#historyList li:nth-child(1) >> text=Run again");
  await p.waitForFunction(() => /from your query/.test(document.getElementById("ownSummary").textContent));
  await done();
  ok(
    log.overpass.length === n + 1 &&
      (await p.inputValue("#ownQuery")) === myQuery.trim() &&
      (await p.evaluate(() => results.length)) === 2,
    '"Run again" puts the query back, runs it and checks Street View',
  );
  await p.click("#ownRemove");
  await p.fill("#ownQuery", "");
  await openHistory();
  await p.click("#historyList li:nth-child(1) >> text=Use these settings");
  ok(
    (await p.inputValue("#ownQuery")) === myQuery.trim() &&
      (await p.evaluate(() => document.getElementById("partQuery").open)) &&
      (await p.isHidden("#ownStep")),
    '"Use these settings" puts the query back in "Run your own query" without running it',
  );

  // an uploaded result is not kept
  const before = (await entries()).length;
  await p.click("#partLoad summary");
  await p.fill("#ownText", JSON.stringify({ elements: [node(1, 35.9, 14.5, "Light")] }));
  await p.click("#ownUse");
  await p.click("#go");
  await done();
  ok((await entries()).length === before, "a search on an uploaded or pasted result is not kept");
  await p.click("#ownRemove");

  // stopped and failed searches note how they ended
  await chooseKind(p, "Lighthouse");
  await p.check("input[name=scope][value=pick]");
  log.answer = "slow";
  await p.click("#go");
  await p.waitForFunction(() => running);
  await p.click("#go");
  await p.waitForFunction(() => !running);
  ok((await entries())[0].outcome === "Stopped", "a stopped search says so");
  log.answer = "timeout";
  await p.fill("#maxDist", "60"); // a different search, so it gets its own entry
  await p.click("#go");
  await done();
  ok(
    (await entries())[0].outcome === "OpenStreetMap ran out of time",
    "a failed search names what went wrong",
  );
  log.answer = "ok";

  // at most 20 entries
  await p.evaluate(() => {
    const many = [];
    for (let i = 0; i < 25; i++)
      many.push({ id: "x" + i, at: 1700000000000 + i, title: "Old " + i, params: "k=a%3Db&d=" + (10 + i) });
    localStorage.setItem("lookout2.history", JSON.stringify(many));
  });
  await p.fill("#maxDist", "70");
  await p.click("#go");
  await done();
  h = await entries();
  ok(h.length === 20 && /Lighthouse/.test(h[0].title), "at most 20 entries; the newest is first");

  // a tampered history: broken entries dropped, nothing from it put on the page as HTML
  await p.evaluate(() => {
    localStorage.setItem(
      "lookout2.history",
      JSON.stringify([
        {
          id: "a",
          at: 1700000000000,
          title: "<img src=x onerror=window.__x=1>",
          params: "k=man_made%3Dlighthouse",
        },
        { id: "b", at: "yesterday", title: "bad date", params: "k=a%3Db" },
        { id: "c", at: 1700000000000, title: "no settings", params: "" },
        "junk",
        null,
        { id: "d", at: 1700000000000, title: "query only", params: "d=50", query: "node(1);out;" },
      ]),
    );
  });
  await openHistory();
  r = await rows();
  ok(
    r.length === 2 &&
      r[0].startsWith("<img src=x onerror=window.__x=1>") &&
      (await p.evaluate(() => window.__x)) === undefined &&
      (await p.$$("#historyList img")).length === 0,
    "a tampered history: broken entries dropped, titles shown as plain text",
  );
  await p.click("#historyClear");
  ok(
    (await entries()).length === 0 && /No searches yet/.test(await p.textContent("#historyEmpty")),
    '"Clear history" empties it',
  );
  await p.keyboard.press("Escape");

  // never stores the own server's address
  await p.evaluate(
    s =>
      localStorage.setItem("lookout2.osmOwn", JSON.stringify({ url: s + "api/interpreter", mode: "first" })),
    SERVER,
  );
  await p.reload();
  await p.waitForLoadState("load");
  await p.fill("#apiKey", KEY);
  await chooseKind(p, "Lighthouse");
  await p.click("#go");
  await done();
  const all = await p.evaluate(() => localStorage.getItem("lookout2.history"));
  ok(
    (await entries()).length === 1 && !all.includes("SECRETSERVERKEY") && !all.includes("tracestrack"),
    "the own server's address is not in the history",
  );

  // the switch in Settings: on by default; off clears it and stops recording
  await p.click("#settingsBtn");
  ok(await p.isChecked("#historyOn"), "the history is on by default");
  await p.uncheck("#historyOn");
  await p.click("#settingsOk");
  ok((await entries()).length === 0, "switching it off clears it");
  await p.fill("#maxDist", "80");
  await p.click("#go");
  await done();
  await openHistory();
  ok(
    (await entries()).length === 0 && /switched off/.test(await p.textContent("#historyEmpty")),
    "while it is off, searches are not kept, and the dialog says so",
  );
  await p.keyboard.press("Escape");
  await p.click("#settingsBtn");
  await p.check("#historyOn");
  await p.click("#settingsOk");

  ok(errs.length === 0, "no page errors " + errs.join(" | "));
  await b.close();
  console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
  process.exit(fail ? 1 : 0);
})();
