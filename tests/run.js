// Runs every test file in this folder one after another and reports which passed.
// Each file prints "PASS …" / "FAIL …" lines and ends with "ALL PASS" when everything held.
const { spawnSync } = require("child_process");
const fs = require("fs"),
  path = require("path");

const dist = path.join(__dirname, "../dist");
if (!fs.existsSync(path.join(dist, "index.nokey.html"))) {
  console.error('dist/index.nokey.html is missing. Run "npm run build" first.');
  process.exit(1);
}
fs.mkdirSync(path.join(dist, "screens"), { recursive: true });

const only = process.argv.slice(2);
const files = fs
  .readdirSync(__dirname)
  .filter(f => f.endsWith(".js") && !["run.js", "pw.js", "site.js", "helpers.js"].includes(f))
  .filter(f => !only.length || only.some(o => f.startsWith(o)))
  .sort();

// On GitHub, also report each failing file as a note on the run, so it can be read without the full log.
const esc = t => t.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
function annotate(file, lines) {
  if (!process.env.GITHUB_ACTIONS) return;
  const text = lines
    .map(l => l.trim())
    .join("\n")
    .slice(0, 3000);
  console.log(
    `::error title=${esc("Test failed in " + file).replace(/[:,]/g, " ")}::${esc(text || "no output")}`,
  );
}

let failed = 0;
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], {
    encoding: "utf8",
    timeout: 15 * 60 * 1000,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const ok = r.status === 0 && /ALL PASS/.test(out) && !/^\s*FAIL\b/m.test(out);
  console.log(`${ok ? "ok  " : "FAIL"} ${f} (${Math.round((Date.now() - t0) / 1000)} s)`);
  if (!ok) {
    failed++;
    let why = out
      .split("\n")
      .filter(l => /FAIL|Error|at .*\.js:\d+/.test(l))
      .slice(0, 25);
    if (!why.length) why = out.trim().split("\n").slice(-10); // no FAIL line: show how the output ended
    if (r.error) why.unshift(String(r.error));
    console.log(why.map(l => "     " + l).join("\n"));
    annotate(f, why);
  }
}
console.log(
  failed ? `\n${failed} of ${files.length} test files failed.` : `\nAll ${files.length} test files passed.`,
);
process.exit(failed ? 1 : 0);
