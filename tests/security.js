// Security checks that are not tied to one feature: framing, the content security policy,
// and stored values that have been tampered with.
const { chromium } = require("./pw.js");
const { SITE, PAGE, isSite, serveSite } = require("./site.js");
const path = require("path");
const fs = require("fs");
const page = path.resolve(__dirname, "../dist/index.nokey.html");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const html = fs.readFileSync(page, "utf8");
  const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)[1];
  const script = /script-src ([^;]*)/.exec(csp)[1];
  ok(
    !/unsafe-inline|unsafe-eval|\*\.googleapis\.com|https:(\s|$)|\*(\s|$)/.test(script),
    "scripts: only fingerprinted inline code and Google's own script hosts: " +
      script.replace(/'sha256-[^']*'/g, "sha"),
  );
  ok(
    /default-src 'none'/.test(csp) &&
      /object-src 'none'/.test(csp) &&
      /base-uri 'none'/.test(csp) &&
      /form-action 'none'/.test(csp),
    "default, plugins, base address and form targets locked down",
  );
  ok(
    !/https?:\/\/(cdnjs|unpkg|cdn\.jsdelivr|fonts\.googleapis)/.test(html),
    "no libraries or fonts from CDNs",
  );
  ok(
    !/\/\*(APP_CSS|APP_JS|CATALOG|LEAFLET_JS|COUNTRY_CODER_JS|LEAFLET_CSS|FONT_CSS|CSP|ICON_SVG|ICON_PNG|ICON_TOUCH)\*\//.test(
      html,
    ),
    "every build placeholder filled in",
  );
  ok(
    !/<script[^>]+src=|<link[^>]+stylesheet/i.test(html) &&
      html.includes(fs.readFileSync(path.resolve(__dirname, "../src/app.js"), "utf8").trim()) &&
      html.includes(fs.readFileSync(path.resolve(__dirname, "../src/style.css"), "utf8").trim()),
    "one self-contained file with the app code and styles inside",
  );
  ok(
    /window\.countryCoder|globalThis\.countryCoder/.test(html) && !/sourceMappingURL/.test(html),
    "country lookup library built into the page, without links to outside files",
  );
  ok(!/AIza[0-9A-Za-z_-]{35}/.test(html.replace("AIza…", "")), "no Google key in the key-less build");

  // framed by another page: the app does not run, a link opens it on its own
  const outer = path.resolve(__dirname, "../dist/frame-test.html");
  fs.writeFileSync(
    outer,
    `<!doctype html><title>outer</title><iframe id="f" src="index.nokey.html?k=man_made%3Dlighthouse" style="width:900px;height:600px"></iframe>`,
  );
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e)));
  await p.route("**/*", r =>
    isSite(r.request().url()) ? serveSite(r) : r.fulfill({ status: 204, body: "" }),
  );
  await p.goto(SITE + "frame-test.html");
  await p.waitForTimeout(800);
  const f = p.frames().find(x => x.url().includes("index.nokey.html"));
  const st = await f.evaluate(() => ({
    app: !document.querySelector(".app").hidden,
    framed: !document.getElementById("framed").hidden,
    welcome: !document.getElementById("welcome").hidden,
    link: document.getElementById("framedLink").getAttribute("href"),
    target: document.getElementById("framedLink").target,
  }));
  ok(
    !st.app &&
      st.framed &&
      !st.welcome &&
      st.target === "_top" &&
      /index\.nokey\.html\?k=man_made/.test(st.link),
    "inside a frame: app hidden, link to open it on its own: " + JSON.stringify(st),
  );
  await p.goto(PAGE);
  ok((await p.isVisible(".app")) && (await p.isHidden("#framed")), "opened directly: app shown");

  // tampered stored values do not break the page
  await p.evaluate(() => {
    localStorage.setItem("lookout2.lang", JSON.stringify("__proto__"));
    localStorage.setItem("lookout2.tagKind", "true");
    localStorage.setItem("lookout2.scope", JSON.stringify("cov"));
    localStorage.setItem("lookout2.tagName", "true");
    localStorage.setItem(
      "lookout2.osmOwn",
      JSON.stringify({ url: "https://example.org/k/interpreter#frag", mode: "first" }),
    );
    localStorage.setItem("lookout2.countries", JSON.stringify(["DE", "<b>", "__proto__"]));
    localStorage.setItem(
      "lookout2.kind",
      JSON.stringify({ label: "<img src=x onerror=window.__x=1>", tag: 'a"]; out; ("' }),
    );
  });
  await p.reload();
  await p.waitForTimeout(500);
  const t = await p.evaluate(() => ({
    lang,
    srv: osmOwn && osmOwn.url,
    c: [...selected].join(),
    x: window.__x,
    img: document.querySelectorAll('img[src="x"]').length,
    q: document.getElementById("queryText").value,
    old: ["tagKind", "tagName"].filter(k => localStorage.getItem("lookout2." + k) !== null).join(),
    scope: scope(),
  }));
  console.log("  ", JSON.stringify(t).slice(0, 220));
  ok(
    t.lang === "en" &&
      t.srv === "https://example.org/k/interpreter" &&
      t.c === "DE" &&
      t.x === undefined &&
      t.img === 0,
    "tampered language, server, countries and kind are cleaned or refused",
  );
  ok(
    t.scope === "world",
    'a saved "Countries with Street View" choice comes back as "Whole world": ' + t.scope,
  );
  ok(t.old === "", "settings of the removed tag options are cleared: " + t.old);
  await p.fill("#kind", "light");
  await p.waitForTimeout(200);
  ok((await p.$$("#suggest li")).length > 0, "suggestions still work after a bad stored language");
  ok(errs.length === 0, "no page errors " + errs.join(" | "));
  fs.unlinkSync(outer);
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
