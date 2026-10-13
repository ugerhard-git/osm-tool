const { chromium } = require("playwright");
const { PAGE, isSite, serveSite } = require("./site.js");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const file = PAGE;
  const st = p =>
    p.evaluate(() => ({
      kind: document.getElementById("kind").value,
      scope: scope(),
      c: [...selected].sort().join(),
      d: document.getElementById("maxDist").value,
      t: document.getElementById("target").value,
    }));
  const want = s =>
    s.kind === "Lighthouse" && s.scope === "pick" && s.c === "DK,IS" && s.d === "50" && s.t === "1000";
  const open = async (url, before) => {
    const ctx = await b.newContext();
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    const p = await ctx.newPage();
    p.errs = [];
    p.on("pageerror", e => p.errs.push(String(e)));
    await p.route("**/*", r =>
      isSite(r.request().url()) ? serveSite(r) : r.fulfill({ status: 204, body: "" }),
    );
    if (before) await before(p);
    await p.goto(url);
    await p.waitForTimeout(400);
    return p;
  };
  // the user's link, first visit, query form, with a host's "i=1" added by its visitor check
  let p = await open(file + "?k=man_made%3Dlighthouse&s=pick&c=DK-IS&d=50&t=1000&i=1");
  ok(
    (await p.isVisible("#welcome")) && want(await st(p)),
    "query link applied on a first visit (host parameter ignored): " + JSON.stringify(await st(p)),
  );
  await p.click("#welcomeOk");
  ok(
    want(await st(p)) && /shared link/.test(await p.textContent("#message")),
    "still applied after closing the welcome",
  );
  // links made before the kind and name tag options were removed still open
  p = await open(file + "?k=man_made%3Dlighthouse&s=pick&c=DK-IS&d=50&t=1000&g=1&gn=1");
  ok(
    want(await st(p)) && !p.errs.length && !(await p.$("#tags")) && !(await p.$("#tagName")),
    "older links with the removed tag options still work: " + p.errs.join(" | "),
  );
  // old-style link after "#"
  p = await open(file + "#k=man_made%3Dlighthouse&s=pick&c=DK-IS&d=50&t=1000");
  ok(want(await st(p)), 'older "#" links still work');
  // simulate the host check: first request lands on a page that redirects by script, keeping only the query
  p = await open(file + "?k=man_made%3Dlighthouse&s=pick&c=DK-IS&d=50&t=1000#k=historic%3Dcastle");
  ok((await st(p)).kind === "Castle", 'if both are present, the "#" part wins (newer edit by hand)');
  // copying a link now produces the query form
  await p.click("#welcomeOk");
  await p.click("#share");
  const url = await p.evaluate(() => navigator.clipboard.readText());
  console.log("  copied:", url.replace(/^.*index\.nokey\.html/, "…/"));
  ok(
    /index\.nokey\.html\?k=historic%3Dcastle&s=pick/.test(url) && !url.includes("#"),
    "copied links use the query form",
  );
  const p2 = await open(url);
  ok(
    (await st(p2)).kind === "Castle" && (await st(p2)).c === (await st(p)).c,
    "copied link opens with the same settings",
  );
  ok(
    [p, p2].every(x => x.errs.length === 0),
    "no page errors",
  );
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
})();
