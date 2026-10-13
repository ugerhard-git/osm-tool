// Builds the place catalogue from the OpenStreetMap iD editor presets.
const path = require("path");
const base =
  path.join(path.dirname(require.resolve("@openstreetmap/id-tagging-schema/package.json")), "dist") + "/";
const P = require(base + "presets.json");
const LANGS = ["en", "de", "fr", "es", "pt"];
const T = {};
for (const l of LANGS) {
  const j = require(base + "translations/" + l + ".json");
  T[l] = j[l].presets.presets;
}
const ptbr = require(base + "translations/pt-BR.json")["pt-BR"].presets.presets;
const list = a => (Array.isArray(a) ? a : typeof a === "string" ? a.split(/[,\n]/) : []);
function entry(l, k, depth = 0) {
  let t = T[l][k] || (l === "pt" ? ptbr[k] : null);
  if (!t || !t.name) return null;
  let name = t.name;
  const ref = /^\{(.+)\}$/.exec(name);
  if (ref) {
    if (depth > 3) return null;
    const r = entry(l, ref[1].replace(/^presets\//, ""), depth + 1);
    if (!r) return null;
    name = r.name;
  }
  const terms = [...list(t.aliases), ...list(t.terms)]
    .map(s => s.trim())
    .filter(s => s && !/^\{/.test(s) && s.toLowerCase() !== name.toLowerCase());
  return { name, terms: [...new Set(terms)] };
}
const seen = new Map();
const out = { t: [] };
for (const l of LANGS) out[l] = [];
let refs = 0;
for (const k of Object.keys(P)) {
  const p = P[k];
  if (p.searchable === false) continue;
  const tags = p.tags || {};
  const keys = Object.keys(tags);
  if (!keys.length) continue;
  if (!(p.geometry || []).some(g => g === "point" || g === "area" || g === "vertex")) continue;
  const en = entry("en", k);
  if (!en) continue;
  if (/^\{/.test(T.en[k].name)) refs++;
  const tag = keys.map(x => x + "=" + tags[x]).join(", ");
  if (/[\t\n]/.test(tag)) continue;
  if (seen.has(tag)) continue;
  seen.set(tag, out.t.length);
  out.t.push(tag);
  for (const l of LANGS) {
    const e = l === "en" ? en : entry(l, k);
    out[l].push(e ? [e.name, ...e.terms].join("\t") : "");
  }
}
module.exports = out;
if (require.main === module) {
  console.log("entries", out.t.length, "refs", refs, "bytes", JSON.stringify(out).length);
  for (const l of LANGS) console.log(l, out[l].filter(Boolean).length, JSON.stringify(out[l]).length);
  for (const q of [
    "man_made=lighthouse",
    "amenity=place_of_worship, religion=christian",
    "highway=stop",
    "man_made=bridge",
    "power=generator, generator:source=wind, generator:method=wind_turbine",
    "amenity=fuel",
  ]) {
    const i = out.t.indexOf(q);
    console.log(q, i, i < 0 ? "" : LANGS.map(l => out[l][i].split("\t")[0]).join(" | "));
  }
  console.log(out.t.filter(t => /wind|tower/.test(t)).join(" ;; "));
}
