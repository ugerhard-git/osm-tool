const { chromium } = require("./pw.js");
const { PAGE, isSite, serveSite } = require("./site.js");
const H = { "access-control-allow-origin": "*" };
const file = PAGE;
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const mk = async url => {
    const ctx = await b.newContext({ viewport: { width: 1360, height: 860 } });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    const p = await ctx.newPage();
    p.errs = [];
    p.reqs = [];
    p.on("pageerror", e => p.errs.push(String(e)));
    await p.route("**/*", r => {
      const u = r.request().url();
      if (isSite(u)) return serveSite(r);
      p.reqs.push(u);
      if (u.includes("taginfo"))
        return r.fulfill({ headers: H, json: { data: [{ type: "all", count: 100 }] } });
      return r.fulfill({ status: 204, body: "" });
    });
    await p.goto(url);
    return p;
  };
  const p = await mk(file);
  await p.click("#share");
  ok(/Choose a kind of place or enter a name/.test(await p.textContent("#message")), "nothing to share yet");
  await p.fill("#apiKey", "SECRETKEY_SHOULD_NOT_LEAK");
  await p.fill("#kind", "Castle");
  await p.keyboard.press("Enter");
  await p.fill("#nameHas", "neu, château & co");
  await p.check("input[name=scope][value=pick]");
  await p.check("#countries input[value=DE]");
  await p.check("#countries input[value=FR]");
  await p.check("#countries input[value=MG]");
  await p.fill("#maxDist", "80");
  await p.fill("#minDist", "10");
  await p.fill("#target", "42");
  await p.uncheck("#official");
  await p.fill("#mapName", "My castles");
  await p.click("#share");
  const url = await p.evaluate(() => navigator.clipboard.readText());
  console.log(url.replace(/^.*index\.html/, "…index.html"));
  ok(
    (await p.textContent("#share")) === "Link copied" && url === (await p.evaluate(() => location.href)),
    "copied and shown in address bar",
  );
  ok(!/SECRET|key=/i.test(url), "API key not in link");
  const p2 = await mk(url);
  await p2.waitForTimeout(300);
  const st = await p2.evaluate(() => ({
    kind: document.getElementById("kind").value,
    tag: kind && kind.tag,
    n: document.getElementById("nameHas").value,
    s: scope(),
    c: [...selected].sort().join(),
    d: document.getElementById("maxDist").value,
    m: document.getElementById("minDist").value,
    t: document.getElementById("target").value,
    o: document.getElementById("official").checked,
    gc: document.getElementById("tagCountry").checked,
    name: document.getElementById("mapName").value,
    key: document.getElementById("apiKey").value,
    running,
  }));
  console.log(JSON.stringify(st));
  ok(
    st.kind === "Castle" &&
      st.tag === "historic=castle" &&
      st.n === "neu, château & co" &&
      st.s === "pick" &&
      st.c === "DE,FR,MG" &&
      st.d === "80" &&
      st.m === "10" &&
      st.t === "42" &&
      st.o === false &&
      st.gc === true &&
      st.name === "My castles" &&
      st.key === "",
    "recipient sees the same settings",
  );
  ok(
    /come from a shared link/.test(await p2.textContent("#message")) &&
      !st.running &&
      p2.reqs.every(u => /taginfo|tile\.openstreetmap/.test(u)),
    "note shown; nothing runs until the recipient starts it",
  );
  ok(
    /"historic"="castle"\]\["name"~"neu\|château & co",i\]/.test(await p2.inputValue("#queryText")),
    "same query",
  );
  // hostile and broken links
  const X = encodeURIComponent('"><img src=x onerror=window.__xss=1>');
  const p3 = await mk(`${file}#k=${X}&n=${X}&s=${X}&c=DE-${X}-zz-FR&d=9e99&m=-5&t=abc&name=${X}&o=${X}`);
  await p3.waitForTimeout(300);
  const h = await p3.evaluate(() => ({
    xss: window.__xss,
    imgs: document.querySelectorAll('img[src="x"]').length,
    kind: kind && kind.tag,
    s: scope(),
    c: [...selected].join(),
    d: document.getElementById("maxDist").value,
    m: document.getElementById("minDist").value,
    t: document.getElementById("target").value,
  }));
  console.log(JSON.stringify(h));
  ok(
    h.xss === undefined &&
      h.imgs === 0 &&
      h.kind === null &&
      h.s === "pick" &&
      h.c === "DE,FR" &&
      h.d === "2000" &&
      h.m === "0" &&
      h.t === "1000",
    "hostile link values rejected or clamped",
  );
  const p4 = await mk(`${file}#k=amenity%3Dpub%7Cbar&d=3000&t=5`);
  await p4.waitForTimeout(300);
  ok(
    await p4.evaluate(
      () =>
        kind.tag === "amenity=pub|bar" &&
        document.getElementById("maxDist").value === "2000" &&
        document.getElementById("target").value === "5" &&
        scope() === "pick",
    ),
    "raw tag link, distance clamped",
  );
  await p4.evaluate(() => {
    location.hash = "k=man_made%3Dwindmill&s=world";
  });
  await p4.waitForTimeout(300);
  ok(
    await p4.evaluate(
      () =>
        kind.tag === "man_made=windmill" &&
        scope() === "world" &&
        document.getElementById("kind").value === "Windmill",
    ),
    "pasting another link into the open page applies it",
  );
  const p5 = await mk(`${file}#top`);
  ok(await p5.isHidden("#message"), "ordinary # anchors are ignored");
  ok(
    [p, p2, p3, p4, p5].every(x => x.errs.length === 0),
    "no page errors",
  );
  await p2.evaluate(() => document.querySelector(".panel").scrollTo(0, 99999));
  await p2.screenshot({ path: require("path").join(__dirname, "../dist/screens/i1.png") });
  await b.close();
  console.log(fail ? fail + " FAILED" : "ALL PASS");
})();
