// Playwright with the first-visit welcome already dismissed, so the other suites test the page itself.
const pw = require('playwright');
const seen = () => { try { localStorage.setItem('lookout2.welcomed', 'true'); } catch {} };
const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (...a) => { const b = await launch(...a);
  const np = b.newPage.bind(b), nc = b.newContext.bind(b);
  b.newContext = async (...x) => { const c = await nc(...x); await c.addInitScript(seen); return c; };
  b.newPage = async (...x) => { const p = await np(...x); await p.context().addInitScript(seen); return p; };
  return b; };
module.exports = pw;
