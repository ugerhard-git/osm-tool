const fs = require('fs'), path = require('path'), crypto = require('crypto');
const pkg = name => path.dirname(require.resolve(name + '/package.json'));
const out = path.join(__dirname, '../dist');
fs.mkdirSync(out, { recursive: true });
const cat = require('./catalog.js');
let tpl = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
const put = (mark, text) => { if (!tpl.includes(mark)) throw new Error('placeholder missing: ' + mark); tpl = tpl.replace(mark, () => text); };

// The page is published as one file: the app's styles and code are written into it.
const src = name => fs.readFileSync(path.join(__dirname, name), 'utf8').replace(/\n$/, '');
const appCss = src('style.css'), appJs = src('app.js');
if (/<\/style/i.test(appCss)) throw new Error('style.css contains a closing style tag');
if (/<\/script/i.test(appJs)) throw new Error('app.js contains a closing script tag');
if (/\/\*(CATALOG|LEAFLET_JS|LEAFLET_CSS|FONT_CSS|CSP)\*\//.test(appCss + appJs)) throw new Error('a build placeholder appears in style.css or app.js');
put('/*APP_CSS*/', appCss);
put('/*APP_JS*/', appJs);

// Catalogue data
put('/*CATALOG*/', JSON.stringify(cat).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, ''));

// Leaflet 1.9.4, from the npm package (no CDN at runtime)
const leafletJs = fs.readFileSync(pkg('leaflet') + '/dist/leaflet.js', 'utf8').replace(/\/\/# sourceMappingURL=.*$/m, '');
if (/<\/script/i.test(leafletJs)) throw new Error('leaflet contains a closing script tag');
put('/*LEAFLET_JS*/', leafletJs);
// Drop rules that would fetch image files the page does not use.
const leafletCss = fs.readFileSync(pkg('leaflet') + '/dist/leaflet.css', 'utf8')
  .replace(/behavior:\s*url\([^)]*\);?/g, '')
  .replace(/background-image:\s*url\(images\/[^)]*\);?/g, '');
if (/url\(/.test(leafletCss)) throw new Error('leaflet css still references a url');
put('/*LEAFLET_CSS*/', leafletCss);

// Overpass typeface, embedded (no request to Google Fonts)
let fontCss = '';
for (const w of [400, 600, 800]) {
  const css = fs.readFileSync(`${pkg('@fontsource/overpass')}/${w}.css`, 'utf8');
  for (const block of css.match(/@font-face\s*\{[^}]*\}/g) || []) {
    const m = /url\(\.\/files\/(overpass-(latin|latin-ext)-\d+-normal\.woff2)\)/.exec(block);
    if (!m) continue;
    const range = /unicode-range:\s*([^;]+);/.exec(block);
    const data = fs.readFileSync(`${pkg('@fontsource/overpass')}/files/${m[1]}`).toString('base64');
    fontCss += `@font-face{font-family:"Overpass";font-style:normal;font-display:swap;font-weight:${w};src:url(data:font/woff2;base64,${data}) format("woff2");${range ? 'unicode-range:' + range[1] + ';' : ''}}\n`;
  }
}
if ((fontCss.match(/@font-face/g) || []).length !== 6) throw new Error('expected 6 font faces');
put('/*FONT_CSS*/', fontCss);

// Content Security Policy: only the inline scripts shipped in this file may run.
const hashes = [];
tpl.replace(/<script>([\s\S]*?)<\/script>/g, (all, body) => { hashes.push(`'sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}'`); return all; });
if (hashes.length !== 3) throw new Error('expected 3 inline scripts, found ' + hashes.length);
// Google's script for Street View. Only Google's own hosts: no wildcard over googleapis.com, whose
// subdomains include storage.googleapis.com, where anyone can host files. gstatic.com holds only Google's own files.
const google = 'https://maps.googleapis.com https://*.gstatic.com';
const csp = [
  "default-src 'none'",
  `script-src ${hashes.join(' ')} ${google}`,
  "style-src 'unsafe-inline'",
  "img-src https://tile.openstreetmap.org data:",
  "font-src data:",
  // Any https host: users may enter their own Overpass server. Scripts stay limited to the fingerprints above.
  "connect-src https:",
  "base-uri 'none'", "form-action 'none'", "object-src 'none'",
].join('; ');
put('/*CSP*/', csp);
if (/https:\/\/(cdnjs|fonts\.g)/.test(tpl)) throw new Error('third-party asset reference left in page');
// The site key comes from the environment (a GitHub secret when deploying), never from the repository.
const key = (process.env.GOOGLE_API_KEY || '').trim();
if (key && !/^[A-Za-z0-9_-]{20,80}$/.test(key)) throw new Error('GOOGLE_API_KEY does not look like a Google API key');
const withKey = tpl.replace(/("googleApiKey": )"[^"]*"/, (all, k) => k + JSON.stringify(key));
fs.writeFileSync(path.join(out, 'index.html'), withKey);
// Same page without a key, for the automated tests (they enter a key of their own).
const noKey = tpl.replace(/("googleApiKey": )"[^"]*"/, '$1""');
fs.writeFileSync(path.join(out, 'index.nokey.html'), noKey);
console.log('dist/index.html', (withKey.length / 1024).toFixed(0) + ' KB;', hashes.length, 'script fingerprints;', key ? 'site key included' : 'no site key (visitors enter their own)');
