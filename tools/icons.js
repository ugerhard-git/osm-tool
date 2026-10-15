// Renders the PNG versions of src/icon.svg, for browsers and devices that do not use SVG icons:
//   src/icon-32.png   tab icon for older Safari
//   src/icon-180.png  "Add to Home Screen" on iPhone and iPad (square: the device rounds the corners)
// Run `npm run icons` after changing src/icon.svg, and commit the PNG files. The build only reads them.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "../src");
const svg = fs.readFileSync(path.join(src, "icon.svg"), "utf8");
const square = svg.replace(/ rx="[\d.]+"/, "");

(async () => {
  const browser = await chromium.launch();
  for (const [file, size, art] of [
    ["icon-32.png", 32, svg],
    ["icon-180.png", 180, square],
  ]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const url = "data:image/svg+xml;base64," + Buffer.from(art).toString("base64");
    await page.setContent(
      `<body style="margin:0;background:transparent"><img src="${url}" width="${size}" height="${size}"></body>`,
    );
    await page.screenshot({ path: path.join(src, file), omitBackground: true });
    await page.close();
    console.log("src/" + file);
  }
  await browser.close();
})();
