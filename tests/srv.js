// Your own Overpass server: checking and testing the address, "first" and "fallback" modes, remembering
// or forgetting it, and keeping its key out of links, the query panel and error messages.
const { chromium } = require("./pw.js");
const { PAGE, isSite, serveSite } = require("./site.js");
const { chooseKind } = require("./helpers.js");
const H = { "access-control-allow-origin": "*" };
const KEY = "SECRETKEY123",
  BASE = `https://tile.tracestrack.com/overpass/${KEY}/`;
const N = (id, lat, lon, name) => ({ type: "node", id, lat, lon, tags: { name } });
const els = [{ type: "area", id: 1, tags: { "ISO3166-1": "MT" } }, N(1, 35.9, 14.5, "Near")];
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const state = { own: "ok", pub: "ok", log: [] };
  const route = async p =>
    p.route("**/*", async r => {
      const u = r.request().url();
      if (isSite(u)) return serveSite(r);
      const body = r.request().postData() || "";
      const test = body.includes("node(1)");
      if (u.startsWith("https://tile.tracestrack.com/")) {
        state.log.push("own:" + new URL(u).pathname + (test ? " (test)" : ""));
        if (u.endsWith("/api/interpreter")) return r.fulfill({ status: 404, headers: H, body: "not found" });
        if (state.own === "denied") return r.fulfill({ status: 403, headers: H, body: "forbidden" });
        if (state.own === "down") return r.abort();
        return r.fulfill({ headers: H, json: test ? { elements: [] } : { elements: els } });
      }
      if (u.startsWith("https://overpass.geofabrik.de/")) {
        state.log.push("geo");
        return r.abort();
      }
      if (u.includes("/api/interpreter")) {
        state.log.push("pub:" + new URL(u).host);
        return state.pub === "timeout"
          ? r.fulfill({
              headers: H,
              json: {
                elements: [],
                remark: 'runtime error: Query timed out in "query" at line 1 after 91 seconds.',
              },
            })
          : r.fulfill({ headers: H, json: { elements: els } });
      }
      if (u.includes("streetview/metadata"))
        return r.fulfill({
          headers: H,
          json: {
            status: "OK",
            pano_id: "PANO_0000000001",
            location: { lat: 35.8999, lng: 14.5 },
            copyright: "© Google",
            date: "2022-05",
          },
        });
      if (u.includes("taginfo"))
        return r.fulfill({ headers: H, json: { data: [{ type: "all", count: 100 }] } });
      return r.fulfill({ status: 204, body: "" });
    });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e)));
  p.on("console", m => {
    if (/Content Security|Refused/.test(m.text())) errs.push(m.text());
  });
  await route(p);
  const url = PAGE;
  const done = (q = p) =>
    q.waitForFunction(() => !running && !/Ready/.test(document.getElementById("now").textContent));
  const saved = () =>
    p.waitForFunction(() => document.getElementById("srvSave").textContent === "Test and use this server");
  // The server is set in the Settings dialog; searches run with the dialog closed, as for a visitor.
  const settings = async () => {
    if (await p.isHidden("#settings")) await p.click("#settingsBtn");
  };
  const run = async (q = p) => {
    state.log.length = 0;
    if (q === p && (await p.isVisible("#settings"))) await p.click("#settingsOk");
    await q.click("#go");
    await done(q);
    return state.log.filter(x => !x.includes("(test)"));
  };
  await p.goto(url);
  await p.fill("#apiKey", "KEY");
  await chooseKind(p, "Lighthouse");
  await p.check("input[name=scope][value=pick]");
  await p.check("#countries input[value=MT]");
  ok((await p.textContent("#settingsBtn")) === "Settings", 'no own server: the button just says "Settings"');
  await p.click("#settingsBtn");
  ok(
    (await p.isVisible("#settings")) &&
      (await p.evaluate(() => document.activeElement.id === "settingsBox")) &&
      (await p.isHidden("#expert .body #srvUrl")),
    "Settings opens a dialog with the server fields (no longer in the expert panel)",
  );
  await p.keyboard.press("Escape");
  ok(
    (await p.isHidden("#settings")) && (await p.evaluate(() => document.activeElement.id === "settingsBtn")),
    "Escape closes it and the focus goes back to the button",
  );
  await p.click("#settingsBtn");
  await p.mouse.click(5, 5);
  ok(await p.isHidden("#settings"), "a click outside the box closes it");
  await p.click("#settingsBtn");
  ok(
    (await p.isChecked("#srvRemember")) &&
      (await p.isChecked("input[name=srvMode][value=first]")) &&
      (await p.isHidden("#srvForget")) &&
      (await p.isHidden("#srvStatus")),
    "defaults: remember on, used for every search, nothing set",
  );
  for (const bad of [
    "",
    "tile.tracestrack.com/overpass/x/",
    "http://tile.tracestrack.com/overpass/x/",
    "javascript:alert(1)",
    "https://user:pw@host.example/x/",
  ]) {
    await p.fill("#srvUrl", bad);
    await p.click("#srvSave");
  }
  ok(
    /starting with https/.test(await p.textContent("#srvError")) && (await p.evaluate(() => osmOwn === null)),
    "addresses that are not plain https are refused",
  );
  // base address: the page finds the working ending
  state.log.length = 0;
  await settings();
  await p.fill("#srvUrl", BASE);
  await p.click("#srvSave");
  await p.waitForFunction(
    () => document.getElementById("srvSave").textContent === "Test and use this server",
  );
  ok(
    (await p.textContent("#settingsBtn")) === "Settings · own server in use",
    "with a server set, the Settings button says so",
  );
  await saved();
  console.log("  test requests:", state.log.join(" | ").replace(KEY, "KEY"));
  ok(
    (await p.inputValue("#srvUrl")) === BASE + "interpreter" &&
      (await p.evaluate(() => osmOwn.mode === "first")) &&
      (await p.isHidden("#srvError")),
    "base address tested and completed to …/interpreter",
  );
  const status = await p.innerText("#srvStatus");
  console.log("  status:", status.replace(/\n/g, " | "));
  ok(
    /In use: tile\.tracestrack\.com/.test(status) &&
      /every search/.test(status) &&
      /Remembered in this browser/.test(status) &&
      !status.includes(KEY),
    "status names the host only, never the key",
  );
  ok(
    await p.evaluate(
      k =>
        localStorage.getItem("lookout2.osmOwn").includes(k) &&
        sessionStorage.getItem("lookout2.osmOwn") === null,
      KEY,
    ),
    "remembered in this browser",
  );
  await settings();
  await p.evaluate(() => document.getElementById("srvUrl").scrollIntoView({ block: "center" }));
  await p.screenshot({ path: require("path").join(__dirname, "../dist/screens/v1.png") });
  // every search goes to the own server
  let log = await run();
  console.log("  standard:", log.join(" | ").replace(KEY, "KEY"));
  ok(
    log.length === 1 &&
      log[0].startsWith("own:") &&
      (await p.evaluate(() => results.length)) === 1 &&
      (await p.isHidden("#message")),
    "standard mode: own server asked, public servers not",
  );
  // own server refuses: public servers answer, with a note
  state.own = "denied";
  log = await run();
  console.log("  denied:", log.join(" | ").replace(KEY, "KEY"), "\n  note:", await p.textContent("#message"));
  ok(
    log[0].startsWith("own:") &&
      log.some(x => x.startsWith("pub:")) &&
      (await p.evaluate(() => results.length)) === 1 &&
      /Your own Overpass server could not be used.*HTTP 403.*public servers answered instead/.test(
        await p.textContent("#message"),
      ),
    "own server refused: falls back to public, says so",
  );
  // both fail: error names the cause without leaking the key
  state.pub = "timeout";
  await run();
  const card = await p.innerText("#fail");
  const det = await p.textContent("#failDetail");
  console.log("  error:", await p.textContent("#failTitle"), "|", det.replace(/\n/g, " ; ").slice(0, 200));
  ok(
    (await p.isVisible("#fail")) &&
      /your own server \(tile\.tracestrack\.com\): HTTP 403/.test(det) &&
      !card.includes(KEY) &&
      !det.includes(KEY) &&
      !(await p.textContent("#message")).includes(KEY),
    "error details show the host but not the key",
  );
  await p.click("#failClose");
  // fallback mode
  state.own = "ok";
  state.pub = "ok";
  await settings();
  await p.check("input[name=srvMode][value=fallback]");
  ok(
    /only when the public servers fail/.test(await p.textContent("#srvStatus")) &&
      (await p.evaluate(() => JSON.parse(localStorage.getItem("lookout2.osmOwn")).mode === "fallback")),
    "switching to fallback is saved at once",
  );
  log = await run();
  ok(
    log.length === 1 && log[0].startsWith("pub:") && (await p.isHidden("#message")),
    "fallback mode: public server answers, own server not asked",
  );
  state.pub = "timeout";
  log = await run();
  console.log(
    "  fallback:",
    log.join(" | ").replace(KEY, "KEY"),
    "\n  note:",
    await p.textContent("#message"),
  );
  ok(
    log[0].startsWith("pub:") &&
      log[log.length - 1].startsWith("own:") &&
      (await p.evaluate(() => results.length)) === 1 &&
      /public servers failed.*your own Overpass server answered instead/.test(
        await p.textContent("#message"),
      ),
    "fallback mode: public timeout, own server steps in, says so",
  );
  state.pub = "ok";
  // share link and query panel never contain the key
  await p.click("#share");
  const link = await p.evaluate(() => navigator.clipboard.readText());
  ok(
    !link.includes(KEY) && !link.includes("tracestrack") && !(await p.inputValue("#queryText")).includes(KEY),
    "shared link and query panel do not contain the server or key",
  );
  // reload: restored
  await p.reload();
  await p.waitForFunction(
    () => {
      try {
        return !!osmOwn && document.getElementById("srvUrl").value !== "";
      } catch {
        return false;
      }
    },
    null,
    { timeout: 10000 },
  );
  await settings();
  ok(
    (await p.evaluate(u => osmOwn && osmOwn.url === u && osmOwn.mode === "fallback", BASE + "interpreter")) &&
      (await p.isChecked("input[name=srvMode][value=fallback]")) &&
      (await p.inputValue("#srvUrl")) === BASE + "interpreter",
    "restored after a reload",
  );
  // remember off: this tab only
  await settings();
  await p.uncheck("#srvRemember");
  ok(
    (await p.evaluate(
      () => localStorage.getItem("lookout2.osmOwn") === null && !!sessionStorage.getItem("lookout2.osmOwn"),
    )) && /until you close this tab/.test(await p.textContent("#srvStatus")),
    "remember off: kept for this tab only",
  );
  const p2 = await ctx.newPage();
  await route(p2);
  await p2.goto(url);
  ok(await p2.evaluate(() => osmOwn === null), "not present in another tab when not remembered");
  await p2.close();
  // forget
  await settings();
  await p.check("#srvRemember");
  await p.click("#srvForget");
  ok(
    (await p.evaluate(
      () =>
        osmOwn === null &&
        localStorage.getItem("lookout2.osmOwn") === null &&
        sessionStorage.getItem("lookout2.osmOwn") === null,
    )) &&
      (await p.inputValue("#srvUrl")) === "" &&
      (await p.isHidden("#srvStatus")) &&
      (await p.isHidden("#srvForget")),
    "forget removes it everywhere",
  );
  // unreachable servers
  await settings();
  await p.fill("#srvUrl", "https://overpass.geofabrik.de/" + KEY + "/");
  await p.click("#srvSave");
  await saved();
  ok(
    /test request failed.*could not reach it/.test(await p.textContent("#srvError")) &&
      (await p.evaluate(() => osmOwn === null)),
    "unreachable base address is not saved: " + (await p.textContent("#srvError")).slice(0, 90),
  );
  await settings();
  await p.fill("#srvUrl", "https://overpass.geofabrik.de/" + KEY + "/api/interpreter");
  await p.click("#srvSave");
  await saved();
  ok(
    /saved, but the test request failed/.test(await p.textContent("#srvError")) &&
      (await p.evaluate(() => !!osmOwn)),
    "full address is saved with a warning when the test fails",
  );
  await settings();
  await p.check("input[name=srvMode][value=first]");
  await p.click("#settingsOk");
  await chooseKind(p, "Lighthouse");
  await p.fill("#apiKey", "KEY");
  log = await run();
  ok(
    log[0] === "geo" && log.some(x => x.startsWith("pub:")) && (await p.evaluate(() => results.length)) === 1,
    "unreachable own server: search still works through the public servers",
  );
  await settings();
  await p.click("#srvForget");
  ok(
    (await p.textContent("#settingsBtn")) === "Settings",
    "after forgetting, the button says Settings again",
  );
  ok(errs.length === 0, "no page errors or policy blocks " + errs.join("|"));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
