// "Run your own query" in the expert panel: the query is sent to the configured servers and its answer
// is used like a loaded Overpass result. Covers adding [out:json], refusing other formats, a full run to
// the export, "Start from Lookout's query", errors with "Try again", an empty answer, Stop, the
// remembered query and the user's own server being asked first.
const { chromium } = require("./pw.js");
const { PAGE, isSite, serveSite } = require("./site.js");
const H = { "access-control-allow-origin": "*" };
const MALTA = [
  { type: "node", id: 1, lat: 35.9, lon: 14.5, tags: { name: "Alpha Light" } },
  { type: "node", id: 2, lat: 35.91, lon: 14.51, tags: { name: "Beta Light" } },
];

(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  // answer: what the Overpass servers do next ("ok", "syntax", "empty", "slow")
  const state = { answer: "ok", sent: [], hosts: [] };
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e)));
  await p.route("**/*", async r => {
    const u = r.request().url();
    if (isSite(u)) return serveSite(r);
    if (u.includes("interpreter")) {
      state.sent.push(decodeURIComponent(r.request().postData().slice(5)));
      state.hosts.push(new URL(u).host);
      if (state.answer === "syntax")
        return r.fulfill({
          status: 400,
          headers: H,
          body: "<p>Error: line 2: parse error: ';' expected</p>",
        });
      if (state.answer === "empty") return r.fulfill({ headers: H, json: { elements: [] } });
      if (state.answer === "slow") await new Promise(res => setTimeout(res, 3000));
      return r.fulfill({ headers: H, json: { elements: MALTA } }).catch(() => {});
    }
    if (u.includes("streetview/metadata")) {
      const m = /location=([-\d.]+),([-\d.]+)/.exec(u);
      return r.fulfill({
        headers: H,
        json: {
          status: "OK",
          pano_id: "PANO_" + (+m[1]).toFixed(2).replace(".", "_") + "_0000",
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
  await p.click("#partQuery summary");

  // preparing the query
  const prep = await p.evaluate(() => {
    const r = q => {
      try {
        return prepareOwnQuery(q);
      } catch (e) {
        return { error: e.message };
      }
    };
    return {
      bare: r('nwr["historic"="castle"](35,14,36,15);\nout center;'),
      settings: r("[timeout:60];\nnode(1);\nout;"),
      xml: r("[out:xml];node(1);out;"),
      empty: r("   "),
      long: r("x".repeat(20001)),
      huge: r("[out:json][timeout:99999];node(1);out;"),
    };
  });
  ok(
    prep.bare.query.startsWith("[out:json][timeout:180];\n") &&
      prep.settings.query.startsWith("[out:json][timeout:60];") &&
      prep.settings.seconds === 60 &&
      prep.huge.seconds === 900,
    "[out:json] added when missing; the query's own time limit is used, up to 15 minutes",
  );
  ok(
    /Change it to \[out:json\]/.test(prep.xml.error) && /Write a query first/.test(prep.empty.error),
    "other output formats and empty queries are refused with advice",
  );
  ok(/longer than 20,000 characters/.test(prep.long.error), "overlong queries are refused");

  // XML query: refused before anything is sent
  await p.fill("#ownQuery", "[out:xml];node(1);out;");
  await p.click("#ownQueryRun");
  ok(
    (await p.isVisible("#ownQueryError")) && state.sent.length === 0,
    "refused query: message under the field, nothing sent",
  );

  // "Start from Lookout's query"
  await p.fill("#ownQuery", "");
  await p.click("#ownQueryFromLookout");
  ok(
    /Lookout has no query yet/.test(await p.textContent("#ownQueryError")),
    "no query from Lookout yet: explained",
  );
  await p.fill("#kind", "Lighthouse");
  await p.keyboard.press("Enter");
  await p.check("input[name=scope][value=pick]");
  await p.check("#countries input[value=MT]");
  await p.click("#ownQueryFromLookout");
  ok(
    (await p.inputValue("#ownQuery")) === (await p.inputValue("#queryText")) &&
      /"man_made"="lighthouse"/.test(await p.inputValue("#ownQuery")),
    "the generated query is copied in for editing",
  );

  // a successful run
  const mine = '[timeout:90];\nnwr["man_made"="lighthouse"](35.8,14.4,36.1,14.6);\nout center;';
  await p.fill("#ownQuery", mine);
  await p.click("#ownQueryRun");
  await p.waitForFunction(() => /from your query/.test(document.getElementById("ownSummary").textContent));
  ok(
    state.sent.at(-1) === "[out:json]" + mine &&
      /2 places from your query/.test(await p.textContent("#ownSummary")) &&
      /Places in 1 country/.test(await p.textContent("#ownSummary")) &&
      (await p.isHidden("#stepKind")) &&
      (await p.isVisible("#ownStep")),
    "query sent with [out:json]; its places become your own places, with their country",
  );
  const sentBefore = state.sent.length;
  await p.click("#go");
  await p.waitForFunction(() => !running && /Done/.test(document.getElementById("now").textContent));
  const j = JSON.parse(await p.evaluate(() => exportJson()));
  ok(
    state.sent.length === sentBefore &&
      j.customCoordinates.length === 2 &&
      j.customCoordinates.every(c => c.countryCode === "MT" && c.extra.tags.join() === "Malta"),
    "Find locations checks Street View on those places without asking OpenStreetMap again",
  );
  await p.click("#ownRemove");

  // a mistake in the query: explained, and "Try again" runs the query again
  state.answer = "syntax";
  await p.click("#ownQueryRun");
  await p.waitForFunction(() => !running && !document.getElementById("fail").hidden);
  const n = state.sent.length;
  ok(
    /could not read your query/.test(await p.textContent("#failTitle")) &&
      /parse error/.test(await p.textContent("#failDetail")) &&
      (await p.isVisible("#failRetry")),
    "server rejects the query: plain explanation, the server's message in the details",
  );
  state.answer = "ok";
  await p.click("#failRetry");
  await p.waitForFunction(() => /from your query/.test(document.getElementById("ownSummary").textContent));
  ok(
    state.sent.length === n + 1 && state.sent.at(-1) === "[out:json]" + mine,
    '"Try again" sends the same query again, not a normal search',
  );
  await p.click("#ownRemove");

  // an empty answer
  state.answer = "empty";
  await p.click("#ownQueryRun");
  await p.waitForFunction(() => !document.getElementById("ownQueryError").hidden);
  ok(/Your query found nothing/.test(await p.textContent("#ownQueryError")), "empty answer explained");

  // Stop while waiting
  state.answer = "slow";
  await p.click("#ownQueryRun");
  await p.waitForFunction(() => running);
  await p.click("#go");
  await p.waitForFunction(() => !running);
  ok(
    /Stopped/.test(await p.textContent("#now")) && (await p.isHidden("#ownStep")),
    "Stop ends the query; nothing is loaded",
  );
  state.answer = "ok";

  // the query is remembered, and your own server is asked first
  await p.evaluate(() =>
    localStorage.setItem(
      "lookout2.osmOwn",
      JSON.stringify({ url: "https://mine.example/api/interpreter", mode: "first" }),
    ),
  );
  await p.reload();
  await p.waitForLoadState("load");
  ok((await p.inputValue("#ownQuery")) === mine, "the query is remembered in this browser");
  ok(
    await p.evaluate(() => document.getElementById("partQuery").open),
    "the expert section used last opens again",
  );
  await p.evaluate(() => (document.getElementById("expert").open = true)); // remembered open or closed
  state.hosts.length = 0;
  await p.click("#ownQueryRun");
  await p.waitForFunction(() => /from your query/.test(document.getElementById("ownSummary").textContent));
  ok(state.hosts[0] === "mine.example", "your own server is asked first: " + state.hosts.join(", "));
  ok(errs.length === 0, "no page errors " + errs.join(" | "));

  await b.close();
  console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
  process.exit(fail ? 1 : 0);
})();
