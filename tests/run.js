// Runs every test file in this folder one after another and reports which passed.
// Each file prints "PASS …" / "FAIL …" lines and ends with "ALL PASS" when everything held.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');

const dist = path.join(__dirname, '../dist');
if (!fs.existsSync(path.join(dist, 'index.nokey.html'))) {
  console.error('dist/index.nokey.html is missing. Run "npm run build" first.');
  process.exit(1);
}
fs.mkdirSync(path.join(dist, 'screens'), { recursive: true });

const only = process.argv.slice(2);
const files = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.js') && !['run.js', 'pw.js'].includes(f))
  .filter(f => !only.length || only.some(o => f.startsWith(o)))
  .sort();

let failed = 0;
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 15 * 60 * 1000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0 && /ALL PASS/.test(out) && !/^\s*FAIL\b/m.test(out);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f} (${Math.round((Date.now() - t0) / 1000)} s)`);
  if (!ok) { failed++; console.log(out.split('\n').filter(l => /FAIL|Error|at .*\.js:\d+/.test(l)).slice(0, 25).map(l => '     ' + l).join('\n')); }
}
console.log(failed ? `\n${failed} of ${files.length} test files failed.` : `\nAll ${files.length} test files passed.`);
process.exit(failed ? 1 : 0);
