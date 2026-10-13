const { chromium } = require("./pw.js");
const { PAGE, isSite, serveSite } = require("./site.js");
const path = require("path");
const H = { "access-control-allow-origin": "*" };
const cases = {
  timeout: r =>
    r.fulfill({
      headers: H,
      json: {
        elements: [],
        remark: 'runtime error: Query timed out in "query" at line 1 after 181 seconds.',
      },
    }),
  memory: r =>
    r.fulfill({
      headers: H,
      json: {
        elements: [],
        remark:
          'runtime error: Query ran out of memory in "query" at line 1. It would need at least 2048 MB of RAM to continue.',
      },
    }),
  rate: r => r.fulfill({ status: 429, headers: H, body: "Too Many Requests" }),
  busy: r => r.fulfill({ status: 504, headers: H, body: "<html>Gateway Timeout</html>" }),
  network: r => r.abort(),
  syntax: r =>
    r.fulfill({
      status: 400,
      headers: H,
      contentType: "text/html",
      body: '<html><body><p><strong style="color:#FF0000">Error</strong>: line 1: parse error: Unknown type "foreach" </p></body></html>',
    }),
  format: r => r.fulfill({ headers: H, contentType: "text/html", body: "<html>maintenance</html>" }),
  server: r =>
    r.fulfill({
      headers: H,
      json: { elements: [], remark: "runtime error: open64: 2 No such file or directory /osm3s_osm_base" },
    }),
  empty: r => r.fulfill({ headers: H, json: { elements: [] } }),
  denied: r =>
    r.fulfill({
      headers: H,
      json: { elements: [{ type: "node", id: 1, lat: 35.9, lon: 14.5, tags: { name: "A" } }] },
    }),
  flaky: r =>
    r.fulfill({
      headers: H,
      json: {
        elements: [
          { type: "node", id: 1, lat: 35.9, lon: 14.5, tags: { name: "A" } },
          { type: "node", id: 2, lat: 35.91, lon: 14.51, tags: { name: "B" } },
        ],
      },
    }),
};
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  for (const [name, handler] of Object.entries(cases)) {
    const p = await b.newPage({ viewport: { width: 1360, height: 860 } });
    const errs = [];
    let osm = 0;
    p.on("pageerror", e => errs.push(String(e)));
    await p.addInitScript(() => {
      const st = window.setTimeout;
      window.setTimeout = (f, ms, ...a) => st(f, ms > 1000 && ms < 100000 ? 30 : ms, ...a);
    });
    await p.route("**/*", r => {
      const u = r.request().url();
      if (isSite(u)) return serveSite(r);
      if (u.includes("/api/interpreter")) {
        osm++;
        return handler(r);
      }
      if (u.includes("streetview/metadata"))
        return r.fulfill({
          headers: H,
          json:
            name === "denied"
              ? { status: "REQUEST_DENIED", error_message: "The provided API key is invalid." }
              : name === "flaky" && u.includes("35.91")
                ? { status: "UNKNOWN_ERROR" }
                : {
                    status: "OK",
                    pano_id: "GOODPANOID_0001",
                    location: { lat: 35.8999, lng: 14.5 },
                    copyright: "© Google",
                    date: "2021-06",
                  },
        });
      if (u.includes("taginfo"))
        return r.fulfill({ headers: H, json: { data: [{ type: "all", count: 100 }] } });
      return r.fulfill({ status: 204, body: "" });
    });
    await p.goto(PAGE);
    await p.fill("#apiKey", "KEY");
    await p.check("input[name=scope][value=cov]");
    await p.fill("#kind", "Lighthouse");
    await p.keyboard.press("Enter");
    await p.click("#go");
    await p.waitForFunction(
      () => !running && !/Ready/.test(document.getElementById("now").textContent),
      null,
      { timeout: 60000 },
    );
    const o = {
      card: await p.isVisible("#fail"),
      title: await p.textContent("#failTitle"),
      text: await p.textContent("#failText"),
      detail: await p.textContent("#failDetail"),
      now: await p.textContent("#now"),
      panel: (await p.isVisible("#message")) ? await p.textContent("#message") : "",
      empty: await p.isVisible("#empty"),
    };
    console.log(
      `\n[${name}] requests to OSM: ${osm}\n  title : ${o.title}\n  text  : ${o.text}\n  detail: ${o.detail.replace(/\n/g, " | ")}\n  status: ${o.now}\n  panel : ${o.panel.slice(0, 110)}`,
    );
    const expectCard = name !== "flaky";
    const good =
      o.card === expectCard &&
      (!expectCard || !o.empty) &&
      errs.length === 0 &&
      (!expectCard || (o.title && o.text && o.panel.startsWith(o.title)));
    if (!good) {
      fail++;
      console.log("  FAIL", JSON.stringify({ card: o.card, empty: o.empty, errs }));
    }
    if (name === "timeout") {
      await p.screenshot({ path: require("path").join(__dirname, "../dist/screens/g1.png") });
      await p.click("#failMore summary");
      await p.screenshot({ path: require("path").join(__dirname, "../dist/screens/g2.png") });
      await p.click("#failClose");
      if (!(await p.isHidden("#fail")) || !(await p.isVisible("#empty"))) {
        fail++;
        console.log("  FAIL close");
      }
    }
    await p.close();
  }
  await b.close();
  console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
})();
