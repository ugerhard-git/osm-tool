// The page icon: present in all three forms, drawable by the browser, and allowed by the security policy.
const { chromium } = require("./pw.js");
const { PAGE, isSite, serveSite } = require("./site.js");
const fs = require("fs");
const path = require("path");
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  const p = await b.newPage();
  const blocked = [];
  p.on("console", m => {
    if (/Content Security Policy/i.test(m.text())) blocked.push(m.text());
  });
  await p.route("**/*", r =>
    isSite(r.request().url()) ? serveSite(r) : r.fulfill({ status: 204, body: "" }),
  );
  await p.goto(PAGE);
  const icons = await p.$$eval("link[rel=icon], link[rel=apple-touch-icon]", ls =>
    ls.map(l => ({ rel: l.rel, type: l.type, sizes: l.getAttribute("sizes"), href: l.href })),
  );
  ok(
    icons.length === 3 && icons.every(i => i.href.startsWith("data:image/")),
    "three icons, all built into the page: " + icons.map(i => i.rel + " " + (i.type || "")).join(", "),
  );
  // Draw each one, as the browser would for a tab or home screen.
  const drawn = await p.evaluate(
    hrefs =>
      Promise.all(
        hrefs.map(
          h =>
            new Promise(res => {
              const img = new Image();
              img.onload = () => res(img.naturalWidth + "x" + img.naturalHeight);
              img.onerror = () => res("broken");
              img.src = h;
            }),
        ),
      ),
    icons.map(i => i.href),
  );
  ok(
    drawn[0] === "32x32" && drawn[1] !== "broken" && drawn[2] === "180x180",
    "icons draw: " + drawn.join(", "),
  );
  const svg = Buffer.from(icons[1].href.split(",")[1], "base64").toString("utf8");
  ok(
    svg === fs.readFileSync(path.resolve(__dirname, "../src/icon.svg"), "utf8"),
    "the SVG icon is src/icon.svg",
  );
  ok(blocked.length === 0, "the security policy does not block the icons " + blocked.join(" | "));
  await b.close();
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
