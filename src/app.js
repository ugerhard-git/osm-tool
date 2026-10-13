"use strict";
/*
 * Lookout: the app code.
 *
 * Lookout finds Google Street View spots near OpenStreetMap places of one kind (lighthouses, castles, …)
 * and exports them as a map-making.app map, each camera turned towards its place. Everything runs in the
 * visitor's browser; there is no server of our own. The build (src/build.js) puts this file, the styles
 * and the markup into one page.
 *
 * HOW A SEARCH RUNS (see startSearch)
 *   1. Step 1 sets `kind` (a tag such as historic=castle) and/or words the name must contain.
 *      Step 2 sets where: chosen countries, all Street View countries, or the whole world.
 *   2. buildQuery() writes the Overpass query. fetchPlaces() sends it in parts of a few countries
 *      (makeParts, halve) through overpass(), which tries the public servers and the user's own server.
 *      mergeElements() turns the answers into Place objects.
 *      Instead of steps 1 and 2, the user can load their own Overpass result (parseOwn), or check the
 *      places of the previous search again with other settings (lastFetch).
 *   3. The places are shuffled, then lookup() asks Google for the nearest panorama of each one.
 *      officialNearby() looks again when the nearest panorama is a photo uploaded by someone else, and
 *      roadInfo() checks for a street name when that tag is wanted.
 *   4. Each accepted panorama becomes a Location: drawn on the map (drawLocation), listed by name
 *      (renderNames) and exported (exportJson). paint() keeps the counters and messages up to date.
 *
 * MAIN SHARED STATE
 *   kind         the kind of place from step 1: { label, tag, raw?, count? }, or null
 *   selected     Set of the country codes ticked in step 2
 *   ownResult    the user's own Overpass result once loaded (see parseOwn), else null
 *   osmOwn       the user's own Overpass server: { url, mode: "first" | "fallback" }, or null
 *   results      the Locations found so far; `removed` holds the ones the user took out, for undo
 *   searchStats  counters for the current search (see emptyStats)
 *   lastFetch    the places of the last OpenStreetMap search, kept for "check again"
 *   running      true while a search runs; abort.abort() stops it
 *
 * SAVED IN THE BROWSER (localStorage, each name starts with "lookout2.", see `store`)
 *   kind, nameHas, lang, countries, scope, maxDist, minDist, target, official, tagKind, tagCountry,
 *   tagName, tagRoad, expert (whether that panel is open) and welcomed (first-visit dialog seen).
 *   The own server is "lookout2.osmOwn" in localStorage or, if not remembered, sessionStorage.
 *   A visitor's own Google key is only kept in sessionStorage ("lookout2.key"), never on disk.
 *   Saved values and shared links can be edited by anyone, so everything read back is checked first.
 *
 * GROUND RULES
 *   - The page's security policy only runs scripts it knows, so events are wired up here in code;
 *     onclick="…" in the HTML would not run.
 *   - Text from outside (OpenStreetMap, taginfo, Google, links, saved values) is put on the page with
 *     textContent, or passed through esc() before it goes into innerHTML.
 *   - The sections below follow the page from top to bottom: data, helpers, step 1, step 2, own server,
 *     own result, shared links, map, list of names, OpenStreetMap, Street View, the search, export,
 *     first-visit dialog. src/page.html and src/style.css use the same section names.
 */

/**
 * A place from OpenStreetMap that a location should look at.
 * @typedef {object} Place
 * @property {number} id         OpenStreetMap id (unique together with type)
 * @property {"node"|"way"|"relation"} type
 * @property {number} lat
 * @property {number} lng        for ways and relations: the centre OpenStreetMap gives
 * @property {string} [cc]       two-letter country code, if known
 * @property {string} name       English name if there is one, else the local name, else ""
 * @property {object} [dot]      its faint candidate dot on the map (Leaflet layer)
 * @property {{why: string, panoId?: string, heading: number}} [miss]  why it was left out
 */
/**
 * A Street View spot that made it into the results.
 * @typedef {object} Location
 * @property {number} lat
 * @property {number} lng
 * @property {number} heading    compass direction from the camera to the place, 0–360
 * @property {string} panoId     Google's panorama id
 * @property {string} date       photo date "YYYY-MM" or "YYYY", or ""
 * @property {number} dist       metres from the camera to the place
 * @property {Place} poi         the place it looks at
 * @property {string[]} tags     tags for the export
 * @property {"has"|"none"|"unknown"} [road]  whether a street name is shown, if checked
 * @property {string} [roadName]
 * @property {object[]} [layers] its line, place dot and marker on the map
 */
/**
 * Google's answer for one lookup, cleaned by cleanPano().
 * @typedef {object} PanoAnswer
 * @property {string} status     "OK", "ZERO_RESULTS", "REQUEST_DENIED", "NETWORK", "MALFORMED", …
 * @property {number} [lat]
 * @property {number} [lng]
 * @property {string} [panoId]
 * @property {string} [copyright] "© Google" for official coverage, else the uploader's name
 * @property {string} [date]
 * @property {string} [detail]   Google's error message, if any
 */

/* ---------- data ---------- */
const LANGS = { en: "English", de: "Deutsch", fr: "Français", es: "Español", pt: "Português" };
const EXAMPLES = [
  "tourism=viewpoint",
  "amenity=pub|bar",
  "historic=castle, ruins=yes",
  "amenity=fast_food, brand=KFC",
];
/* Countries and territories with official Street View along roads. Edit this list to change the default search area. */
const DEFAULT_COVERAGE =
  "AD AE AL AR AS AT AU AX BA BD BE BG BM BO BR BT BW CA CC CH CL CO CR CW CX CY CZ DE DK DO EC EE ES FI FO FR GB GE GH GI GL GR GT GU HK HR HU ID IE IL IM IN IS IT JE JO JP KE KG KH KR KZ LA LI LK LS LT LU LV MC ME MK MN MO MP MT MX MY NA NG NL NO NP NZ OM PA PE PH PL PR PS PT PY QA RE RO RS RU RW SE SG SI SK SM SN ST SZ TH TN TR TW UA UG US UY VI VN XK ZA";
const CONFIG = (() => {
  try {
    const c = JSON.parse(document.getElementById("lookout-config").textContent);
    return c && typeof c === "object" ? c : {};
  } catch {
    console.warn("Lookout: the settings block is not valid JSON, using defaults.");
    return {};
  }
})();
const GOOGLE_API_KEY =
  typeof CONFIG.googleApiKey === "string" && /^[A-Za-z0-9_-]{20,80}$/.test(CONFIG.googleApiKey.trim())
    ? CONFIG.googleApiKey.trim()
    : "";
const COVERAGE = new Set(
  String(typeof CONFIG.streetViewCountries === "string" ? CONFIG.streetViewCountries : DEFAULT_COVERAGE)
    .split(/[\s,]+/)
    .filter(c => /^[A-Z]{2}$/.test(c)),
);
if (!COVERAGE.size) DEFAULT_COVERAGE.split(" ").forEach(c => COVERAGE.add(c));
const CODES = (
  "AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS " +
  "MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS " +
  "RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
  "UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW"
).split(" ");
/* Countries whose OpenStreetMap area also contains other listed territories (France contains Réunion,
   for example). A place found in both keeps the more specific territory; see mergeElements. */
const PARENTS = new Set(["FR", "NL", "DK", "GB", "US", "AU", "NO", "FI", "CN", "NZ"]);
/* Public Overpass servers. Searches start at a different one each time and move on when one fails. */
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const TAGINFO = "https://taginfo.openstreetmap.org/api/4/";
const PARALLEL = 12; // Street View lookups running at the same time
const WORLD_TIMEOUT = 180; // seconds the OpenStreetMap server may spend on a whole-world search
const PART_TIMEOUT = 90; // seconds it may spend on one part of a country search
const PART_WEIGHT = 15; // how much goes into one part; see COUNTRY_WEIGHT
const OSM_PARALLEL = 2; // parts requested at the same time
const RATE_WAIT = 20000; // ms to pause when the servers ask to slow down
/* Rough cost of searching a country (size and amount of map data). Unlisted countries count 1. */
// prettier-ignore
const COUNTRY_WEIGHT = {
  US: 8, RU: 8, CA: 8, BR: 8, AU: 8, CN: 8,
  DE: 5, FR: 5, IN: 5, JP: 5,
  GB: 3, IT: 3, ES: 3, PL: 3, MX: 3, AR: 3, ID: 3, KZ: 3,
  SE: 2, NO: 2, FI: 2, UA: 2, TR: 2, ZA: 2, NL: 2, CZ: 2, AT: 2, CH: 2, BE: 2, RO: 2,
  PE: 2, CO: 2, CL: 2, TH: 2, PH: 2, MY: 2, NZ: 2, GR: 2, PT: 2, HU: 2, MN: 2, NG: 2,
  KE: 2, BO: 2, BW: 2, NA: 2, DZ: 2, SA: 2, IR: 2, EG: 2,
};
const countryWeight = c => COUNTRY_WEIGHT[c] || 1;
/* Total weight of a list of country codes. */
const weightOf = codes => codes.reduce((n, c) => n + countryWeight(c), 0);
const TOO_MANY = 150000; // above this many places worldwide, the user must choose countries
const MIN_USES = 3; // live tag suggestions used fewer times than this are hidden
const MAX_DOTS = 4000; // faint candidate dots drawn on the map

/* ---------- helpers ---------- */
/* The page element with this id. */
const $ = id => document.getElementById(id);
/* A number with thousands separators: 12345 -> "12,345". */
const fmt = n => n.toLocaleString("en");
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* Settings saved in this browser, under "lookout2.<name>". get() returns the default d when nothing
   is saved or storage is blocked (private windows); set() quietly does nothing then. */
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem("lookout2." + k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem("lookout2." + k, JSON.stringify(v));
    } catch {}
  },
};
/* A visitor's own API key is kept for this browser tab only, never written to disk. */
const keyStore = {
  get() {
    try {
      return sessionStorage.getItem("lookout2.key") || "";
    } catch {
      return "";
    }
  },
  set(v) {
    try {
      sessionStorage.setItem("lookout2.key", v);
    } catch {}
  },
};
// Older versions kept the key on disk; remove it.
try {
  localStorage.removeItem("lookout2.key");
  localStorage.removeItem("lookout.key");
} catch {}
let regionNames;
try {
  regionNames = new Intl.DisplayNames(["en"], { type: "region" });
} catch {}
/* English name of a country code, or the code itself when the browser does not know it. */
const countryName = c => {
  try {
    const n = regionNames && regionNames.of(c);
    return n && n !== c ? n : c;
  } catch {
    return c;
  }
};
for (const c of [...COVERAGE]) if (!CODES.includes(c)) COVERAGE.delete(c);
const COUNTRIES = CODES.map(c => ({ code: c, name: countryName(c) })).sort((a, b) =>
  a.name.localeCompare(b.name),
);
const toRadians = d => (d * Math.PI) / 180;
/* Distance in metres between two points on the earth (haversine formula, mean earth radius). */
function distance(aLat, aLng, bLat, bLng) {
  const dLat = toRadians(bLat - aLat),
    dLng = toRadians(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/* Compass direction from point a to point b, in degrees: 0 north, 90 east. Used as the camera heading. */
function bearing(aLat, aLng, bLat, bLng) {
  const y = Math.sin(toRadians(bLng - aLng)) * Math.cos(toRadians(bLat));
  const x =
    Math.cos(toRadians(aLat)) * Math.sin(toRadians(bLat)) -
    Math.sin(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.cos(toRadians(bLng - aLng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
/* Puts an array in random order, in place (Fisher–Yates). */
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/* Makes text safe to put inside HTML: & < > " ' ` become entities. */
const esc = s =>
  String(s).replace(
    /[&<>"'`]/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" })[c],
  );
/* A string from outside, cut to max characters; anything that is not a string becomes "". */
const cleanText = (v, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
/* True for a real number between lo and hi. */
const inRange = (n, lo, hi) => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
/* Lower case without accents, for matching: "Château" -> "chateau". */
const foldAccents = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/* "key=value, key2=a|b, key3=*" -> list of {key, values|null}. Throws a readable message. */
function parseTags(text) {
  const parts = text
    .split(/[,\n]/)
    .map(s => s.trim())
    .filter(Boolean);
  if (!parts.length) throw new Error("Choose a kind of place in step 1.");
  return parts.map(p => {
    const i = p.indexOf("=");
    const key = (i < 0 ? p : p.slice(0, i)).trim();
    const val = i < 0 ? "*" : p.slice(i + 1).trim();
    if (!key || /\s/.test(key))
      throw new Error(
        `"${p}" is not a tag. Pick one of the suggestions, or write a tag as key=value, for example historic=castle.`,
      );
    if (val === "" || val === "*") return { key, values: null };
    return {
      key,
      values: val
        .split("|")
        .map(v => v.trim())
        .filter(Boolean),
    };
  });
}
/* A string quoted for an Overpass query. */
const quoteOql = s => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
/* The words from "Name contains" in step 1. */
const nameWords = () =>
  $("nameHas")
    .value.split(/[,|\n]/)
    .map(s => s.trim())
    .filter(Boolean);
/* Overpass filter for "name contains any of these words", ignoring upper and lower case. */
function nameFilter() {
  const w = nameWords();
  if (!w.length) return "";
  const short = w.find(x => x.length < 3);
  if (short) throw new Error(`"${short}" is too short for a name search. Use three letters or more.`);
  return `["name"~${quoteOql(w.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"))},i]`;
}
/* Short description of the search, used for the map name and tags: "Castle: Neuschwanstein". */
function searchLabel() {
  const w = nameWords(),
    n = w.length ? w[0].charAt(0).toUpperCase() + w[0].slice(1) : "";
  return kind ? (n ? `${kind.label}: ${n}` : kind.label) : n;
}
/* Overpass filter for the tags of a kind of place: "historic=castle, ruins=yes" -> ["historic"="castle"]["ruins"="yes"]. */
function tagFilter(text) {
  return parseTags(text)
    .map(({ key, values }) => {
      if (!values) return `[${quoteOql(key)}]`;
      if (values.length > 1)
        return `[${quoteOql(key)}~${quoteOql("^(" + values.map(v => v.replace(/[.*+?^${}()[\]\\]/g, "\\$&")).join("|") + ")$")}]`;
      return `[${quoteOql(key)}=${quoteOql(values[0])}]`;
    })
    .join("");
}

/* The user's own (paid or private) Overpass server, if one is set: { url, mode } with mode "first" or "fallback". */
let osmOwn = null;
const osmUse = { own: 0, pub: 0, ownTrouble: "" }; // what answered during the current search
const hostOf = u => {
  try {
    return new URL(u).host;
  } catch {
    return "the server";
  }
}; // never show the path: it holds the key

/* ---------- catalogue search ---------- */
let lang = store.get("lang", null) || (navigator.language || "en").slice(0, 2).toLowerCase();
if (typeof lang !== "string" || !Object.hasOwn(LANGS, lang)) lang = "en"; // stored value: only the five known languages
/* The place catalogue (CAT, built from the iD editor presets) comes from the build:
   CAT.t is the list of tags, CAT.en, CAT.de, … the names in each language, with search words after tabs.
   index() prepares one language for searching, once. */
const indexCache = {};
function index(l) {
  if (!Object.hasOwn(LANGS, l)) l = "en";
  return (indexCache[l] ??= CAT[l].map((s, i) => {
    const parts = (s || CAT.en[i]).split("\t");
    return { name: parts[0], n: foldAccents(parts[0]), terms: parts.slice(1).map(foldAccents) };
  }));
}
/* The catalogue name of a tag in the current language, or null. */
const catName = tag => {
  const i = CAT.t.indexOf(tag);
  return i < 0 ? null : index(lang)[i].name;
};
/* How well a catalogue entry matches what was typed: 0 is best, -1 is no match. */
function scoreEntry(e, q) {
  if (e.n === q) return 0;
  if (e.n.startsWith(q)) return 1;
  if (e.n.includes(" " + q) || e.n.includes("-" + q)) return 2;
  if (e.terms.some(t => t === q)) return 2.5;
  if (e.terms.some(t => t.startsWith(q) || t.includes(" " + q))) return 3;
  if (q.length >= 3 && e.n.includes(q)) return 4;
  if (q.length >= 4 && e.terms.some(t => t.includes(q))) return 5;
  return -1;
}
/* Best catalogue matches for what was typed: [{ label, tag }]. English names count too, slightly lower. */
function searchCatalogue(text, limit = 8) {
  const q = foldAccents(text.trim());
  if (q.length < 2) return [];
  const main = index(lang),
    en = lang === "en" ? null : index("en"),
    hits = [];
  for (let i = 0; i < CAT.t.length; i++) {
    let s = scoreEntry(main[i], q);
    if (s < 0 && en) {
      const s2 = scoreEntry(en[i], q);
      if (s2 >= 0) s = s2 + 0.4;
    }
    if (s < 0 && q.length >= 3) {
      const t = CAT.t[i];
      if (t.includes("=" + q) || t.includes("_" + q)) s = 6;
    }
    if (s >= 0) hits.push({ s, i });
  }
  hits.sort(
    (a, b) =>
      a.s - b.s ||
      CAT.t[a.i].split(",").length - CAT.t[b.i].split(",").length ||
      main[a.i].name.length - main[b.i].name.length,
  );
  return hits.slice(0, limit).map(h => ({ label: main[h.i].name, tag: CAT.t[h.i] }));
}

/* ---------- taginfo (live) ---------- */
/* Keys that describe a place rather than say what it is (name, address, source, …). Suggestions with
   these keys are hidden. */
const JUNK_KEY =
  /^(name|addr|source|note|description|ref|operator|brand|network|website|url|contact|wikipedia|wikidata|is_in|destination|fixme|comment|image|email|phone|opening_hours|created_by|tiger|gnis|nhd|import|start_date|type|layer|surface|access|service)\b|name$|:name|^.*:(source|ref|note)$/i;
const SAFE_KEY = /^[A-Za-z0-9_:.-]{1,60}$/;
/* A tag value as a label: "fast_food" -> "Fast food". */
const tagValueLabel = v => {
  const s = v.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};
/* Live suggestions from taginfo, the statistics site of OpenStreetMap: tags whose value or key matches
   what was typed, most used first: [{ label, tag, count }]. Returns [] when taginfo cannot be reached. */
async function taginfoSearch(text, signal) {
  const qs = encodeURIComponent(text.trim().toLowerCase().replace(/\s+/g, "_"));
  const get = async u => {
    try {
      const d = (await (await fetch(TAGINFO + u, { signal })).json()).data;
      return Array.isArray(d) ? d : [];
    } catch {
      return [];
    }
  };
  const [vals, keys] = await Promise.all([
    get(`search/by_value?query=${qs}&sortname=count_all&sortorder=desc&rp=30&page=1`),
    get(`keys/all?query=${qs}&sortname=count_all&sortorder=desc&rp=10&page=1`),
  ]);
  const a = vals
    .filter(
      d =>
        d &&
        typeof d.key === "string" &&
        SAFE_KEY.test(d.key) &&
        !JUNK_KEY.test(d.key) &&
        typeof d.value === "string" &&
        /^[a-z0-9_]{2,40}$/.test(d.value) &&
        Number(d.count_all) >= MIN_USES,
    )
    .map(d => ({
      label: tagValueLabel(d.value),
      tag: `${d.key}=${d.value}`,
      count: Math.floor(Number(d.count_all)),
    }));
  const b = keys
    .filter(
      d =>
        d &&
        typeof d.key === "string" &&
        !JUNK_KEY.test(d.key) &&
        /^[a-z0-9_:]{2,40}$/.test(d.key) &&
        Number(d.count_all) >= MIN_USES,
    )
    .map(d => ({
      label: tagValueLabel(d.key.replace(/:/g, " ")) + " (any value)",
      tag: `${d.key}=*`,
      count: Math.floor(Number(d.count_all)),
    }));
  return [...a, ...b].sort((x, y) => y.count - x.count);
}
const countCache = new Map();
/* How often one tag is used worldwide, from taginfo. For several values (a|b) the counts are added. */
async function countPart({ key, values }) {
  const one = async v => {
    const u =
      v === null
        ? `${TAGINFO}key/stats?key=${encodeURIComponent(key)}`
        : `${TAGINFO}tag/stats?key=${encodeURIComponent(key)}&value=${encodeURIComponent(v)}`;
    const j = await (await fetch(u)).json();
    const all = (Array.isArray(j.data) ? j.data : []).find(d => d && d.type === "all");
    if (!all || !inRange(all.count, 0, 1e11)) throw new Error("no count");
    return all.count;
  };
  const counts = await Promise.all((values || [null]).map(one));
  return counts.reduce((a, b) => a + b, 0);
}
/* Upper bound for how many places match: the rarest of the combined tags. Resolves to null when
   taginfo cannot tell. Cached, as the same tag is counted again on every change in step 1. */
function worldCount(tag) {
  if (!countCache.has(tag)) {
    countCache.set(
      tag,
      (async () => {
        try {
          return Math.min(...(await Promise.all(parseTags(tag).map(countPart))));
        } catch {
          return null;
        }
      })(),
    );
  }
  return countCache.get(tag);
}

/* ---------- step 1: kind picker ---------- */
let kind = store.get("kind", null); // {label, tag, count?}
let items = [],
  active = -1,
  searchSeq = 0,
  searchAbort = null,
  searchTimer = 0;
const kindEl = $("kind"),
  listEl = $("suggest");
for (const [code, name] of Object.entries(LANGS)) {
  const o = document.createElement("option");
  o.value = code;
  o.textContent = name;
  $("lang").append(o);
}
$("lang").value = lang;

/* Shows the suggestion list under the field: catalogue matches, then taginfo matches. */
function renderSuggest(cat, more, loading) {
  items = [...cat, ...more];
  if (!items.length && !loading) {
    closeSuggest();
    return;
  }
  let h = "",
    n = 0;
  const row = it =>
    `<li role="option" id="opt${n}" data-i="${n++}" aria-selected="false"><span><span class="nm">${esc(it.label)}</span><span class="tg">${esc(it.tag)}</span></span>${it.count ? `<span class="ct">${fmt(it.count)}</span>` : ""}</li>`;
  h += cat.map(row).join("");
  if (more.length)
    h +=
      `<li class="grp" role="presentation">More tags from OpenStreetMap, with how many exist</li>` +
      more.map(row).join("");
  else if (loading) h += `<li class="grp" role="presentation">Looking for more on OpenStreetMap…</li>`;
  listEl.innerHTML = h;
  listEl.hidden = false;
  kindEl.setAttribute("aria-expanded", "true");
  setActive(cat.length ? 0 : -1);
}
function setActive(i) {
  active = i;
  listEl
    .querySelectorAll("li[role=option]")
    .forEach(li => li.setAttribute("aria-selected", +li.dataset.i === i ? "true" : "false"));
  if (i >= 0) {
    kindEl.setAttribute("aria-activedescendant", "opt" + i);
    $("opt" + i)?.scrollIntoView({ block: "nearest" });
  } else kindEl.removeAttribute("aria-activedescendant");
}
function closeSuggest() {
  listEl.hidden = true;
  kindEl.setAttribute("aria-expanded", "false");
  active = -1;
  searchAbort?.abort();
  clearTimeout(searchTimer);
}
/* Typing in "Kind of place": catalogue matches at once, taginfo matches after a short pause (350 ms)
   so that not every keystroke goes to taginfo. searchSeq drops answers that arrive after newer typing. */
function onKindInput() {
  const text = kindEl.value;
  kind = null;
  renderPicked();
  searchAbort?.abort();
  clearTimeout(searchTimer);
  const seq = ++searchSeq;
  if (text.includes("=")) {
    closeSuggest();
    rawKind();
    return;
  }
  const cat = searchCatalogue(text);
  const live = text.trim().length >= 3;
  renderSuggest(cat, [], live);
  if (!live) return;
  searchTimer = setTimeout(async () => {
    searchAbort = new AbortController();
    let more = [];
    try {
      more = await taginfoSearch(text, searchAbort.signal);
    } catch {}
    if (seq !== searchSeq || (listEl.hidden && !cat.length && !more.length)) return;
    const have = new Set(cat.map(c => c.tag));
    renderSuggest(cat, more.filter(m => !have.has(m.tag)).slice(0, 6), false);
  }, 350);
}
/* Text typed as key=value is used as it is. */
function rawKind() {
  const text = kindEl.value.trim();
  try {
    parseTags(text);
    kind = { label: catName(text) || text, tag: text, raw: true };
  } catch {
    kind = null;
  }
  renderPicked();
}
/* A suggestion was picked. */
function choose(it) {
  kind = { label: it.label, tag: it.tag };
  kindEl.value = it.label;
  closeSuggest();
  renderPicked();
}
/* Saves step 1 and shows below it what will be searched, with the worldwide count from taginfo. */
function renderPicked() {
  const el = $("picked"),
    words = nameWords();
  suggestName();
  store.set("kind", kind ? { label: kind.label, tag: kind.tag, raw: kind.raw } : null);
  store.set("nameHas", $("nameHas").value);
  if (!kind && !words.length) {
    el.hidden = true;
    return;
  }
  const named = words.length
    ? ` with a name containing ${words.map(w => `<code>${esc(w)}</code>`).join(" or ")}`
    : "";
  if (!kind) {
    el.innerHTML = `Searching for any place${named}<span class="warn">A name search without a kind of place is slow. It needs "Only the countries I choose" in step 2.</span>`;
    el.hidden = false;
    return;
  }
  const first = parseTags(kind.tag)[0];
  const url =
    first.values && first.values.length === 1
      ? `https://taginfo.openstreetmap.org/tags/${encodeURIComponent(first.key)}=${encodeURIComponent(first.values[0])}`
      : `https://taginfo.openstreetmap.org/keys/${encodeURIComponent(first.key)}`;
  const tag = kind.tag;
  const paint = count => {
    if (!kind || kind.tag !== tag) return;
    let h = `Searching for <code>${esc(tag)}</code>${named}`;
    if (count === undefined) h += `<br><span class="hint">Counting them on OpenStreetMap…</span>`;
    else if (count === null)
      h += `<br><a href="${url}" target="_blank" rel="noopener">See this tag on taginfo</a>`;
    else {
      const multi = parseTags(tag).length > 1;
      h += `<br>${count === 0 ? "None" : (multi ? "At most " : "About ") + fmt(count)} on OpenStreetMap worldwide${named ? ", before the name filter" : ""}. <a href="${url}" target="_blank" rel="noopener">Details</a>`;
      if (count === 0) h += `<span class="warn">Nothing uses this tag. Check the spelling.</span>`;
      else if (count > TOO_MANY && !named)
        h += `<span class="warn">That is a lot. Choose "Only the countries I choose" in step 2.</span>`;
    }
    el.innerHTML = h;
    el.hidden = false;
  };
  paint(undefined);
  worldCount(tag).then(c => {
    if (kind && kind.tag === tag) kind.count = c;
    paint(c);
  });
}
$("nameHas").addEventListener("input", renderPicked);
kindEl.addEventListener("input", onKindInput);
kindEl.addEventListener("focus", () => {
  if (!kind && kindEl.value.trim().length >= 2) onKindInput();
});
kindEl.addEventListener("keydown", e => {
  if (listEl.hidden) {
    if (e.key === "ArrowDown" && kindEl.value.trim()) onKindInput();
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    setActive(Math.min(items.length - 1, active + 1));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setActive(Math.max(0, active - 1));
  } else if (e.key === "Enter") {
    if (active >= 0) {
      e.preventDefault();
      choose(items[active]);
    }
  } else if (e.key === "Escape") closeSuggest();
});
listEl.addEventListener("mousedown", e => {
  const li = e.target.closest("li[role=option]");
  if (li) {
    e.preventDefault();
    choose(items[+li.dataset.i]);
  }
});
kindEl.addEventListener("blur", () => setTimeout(closeSuggest, 120));
$("examples").innerHTML = EXAMPLES.map(
  t => `<button type="button" data-t="${esc(t)}"><code>${esc(t)}</code></button>`,
).join("");
$("examples").onclick = e => {
  const b = e.target.closest("button");
  if (b) {
    kindEl.value = b.dataset.t;
    rawKind();
    kindEl.focus();
  }
};
$("lang").onchange = () => {
  lang = $("lang").value;
  store.set("lang", lang);
  if (kind) {
    const n = catName(kind.tag);
    if (n) {
      kind.label = n;
      kindEl.value = n;
      renderPicked();
    }
  }
};

/* ---------- step 2: where ---------- */
const selected = new Set(store.get("countries", []).filter(c => CODES.includes(c)));
/* Where to search: "pick" (chosen countries), "cov" (all Street View countries) or "world". */
const scope = () => document.querySelector("input[name=scope]:checked").value;
$("covHint").textContent = `The ${COVERAGE.size} countries and territories Google has driven.`;
/* Draws the country list and the chips of chosen countries, and saves the choice. */
function renderCountries() {
  const q = $("countrySearch").value.trim().toLowerCase();
  const list = COUNTRIES.filter(c => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q);
  const row = c =>
    `<label><input type="checkbox" value="${c.code}" ${selected.has(c.code) ? "checked" : ""}>${esc(c.name)}</label>`;
  const yes = list.filter(c => COVERAGE.has(c.code)),
    no = list.filter(c => !COVERAGE.has(c.code));
  $("countries").innerHTML = list.length
    ? (yes.length ? `<div class="grp">With Street View</div>` + yes.map(row).join("") : "") +
      (no.length ? `<div class="grp">No official Street View</div>` + no.map(row).join("") : "")
    : `<div class="none">No country matches that search.</div>`;
  $("chips").innerHTML = [...selected]
    .map(
      c =>
        `<button type="button" class="chip${COVERAGE.has(c) ? "" : " off"}" data-c="${c}" aria-label="Remove ${esc(countryName(c))}">${esc(countryName(c))}</button>`,
    )
    .join("");
  store.set("countries", [...selected]);
  renderScope();
}
/* Shows the country list only for "pick", and warns when the area has no official coverage. */
function renderScope() {
  const s = scope();
  $("pickBox").hidden = s !== "pick";
  updateCountryTag();
  store.set("scope", s);
  const note = $("scopeNote"),
    off = [...selected].filter(c => !COVERAGE.has(c));
  const official = $("official").checked;
  let text = "";
  if (official && s === "pick" && off.length) {
    const names =
      off.slice(0, 3).map(countryName).join(", ") + (off.length > 3 ? ` and ${off.length - 3} more` : "");
    text = `${names} ${off.length === 1 ? "has" : "have"} no official Street View, so nothing will be found there while "Official Google coverage only" is on.`;
  } else if (official && s === "world") {
    text = `Countries Google has not driven only have photos uploaded by other people. They are skipped while "Official Google coverage only" is on.`;
  }
  note.hidden = !text;
  if (text)
    note.innerHTML = `${esc(text)}<button type="button" id="allowUnofficial">Include photos from other people</button>`;
  suggestName();
}
$("scopeNote").onclick = e => {
  if (e.target.id === "allowUnofficial") {
    $("official").checked = false;
    renderScope();
  }
};
$("official").onchange = renderScope;
document.querySelectorAll("input[name=scope]").forEach(r => (r.onchange = renderScope));
$("countrySearch").oninput = renderCountries;
$("countries").onchange = e => {
  e.target.checked ? selected.add(e.target.value) : selected.delete(e.target.value);
  renderCountries();
};
$("chips").onclick = e => {
  const c = e.target.dataset.c;
  if (c) {
    selected.delete(c);
    renderCountries();
  }
};
/* Fills the Overpass query into the expert panel, with a link to Overpass Turbo. */
function renderQuery() {
  const box = $("queryText"),
    link = $("turbo");
  let text = "",
    ok = false;
  try {
    const s = scope(),
      codes = s === "world" ? null : s === "cov" ? [...COVERAGE] : [...selected];
    const filter = (kind ? tagFilter(kind.tag) : "") + nameFilter();
    if (!filter) text = "Choose a kind of place or enter a name in step 1.";
    else if (codes && !codes.length) text = "Tick one or more countries in step 2.";
    else {
      text = buildQuery(filter, codes, true, true);
      ok = true;
    }
  } catch (e) {
    text = e.message;
  }
  box.value = text;
  $("copyQuery").disabled = !ok;
  link.href = ok ? "https://overpass-turbo.eu/?Q=" + encodeURIComponent(text) : "https://overpass-turbo.eu/";
}
$("copyQuery").onclick = async () => {
  const b = $("copyQuery");
  try {
    await navigator.clipboard.writeText($("queryText").value);
    b.textContent = "Copied";
  } catch {
    $("queryText").select();
    b.textContent = "Press Ctrl+C";
  }
  setTimeout(() => (b.textContent = "Copy query"), 1500);
};
$("expert").open = store.get("expert", false);
$("expert").ontoggle = () => store.set("expert", $("expert").open);
/* Keeps the expert query and the suggested map name up to date. */
function suggestName() {
  renderQuery();
  const s = scope();
  const where =
    s === "world"
      ? "Whole world"
      : s === "cov"
        ? "World"
        : selected.size === 0
          ? ""
          : selected.size <= 2
            ? [...selected].map(countryName).join(" and ")
            : selected.size + " countries";
  if (ownResult) {
    $("mapName").placeholder = ownLabel();
    return;
  }
  const what = searchLabel();
  $("mapName").placeholder = what ? `${what}${where ? ` (${where})` : ""}` : "Filled in for you";
}

$("targetInfoBtn").onclick = () => {
  const box = $("targetInfo"),
    open = box.hidden;
  box.hidden = !open;
  $("targetInfoBtn").setAttribute("aria-expanded", String(open));
};

// Restore saved settings. Every value is checked before use.
for (const id of ["maxDist", "minDist", "target"]) {
  const v = store.get(id, null);
  if (v !== null) $(id).value = v;
}
$("official").checked = store.get("official", true);
$("tagCountry").checked = store.get("tagCountry", true);
$("tags").checked = store.get("tagKind", false);
$("tagName").checked = store.get("tagName", false);
$("tagRoad").checked = store.get("tagRoad", false);
{
  const s = store.get("scope", "pick");
  const r = document.querySelector(
    `input[name=scope][value=${["cov", "pick", "world"].includes(s) ? s : "pick"}]`,
  );
  r.checked = true;
}
$("keyBox").hidden = !!GOOGLE_API_KEY;
$("apiKey").value = keyStore.get();
$("nameHas").value = store.get("nameHas", "");
if (kind && kind.tag) {
  try {
    parseTags(kind.tag);
    kind.label = catName(kind.tag) || kind.label;
    kindEl.value = kind.raw ? kind.tag : kind.label;
  } catch {
    kind = null;
  }
} else kind = null;

/* ---------- your own Overpass server ---------- */
/* Where the own server is kept: localStorage if "remember" is on, else sessionStorage (this tab only). */
const srvStore = {
  load() {
    for (const st of [() => localStorage, () => sessionStorage]) {
      try {
        const v = JSON.parse(st().getItem("lookout2.osmOwn") || "null");
        if (v && cleanServer(v.url) && ["first", "fallback"].includes(v.mode))
          return { url: cleanServer(v.url), mode: v.mode, remembered: st() === localStorage };
      } catch {}
    }
    return null;
  },
  save(v, remember) {
    this.clear();
    try {
      (remember ? localStorage : sessionStorage).setItem(
        "lookout2.osmOwn",
        JSON.stringify({ url: v.url, mode: v.mode }),
      );
    } catch {}
  },
  clear() {
    try {
      localStorage.removeItem("lookout2.osmOwn");
    } catch {}
    try {
      sessionStorage.removeItem("lookout2.osmOwn");
    } catch {}
  },
};
/* A usable server address: https only, no fragment. Returns the cleaned address or "". */
function cleanServer(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return "";
  }
  if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return "";
  u.hash = "";
  return u.toString();
}
/* Addresses to try for what the user typed: as given if it names the interpreter, otherwise the two usual endings. */
function serverCandidates(clean) {
  const u = new URL(clean);
  if (/\/interpreter\/?$/.test(u.pathname)) return [clean];
  const base = clean.split("?")[0].replace(/\/?$/, "/"),
    q = u.search;
  return [base + "api/interpreter" + q, base + "interpreter" + q];
}
/* Sends a tiny query to check that a server answers like Overpass. Returns { ok, why?, maybe? };
   maybe means the address looks right but the server is limiting requests just now. */
async function testServer(url) {
  const ctl = new AbortController(),
    timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, {
      method: "POST",
      body: "data=" + encodeURIComponent("[out:json][timeout:10];node(1);out ids;"),
      signal: ctl.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (r.status === 401 || r.status === 403)
      return { ok: false, why: `it refused access (HTTP ${r.status}); check the key` };
    if (r.status === 429)
      return {
        ok: false,
        why: "it says there were too many requests (HTTP 429); the address looks right, try again shortly",
        maybe: true,
      };
    if (!r.ok) return { ok: false, why: `it answered HTTP ${r.status}` };
    let j;
    try {
      j = await r.json();
    } catch {
      return { ok: false, why: "it did not answer with Overpass data" };
    }
    return j && Array.isArray(j.elements)
      ? { ok: true }
      : { ok: false, why: "it did not answer with Overpass data" };
  } catch (e) {
    return {
      ok: false,
      why: ctl.signal.aborted
        ? "it did not answer within 20 seconds"
        : "the browser could not reach it (wrong address, or the server does not allow requests from web pages)",
    };
  } finally {
    clearTimeout(timer);
  }
}
const srvMode = () => document.querySelector("input[name=srvMode]:checked").value;
/* Shows which own server is in use and how. */
function renderServer() {
  const st = $("srvStatus");
  st.hidden = !osmOwn;
  $("srvForget").hidden = !osmOwn;
  if (!osmOwn) return;
  st.textContent = "";
  const strong = document.createElement("b");
  strong.textContent = `In use: ${hostOf(osmOwn.url)}`;
  st.append(
    strong,
    document.createElement("br"),
    `${osmOwn.mode === "first" ? "Used for every search; the public servers only if it fails." : "Used only when the public servers fail."} ${$("srvRemember").checked ? "Remembered in this browser." : "Kept until you close this tab."}`,
  );
}
function srvProblem(msg) {
  const e = $("srvError");
  e.hidden = !msg;
  e.textContent = msg || "";
}
$("srvSave").onclick = async () => {
  srvProblem("");
  const clean = cleanServer($("srvUrl").value);
  if (!clean) return srvProblem("Enter the full address of the server, starting with https://.");
  const b = $("srvSave");
  b.disabled = true;
  b.textContent = "Testing…";
  let found = "",
    why = "",
    maybe = "";
  for (const c of serverCandidates(clean)) {
    const t = await testServer(c);
    if (t.ok) {
      found = c;
      break;
    }
    why = why || t.why;
    if (t.maybe) maybe = maybe || c;
  }
  b.disabled = false;
  b.textContent = "Test and use this server";
  const named = /\/interpreter\/?(\?|$)/.test(clean);
  if (!found && !named && !maybe)
    return srvProblem(
      `The test request failed: ${why}. If the address is right, enter it in full, ending in "/interpreter".`,
    );
  osmOwn = { url: found || maybe || clean, mode: srvMode() };
  srvStore.save(osmOwn, $("srvRemember").checked);
  $("srvUrl").value = osmOwn.url;
  renderServer();
  if (!found)
    srvProblem(
      `The server is saved, but the test request failed: ${why}. Searches will fall back to the public servers while it does not answer.`,
    );
};
$("srvForget").onclick = () => {
  osmOwn = null;
  srvStore.clear();
  $("srvUrl").value = "";
  srvProblem("");
  renderServer();
};
const srvResave = () => {
  if (osmOwn) {
    osmOwn.mode = srvMode();
    srvStore.save(osmOwn, $("srvRemember").checked);
    renderServer();
  }
};
document.querySelectorAll("input[name=srvMode]").forEach(r => (r.onchange = srvResave));
$("srvRemember").onchange = srvResave;
{
  const v = srvStore.load();
  if (v) {
    osmOwn = { url: v.url, mode: v.mode };
    $("srvUrl").value = v.url;
    $("srvRemember").checked = v.remembered;
    document.querySelector(`input[name=srvMode][value=${v.mode}]`).checked = true;
  }
  renderServer();
}

/* ---------- your own Overpass result: state ---------- */
let ownResult = null; // { places, noPosition, lines, worked, hasCc, countries, source }
/* The country tag needs a country per place, which "Whole world" and some own results do not have. */
function updateCountryTag() {
  const off = ownResult ? !ownResult.hasCc : scope() === "world";
  $("tagCountry").disabled = off;
  $("tagCountryRow").classList.toggle("off", off);
  const h = $("tagCountryHint");
  h.hidden = !off;
  if (off) {
    h.textContent = "";
    h.append(
      document.createElement("br"),
      ownResult
        ? "Not available: this result does not say which country each place is in."
        : 'Not available with "Whole world", which does not know the country of a place.',
    );
  }
}
/* Number of the settings step, which moves up when an own result replaces steps 1 and 2. */
const lastStep = () => (ownResult ? 2 : 3);
function emptyText(title, body) {
  const e = $("empty");
  e.textContent = "";
  const t = document.createElement("strong");
  t.textContent = title;
  e.append(t, body);
}
/* Switches the page between a normal search and a loaded own result, and describes the result. */
function renderOwn() {
  $("lastStepNo").textContent = lastStep();
  if (ownResult)
    emptyText("Your places are loaded", 'Check the settings on the left, then select "Find locations".');
  else emptyText("Nothing found yet", 'Choose a kind of place and select "Find locations".');
  $("ownStep").hidden = !ownResult;
  $("stepKind").hidden = !!ownResult;
  $("stepWhere").hidden = !!ownResult;
  renderAgain();
  $("share").hidden = !!ownResult;
  if (ownResult) {
    const el = $("ownSummary");
    el.textContent = "";
    const b = document.createElement("b");
    b.textContent = `${fmt(ownResult.places.length)} ${ownResult.places.length === 1 ? "place" : "places"} from ${ownResult.source}`;
    el.append(b);
    const lines = [];
    lines.push(
      ownResult.hasCc
        ? `Country known for places in ${fmt(ownResult.countries)} ${ownResult.countries === 1 ? "country" : "countries"}.`
        : "No country information in this result, so locations get no country code.",
    );
    if (ownResult.worked)
      lines.push(
        `${fmt(ownResult.worked)} ${ownResult.worked === 1 ? "outline has" : "outlines have"} no centre in the file; the middle of ${ownResult.worked === 1 ? "its" : "their"} shape is used.`,
      );
    if (ownResult.noPosition)
      lines.push(
        `${fmt(ownResult.noPosition)} ${ownResult.noPosition === 1 ? "object was" : "objects were"} skipped because ${ownResult.noPosition === 1 ? "it has" : "they have"} no position. End the query with "out center;" to include ${ownResult.noPosition === 1 ? "it" : "them"}.`,
      );
    if (ownResult.lines)
      lines.push(
        `${fmt(ownResult.lines)} ${ownResult.lines === 1 ? "is a line" : "are lines"} such as a road or river. Locations will face the middle of the line.`,
      );
    if (ownResult.places.length > OWN_MANY)
      lines.push(
        'That is a very large number of places. Checking them all takes a long time; "Locations wanted" stops the search earlier.',
      );
    for (const l of lines) {
      el.append(document.createElement("br"), l);
    }
  }
  updateCountryTag();
  suggestName();
}
/* Reads an own result (pasted text or file contents). Errors are shown under the field. */
function loadOwn(raw, source) {
  const err = $("ownError");
  err.hidden = true;
  if (running) return;
  try {
    ownResult = { ...parseOwn(raw), source };
    if (!$("ownLabel").value.trim())
      $("ownLabel").value = /\.\w+$/.test(source)
        ? source
            .replace(/\.\w+$/, "")
            .replace(/[_-]+/g, " ")
            .slice(0, 80)
        : "";
    $("ownText").value = "";
    show("", "");
    renderOwn();
    $("ownStep").scrollIntoView({ block: "start" });
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
}
async function loadOwnFile(file) {
  const err = $("ownError");
  err.hidden = true;
  if (!file) return;
  if (file.size > OWN_MAX_BYTES) {
    err.textContent = `This file is ${Math.round(file.size / 1048576)} MB, more than the browser can handle here. Narrow the query in Overpass Turbo.`;
    err.hidden = false;
    return;
  }
  let raw;
  try {
    raw = await file.text();
  } catch {
    err.textContent = "The file could not be read.";
    err.hidden = false;
    return;
  }
  loadOwn(raw, cleanText(file.name, 80) || "your file");
}
$("ownFile").onchange = e => {
  loadOwnFile(e.target.files[0]);
  e.target.value = "";
};
$("ownUse").onclick = () => loadOwn($("ownText").value, "pasted text");
$("ownRemove").onclick = () => {
  ownResult = null;
  renderOwn();
  renderScope();
  renderPicked();
};
$("ownLabel").oninput = suggestName;
{
  const d = $("ownDrop");
  d.ondragover = e => {
    e.preventDefault();
    d.classList.add("over");
  };
  d.ondragleave = () => d.classList.remove("over");
  d.ondrop = e => {
    e.preventDefault();
    d.classList.remove("over");
    loadOwnFile(e.dataTransfer?.files?.[0]);
  };
}
const ownLabel = () => $("ownLabel").value.trim().slice(0, 80) || "My places";

/* ---------- shareable links ----------
   The settings travel in the query part of the address ("?k=…"). Links with the settings after "#" (older
   links) still work, but some web hosts check new visitors with a redirect that loses everything after "#",
   while the query part survives it. The API key is never included. Everything read from a link is checked
   before use, and unknown parameters (such as a host's own "i=1") are ignored. */
/* The address of this search, with its settings. */
function shareLink() {
  const q = new URLSearchParams(),
    s = scope();
  if (kind) q.set("k", kind.tag);
  const n = $("nameHas").value.trim();
  if (n) q.set("n", n);
  q.set("s", s);
  if (s === "pick" && selected.size) q.set("c", [...selected].join("-"));
  q.set("d", $("maxDist").value);
  if (+$("minDist").value > 0) q.set("m", $("minDist").value);
  q.set("t", $("target").value);
  if (!$("official").checked) q.set("o", "0");
  if ($("tags").checked) q.set("g", "1");
  if (!$("tagCountry").checked) q.set("gc", "0");
  if ($("tagName").checked) q.set("gn", "1");
  if ($("tagRoad").checked) q.set("gr", "1");
  const mn = $("mapName").value.trim();
  if (mn) q.set("name", mn);
  return location.href.split(/[?#]/)[0] + "?" + q.toString();
}
/* A link counts as a shared search if it has at least one of these. */
const LINK_KEYS = ["k", "n", "s", "c", "d", "t"];
/* The settings in this page's address, or null when it carries none. */
function linkParams() {
  for (const part of [location.hash.slice(1), location.search.slice(1)]) {
    if (!part || !part.includes("=")) continue;
    let q;
    try {
      q = new URLSearchParams(part);
    } catch {
      continue;
    }
    if (LINK_KEYS.some(x => q.has(x))) return q;
  }
  return null;
}
/* Puts the settings from the address into the form. Numbers are kept within the field limits, unknown
   countries and broken tags are dropped. Returns true if the address carried a search. */
function applyLink() {
  const q = linkParams();
  if (!q) return false;
  const num = (key, lo, hi, id) => {
    const v = Math.round(Number(q.get(key)));
    if (q.has(key) && Number.isFinite(v)) $(id).value = Math.min(hi, Math.max(lo, v));
  };
  const k = cleanText(q.get("k"), 300).trim();
  kind = null;
  kindEl.value = "";
  if (k) {
    try {
      parseTags(k);
      const name = catName(k);
      kind = { label: name || k, tag: k, raw: !name };
      kindEl.value = name || k;
    } catch {}
  }
  $("nameHas").value = cleanText(q.get("n"), 200);
  const s = q.get("s");
  if (["cov", "pick", "world"].includes(s))
    document.querySelector(`input[name=scope][value=${s}]`).checked = true;
  if (q.has("c")) {
    selected.clear();
    for (const c of cleanText(q.get("c"), 1200).split(/[-,]/)) if (CODES.includes(c)) selected.add(c);
  }
  num("d", 5, 2000, "maxDist");
  num("m", 0, 1000, "minDist");
  num("t", 1, 100000, "target");
  if (!q.has("m")) $("minDist").value = 0;
  $("official").checked = q.get("o") !== "0";
  $("tags").checked = q.get("g") === "1";
  $("tagCountry").checked = q.get("gc") !== "0";
  $("tagName").checked = q.get("gn") === "1";
  $("tagRoad").checked = q.get("gr") === "1";
  $("mapName").value = cleanText(q.get("name"), 100);
  return true;
}
$("share").onclick = async () => {
  const b = $("share");
  if (ownResult) return;
  if (!kind && !nameWords().length)
    return show(
      "error",
      "Choose a kind of place or enter a name in step 1 first. Then the link has something to share.",
    );
  const url = shareLink();
  try {
    history.replaceState(null, "", url);
  } catch {}
  try {
    await navigator.clipboard.writeText(url);
    b.textContent = "Link copied";
  } catch {
    b.textContent = "The link is in the address bar";
  }
  setTimeout(() => (b.textContent = "Copy a link to this search"), 2500);
};
const fromLink = applyLink();
let formTouched = false;
$("form").addEventListener("input", () => {
  formTouched = true;
});
$("form").addEventListener("change", e => {
  if (e.isTrusted) formTouched = true;
});
/* Apply the shared link again. Browsers can restore earlier form values while the page loads, and the
   first-visit welcome sits on top of the page; this makes sure the link's settings are what the visitor sees. */
function reapplyLink() {
  if (!fromLink || formTouched || running || ownResult) return;
  if (applyLink()) {
    renderCountries();
    renderPicked();
    linkNote();
  }
}
window.addEventListener("load", () => setTimeout(reapplyLink, 0));
window.addEventListener("pageshow", e => {
  if (e.persisted) reapplyLink();
});
window.addEventListener("hashchange", () => {
  if (!running && applyLink()) {
    renderCountries();
    renderPicked();
    linkNote();
  }
});
/* Tells the visitor that the settings come from a shared link and that nothing has run yet. */
function linkNote() {
  const e = $("empty");
  e.textContent = "";
  const t = document.createElement("strong");
  t.textContent = "Search loaded from a shared link";
  e.append(t, 'Check the settings on the left, then select "Find locations".');
  show(
    "note",
    'These settings come from a shared link. Select "Find locations" to run the search. Results are a random selection, so yours will differ from the sender\'s.',
  );
}

renderCountries();
renderPicked();

/* ---------- map ---------- */
/* Leaflet map. `dots` holds the faint dots of all candidate places, `layer` the found locations.
   Everything is drawn on one canvas, which stays fast with thousands of dots. */
let map, layer, dots, canvas;
function initMap() {
  if (!window.L || map) return;
  canvas = L.canvas({ padding: 0.3, tolerance: 6 });
  map = L.map("map", { worldCopyJump: true, preferCanvas: true }).setView([25, 10], 2);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  dots = L.layerGroup().addTo(map);
  layer = L.layerGroup().addTo(map);
}
window.addEventListener("load", initMap);
/* Links for a place or location: Google Maps, OpenStreetMap, and Street View facing the place. */
const gmaps = p =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.lat + "," + p.lng)}`;
const osmLink = p =>
  `https://www.openstreetmap.org/${encodeURIComponent(p.type)}/${encodeURIComponent(p.id)}`;
/* Faint dots for the places about to be checked (at most MAX_DOTS), and zooms the map to them. */
function drawCandidates(places) {
  if (!map) return;
  for (const p of places.slice(0, MAX_DOTS))
    p.dot = L.circleMarker([p.lat, p.lng], {
      radius: 2.5,
      weight: 0,
      fillColor: "#14213d",
      fillOpacity: 0.35,
      renderer: canvas,
    })
      .bindPopup(() => placePopup(p))
      .addTo(dots);
  map.fitBounds(L.latLngBounds(places.slice(0, 2000).map(p => [p.lat, p.lng])).pad(0.05), { maxZoom: 12 });
}
/* Popup for a place that has no location on the map (not checked yet, or left out). */
function placePopup(p) {
  const m = p.miss;
  const near =
    m && m.panoId
      ? `<a href="https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(m.panoId)}&heading=${m.heading.toFixed(0)}" target="_blank" rel="noopener">Open the nearest Street View</a>`
      : "";
  return `<div class="pop"><b>${esc(p.name || "Unnamed place")}</b>${esc(m ? m.why : "Not checked yet.")}
    <a href="${gmaps(p)}" target="_blank" rel="noopener">Open in Google Maps</a>${near}
    <a href="${osmLink(p)}" target="_blank" rel="noopener">See the place on OpenStreetMap</a></div>`;
}
/* Records why a place was left out, and darkens its dot so it can be selected. */
function markMissed(p, why, r, d) {
  p.miss = { why, panoId: r && r.panoId, heading: r && r.panoId ? bearing(r.lat, r.lng, p.lat, p.lng) : 0 };
  p.dot?.setStyle({ radius: 3.5, fillColor: "#8a5a66", fillOpacity: 0.8 });
}
const roadLine = loc =>
  loc.road === "has"
    ? `<br>Road name shown: ${esc(loc.roadName)}`
    : loc.road === "none"
      ? "<br>No road name shown"
      : "";
const svLink = loc =>
  `https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(loc.panoId)}&heading=${loc.heading.toFixed(0)}`;
/* Draws a found location: marker at the camera, line to the place, dot at the place, and a popup. */
function drawLocation(loc) {
  if (!map) return;
  const line = L.polyline(
    [
      [loc.lat, loc.lng],
      [loc.poi.lat, loc.poi.lng],
    ],
    { color: "#f2a900", weight: 3, renderer: canvas, interactive: false },
  ).addTo(layer);
  const dot = L.circleMarker([loc.poi.lat, loc.poi.lng], {
    radius: 3,
    color: "#1d5fd1",
    weight: 0,
    fillOpacity: 1,
    renderer: canvas,
    interactive: false,
  }).addTo(layer);
  const sv = svLink(loc);
  const marker = L.circleMarker([loc.lat, loc.lng], {
    radius: 6,
    color: "#f2a900",
    weight: 2.5,
    fillColor: "#14213d",
    fillOpacity: 1,
    renderer: canvas,
  })
    .bindPopup(
      () => `<div class="pop"><b>${esc(loc.poi.name || "Unnamed place")}</b>${Math.round(loc.dist)} m away${loc.date ? ", photo from " + esc(loc.date) : ""}${roadLine(loc)}
      <a class="sv" href="${sv}" target="_blank" rel="noopener">Open in Street View</a>
      <a href="${gmaps(loc.poi)}" target="_blank" rel="noopener">Open in Google Maps</a>
      <a href="${osmLink(loc.poi)}" target="_blank" rel="noopener">See the place on OpenStreetMap</a>
      <button type="button" class="rm">Remove from map</button></div>`,
    )
    .on("popupopen", e => {
      const b = e.popup.getElement()?.querySelector(".rm");
      if (b) b.onclick = () => removeLocation(loc);
    })
    .addTo(layer);
  loc.layers = [line, dot, marker];
}
/* Taking a location out of the map and the export, with undo. */
let removed = [];
function removeLocation(loc) {
  const i = results.indexOf(loc);
  if (i < 0) return;
  results.splice(i, 1);
  removed.push(loc);
  map?.closePopup();
  (loc.layers || []).forEach(l => layer.removeLayer(l));
  paint();
}
function undoRemove() {
  const loc = removed.pop();
  if (!loc) return;
  results.push(loc);
  drawLocation(loc);
  paint();
}

/* ---------- list of named locations ---------- */
const NAMES_MAX = 400; // rows drawn at once; the filter narrows the rest
let namesOpenPano = "",
  namesSig = "";
/* A new element with properties and children: makeElement("a", { href }, "text"). */
const makeElement = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};
const makeLink = (href, label, cls = "") =>
  makeElement("a", { href, target: "_blank", rel: "noopener", className: cls }, label);
function showOnMap(loc) {
  const m = loc.layers && loc.layers[2];
  if (!map || !m) return;
  if (matchMedia("(max-width:860px)").matches) toggleNames(false);
  map.setView(m.getLatLng(), Math.max(map.getZoom(), 16), { animate: false });
  m.openPopup();
}
/* The side list of named locations, sorted by name and filtered as typed. Only redrawn when something
   it shows has changed (namesSig), as paint() calls it many times a second during a search. */
function renderNames(force) {
  const named = results.filter(l => l.poi.name),
    unnamed = results.length - named.length;
  $("namesOpen").disabled = !named.length && $("names").hidden;
  $("namesOpen").textContent = named.length ? `List by name (${fmt(named.length)})` : "List by name";
  if ($("names").hidden) return;
  const q = foldAccents($("namesFilter").value.trim());
  const sig = [results.length, removed.length, q, namesOpenPano].join("|");
  if (!force && sig === namesSig) return;
  namesSig = sig;
  const rows = named
    .map(l => ({ l, c: l.poi.cc ? countryName(l.poi.cc) : "" }))
    .filter(r => !q || foldAccents(r.l.poi.name).includes(q) || foldAccents(r.c).includes(q))
    .sort((a, b) => a.l.poi.name.localeCompare(b.l.poi.name) || a.c.localeCompare(b.c));
  const list = $("namesList");
  list.textContent = "";
  for (const { l, c } of rows.slice(0, NAMES_MAX)) {
    const open = l.panoId === namesOpenPano;
    const row = makeElement(
      "button",
      { type: "button", className: "row" },
      makeElement("span", {}, l.poi.name),
      makeElement("small", {}, c),
    );
    row.setAttribute("aria-expanded", String(open));
    row.onclick = () => {
      namesOpenPano = open ? "" : l.panoId;
      renderNames(true);
    };
    const li = makeElement("li", {}, row);
    if (open) {
      const rm = makeElement("button", { type: "button", className: "rm" }, "Remove from map");
      rm.onclick = () => {
        namesOpenPano = "";
        removeLocation(l);
      };
      const show = makeElement("button", { type: "button", className: "btn" }, "Show on map");
      show.onclick = () => showOnMap(l);
      li.append(
        makeElement(
          "div",
          { className: "detail" },
          `${Math.round(l.dist)} m away${l.date ? ", photo from " + l.date : ""}${l.road === "has" ? `. Road name shown: ${l.roadName}` : l.road === "none" ? ". No road name shown" : ""}`,
          makeLink(svLink(l), "Open in Street View", "svbtn"),
          makeLink(gmaps(l.poi), "Open in Google Maps"),
          makeLink(osmLink(l.poi), "See the place on OpenStreetMap"),
          makeElement("div", { className: "acts" }, show, rm),
        ),
      );
    }
    list.append(li);
  }
  if (force && namesOpenPano)
    list.querySelector('.row[aria-expanded="true"]')?.scrollIntoView({ block: "nearest" });
  $("namesTitle").textContent = q
    ? `${fmt(rows.length)} of ${fmt(named.length)} named locations`
    : `${fmt(named.length)} named ${named.length === 1 ? "location" : "locations"}`;
  const notes = [];
  if (!rows.length) notes.push(named.length ? "No name matches the filter." : "No named locations yet.");
  if (rows.length > NAMES_MAX)
    notes.push(`Showing the first ${fmt(NAMES_MAX)}. Type in the filter to narrow the list.`);
  if (unnamed)
    notes.push(
      `${fmt(unnamed)} ${unnamed === 1 ? "location has" : "locations have"} no name and ${unnamed === 1 ? "is" : "are"} not listed.`,
    );
  $("namesNote").textContent = notes.join(" ");
}
function toggleNames(on) {
  $("names").hidden = !on;
  $("stage").classList.toggle("listing", on);
  $("namesOpen").setAttribute("aria-expanded", String(on));
  if (on) {
    renderNames(true);
    $("namesFilter").focus();
  } else renderNames();
}
$("namesOpen").onclick = () => toggleNames($("names").hidden);
$("namesClose").onclick = () => toggleNames(false);
$("namesFilter").oninput = () => renderNames();

/* ---------- OpenStreetMap ---------- */
/* A failed search step, with a cause the page can explain. kind: timeout, memory, rate, busy,
   network, syntax, format or server (OpenStreetMap); key, google or internal (everything else). */
class SearchError extends Error {
  constructor(kind, detail) {
    super(kind);
    this.kind = kind;
    this.detail = detail || "";
  }
}
/* Error pages from servers come as HTML; this keeps only the words. */
const htmlToText = html =>
  String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
/* The servers to try, in groups: the public servers starting at number `first`, and the own server
   before or after them depending on its mode. */
function serverGroups(first) {
  const pub = OVERPASS.map((_, n) => {
    const url = OVERPASS[(first + n) % OVERPASS.length];
    return { url, host: hostOf(url) };
  });
  if (!osmOwn) return [pub];
  const mine = [{ url: osmOwn.url, host: `your own server (${hostOf(osmOwn.url)})`, own: true }];
  return osmOwn.mode === "fallback" ? [pub, mine] : [mine, pub];
}
/* Ask one group of servers in turn. Returns the elements, or throws a SearchError saying why none answered. */
async function overpassGroup(servers, query, signal, waitSeconds) {
  const tried = [];
  for (const { url, host, own: mine } of servers) {
    const t0 = Date.now(),
      secs = () => Math.round((Date.now() - t0) / 1000);
    const ctl = new AbortController();
    let gaveUp = false;
    const stop = () => ctl.abort();
    signal?.addEventListener("abort", stop);
    // Give the server 20 seconds more than the query's own time limit before giving up on it.
    const timer = setTimeout(
      () => {
        gaveUp = true;
        ctl.abort();
      },
      (waitSeconds + 20) * 1000,
    );
    try {
      const r = await fetch(url, {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        signal: ctl.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (r.status === 400)
        throw new SearchError(
          "syntax",
          `${host} answered HTTP 400: ${cleanText(htmlToText(await r.text().catch(() => "")), 400)}`,
        );
      if (r.status === 401 || r.status === 403) {
        tried.push({ host, kind: mine ? "denied" : "busy", note: `HTTP ${r.status}, access refused` });
        continue;
      }
      if (r.status === 429) {
        tried.push({ host, kind: "rate", note: "HTTP 429, too many requests" });
        continue;
      }
      if (r.status === 504) {
        tried.push({ host, kind: "busy", note: `HTTP 504, gateway timeout after ${secs()} s` });
        continue;
      }
      if (!r.ok) {
        tried.push({ host, kind: "busy", note: `HTTP ${r.status} after ${secs()} s` });
        continue;
      }
      let j;
      try {
        j = await r.json();
      } catch {
        tried.push({ host, kind: "format", note: "the answer was not readable data" });
        continue;
      }
      const remark = cleanText(j && j.remark, 400);
      if (/rate_limited|too many requests/i.test(remark)) {
        tried.push({ host, kind: "rate", note: remark });
        continue;
      }
      if (/timed out/i.test(remark)) throw new SearchError("timeout", `${host} after ${secs()} s: ${remark}`);
      if (/out of memory/i.test(remark))
        throw new SearchError("memory", `${host} after ${secs()} s: ${remark}`);
      if (/error/i.test(remark)) throw new SearchError("server", `${host} after ${secs()} s: ${remark}`);
      if (mine) osmUse.own++;
      else osmUse.pub++;
      return Array.isArray(j && j.elements) ? j.elements : [];
    } catch (e) {
      if (e instanceof SearchError) throw e;
      if (signal?.aborted) {
        const a = new Error("stopped");
        a.name = "AbortError";
        throw a;
      }
      if (gaveUp) throw new SearchError("timeout", `${host} sent no answer within ${secs()} s`);
      tried.push({
        host,
        kind: "network",
        note: `no connection (${cleanText(e && e.message, 80) || "request failed"})`,
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
  }
  const kinds = tried.map(t => t.kind);
  const kind = kinds.every(k => k === "network")
    ? "network"
    : kinds.includes("denied")
      ? "denied"
      : kinds.includes("rate")
        ? "rate"
        : kinds.includes("busy")
          ? "busy"
          : "format";
  throw new SearchError(kind, tried.map(t => `${t.host}: ${t.note}`).join("\n"));
}
/* Ask the servers in the order the settings call for: the user's own server first, or only after the public ones failed. */
async function overpass(query, signal, first = 0, waitSeconds = WORLD_TIMEOUT) {
  const groups = serverGroups(first),
    details = [];
  let last = null;
  for (const g of groups) {
    try {
      return await overpassGroup(g, query, signal, waitSeconds);
    } catch (e) {
      if (!(e instanceof SearchError)) throw e;
      if (g[0].own) osmUse.ownTrouble = e.detail;
      if (e.kind === "syntax") throw e; // the same query would be rejected again
      last = e;
      details.push(e.detail);
    }
  }
  last.detail = details.join("\n");
  throw last;
}
/* Plain-language title and advice for a failed OpenStreetMap request. */
function explainOsm(e, ctx) {
  const narrow = !ctx.kind
    ? "Choose fewer or smaller countries in step 2, or add a kind of place in step 1."
    : ctx.sc === "pick"
      ? 'Choose fewer countries in step 2, or add words under "Name contains" in step 1.'
      : 'Choose "Only the countries I choose" in step 2 and tick a few countries.';
  switch (e.kind) {
    case "timeout":
      return [
        "OpenStreetMap ran out of time",
        `The search took longer than the OpenStreetMap server allows, even after splitting it into smaller parts, so nothing was returned. That happens when there are too many places to go through. ${narrow}`,
      ];
    case "memory":
      return [
        "The search was too large for OpenStreetMap",
        `The server stopped because the result needed more memory than it allows for one search. ${narrow}`,
      ];
    case "rate":
      return [
        "OpenStreetMap is limiting your requests",
        'The free OpenStreetMap servers accept only a few searches from one person in a short time, and that limit was reached. Your settings are fine. Wait a minute or two, then select "Find locations" again.',
      ];
    case "busy":
      return [
        "The OpenStreetMap servers are overloaded",
        `Every server answered that it is too busy, or gave up part-way. If this was a large search, a smaller one may get through: ${narrow.charAt(0).toLowerCase() + narrow.slice(1)} Otherwise try again in a few minutes.`,
      ];
    case "network":
      return [
        "OpenStreetMap could not be reached",
        `None of the servers could be contacted. Check your internet connection. Ad blockers, script blockers and company firewalls can also block these addresses.`,
      ];
    case "denied":
      return [
        "Your own Overpass server refused the request",
        'It answered that the address or key is not accepted, or that your quota is used up, and the public servers did not answer either. Check the server address under "Expert" below the button.',
      ];
    case "syntax":
      return [
        "OpenStreetMap rejected the search",
        'The server could not read the query. This usually comes from an unusual character in a tag or a name in step 1. The exact query is under "Expert" below the button.',
      ];
    case "format":
      return [
        "OpenStreetMap sent an unreadable answer",
        "The servers answered, but not with place data. This is a problem on their side. Try again in a few minutes.",
      ];
    default:
      return [
        "OpenStreetMap reported an error",
        "The server answered with an error instead of places. The technical details show its message. Try again in a few minutes.",
      ];
  }
}
/* The Overpass query. codes: list of country codes, or null for the whole world.
   grouped: results arrive per country, each group led by its country area. */
function buildQuery(filter, codes, grouped = true, pretty = false, seconds = WORLD_TIMEOUT) {
  const nl = pretty ? "\n" : "",
    ind = pretty ? "  " : "";
  const body = (set, i) =>
    [
      `node${filter}${set};`,
      "out body;",
      `(way${filter}${set};relation${filter}${set};);`,
      "out tags center;",
    ]
      .map(l => i + l)
      .join(nl);
  const head = `[out:json][timeout:${seconds}];`;
  if (!codes) return head + nl + body("", "");
  const areas = `area["ISO3166-1"~"^(${codes.join("|")})$"]->.all;`;
  if (!grouped) return head + nl + areas + nl + body("(area.all)", "");
  return (
    head +
    nl +
    areas +
    nl +
    "foreach.all->.c(" +
    nl +
    ind +
    ".c out tags;" +
    nl +
    body("(area.c)", ind) +
    nl +
    ");"
  );
}
/* Reads Overpass elements into byId (a Map of Place by "node123", "way45", …). In a grouped answer each
   country's places follow an element of type "area" naming the country. fallbackCc: country to use when
   the answer names none. stats.noPosition counts elements without a position. */
function mergeElements(els, byId, fallbackCc, stats) {
  if (!Array.isArray(els)) return;
  let cc = fallbackCc;
  for (const e of els) {
    if (!e || typeof e !== "object") continue;
    if (e.type === "area") {
      const c = e.tags?.["ISO3166-1"];
      cc = typeof c === "string" && /^[A-Z]{2}$/.test(c) ? c : fallbackCc;
      continue;
    }
    if (e.type !== "node" && e.type !== "way" && e.type !== "relation") continue;
    if (!Number.isSafeInteger(e.id) || e.id < 0) continue;
    const lat = e.lat ?? e.center?.lat,
      lng = e.lon ?? e.center?.lon;
    if (!inRange(lat, -90, 90) || !inRange(lng, -180, 180)) {
      if (stats) stats.noPosition++;
      continue;
    }
    const id = e.type + e.id,
      had = byId.get(id);
    if (had && !(PARENTS.has(had.cc) && cc && !PARENTS.has(cc))) continue; // keep the more specific territory
    byId.set(id, {
      id: e.id,
      type: e.type,
      lat,
      lng,
      cc,
      name: cleanText(e.tags?.["name:en"]) || cleanText(e.tags?.name),
    });
  }
}
/* ---------- your own Overpass result ---------- */
const OWN_MAX_BYTES = 300 * 1024 * 1024,
  OWN_MANY = 200000;
/* Turn the text of a "raw OSM data" JSON export into places. Throws a readable message for anything else. */
function parseOwn(raw) {
  const t = String(raw).trim();
  const how =
    ' In Overpass Turbo choose Export, then Data, then "raw OSM data", from a query that starts with [out:json].';
  if (!t) throw new Error("There is nothing to read. Choose a file or paste the raw OSM data first.");
  if (t[0] === "<")
    throw new Error(
      "This is XML, not JSON. Add [out:json] as the first line of the query, run it again and export once more." +
        how,
    );
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    throw new Error("This is not valid JSON. It may be cut off, or a different export format." + how);
  }
  if (j && (j.type === "FeatureCollection" || j.type === "Feature" || Array.isArray(j.features)))
    throw new Error("This is GeoJSON. Only raw OSM data is accepted." + how);
  if (j && Array.isArray(j.customCoordinates))
    throw new Error("This is a map-making.app file, not an Overpass result." + how);
  if (!j || !Array.isArray(j.elements))
    throw new Error('This JSON has no "elements" list, so it is not raw OSM data.' + how);
  if (!j.elements.length)
    throw new Error(
      `The result is empty${j.remark ? ": " + cleanText(j.remark, 200) : ""}. Check the query in Overpass Turbo.`,
    );

  // Positions of plain nodes, and which nodes only exist as corner points of outlines.
  const at = new Map(),
    corner = new Set();
  for (const e of j.elements) {
    if (!e || typeof e !== "object") continue;
    if (e.type === "node" && inRange(e.lat, -90, 90) && inRange(e.lon, -180, 180)) at.set(e.id, e);
    if (e.type === "way" && Array.isArray(e.nodes)) for (const n of e.nodes) corner.add(n);
    if (e.type === "relation" && Array.isArray(e.members))
      for (const m of e.members) if (m && m.type === "node") corner.add(m.ref);
  }
  const middle = pts => {
    let a = 90,
      b = -90,
      c = 180,
      d = -180,
      n = 0;
    for (const q of pts)
      if (q && inRange(q.lat, -90, 90) && inRange(q.lon, -180, 180)) {
        a = Math.min(a, q.lat);
        b = Math.max(b, q.lat);
        c = Math.min(c, q.lon);
        d = Math.max(d, q.lon);
        n++;
      }
    return n ? { lat: (a + b) / 2, lon: (c + d) / 2 } : null;
  };
  const els = [];
  let lines = 0,
    worked = 0;
  for (let e of j.elements) {
    if (!e || typeof e !== "object") continue;
    if (e.type === "node" && !e.tags && corner.has(e.id)) continue; // corner point of an outline, not a place
    if ((e.type === "way" || e.type === "relation") && !e.center) {
      const bb = e.bounds;
      let c =
        bb &&
        inRange(bb.minlat, -90, 90) &&
        inRange(bb.maxlat, -90, 90) &&
        inRange(bb.minlon, -180, 180) &&
        inRange(bb.maxlon, -180, 180)
          ? { lat: (bb.minlat + bb.maxlat) / 2, lon: (bb.minlon + bb.maxlon) / 2 }
          : null;
      if (!c && Array.isArray(e.geometry)) c = middle(e.geometry);
      if (!c && Array.isArray(e.nodes)) c = middle(e.nodes.map(n => at.get(n)));
      if (!c && Array.isArray(e.members))
        c = middle(
          e.members.flatMap(m =>
            !m
              ? []
              : Array.isArray(m.geometry)
                ? m.geometry
                : m.type === "node"
                  ? [inRange(m.lat, -90, 90) ? m : at.get(m.ref)]
                  : [],
          ),
        );
      if (c) {
        e = { ...e, center: c };
        worked++;
      }
    }
    if (e.type === "way") {
      const ring = Array.isArray(e.nodes)
        ? e.nodes
        : Array.isArray(e.geometry)
          ? e.geometry.map(g => g && g.lat + "," + g.lon)
          : null;
      if (ring && ring.length > 1 && ring[0] !== ring[ring.length - 1]) lines++;
    }
    els.push(e);
  }
  const byId = new Map(),
    stats = { noPosition: 0 };
  mergeElements(els, byId, undefined, stats);
  const places = [...byId.values()];
  if (!places.length)
    throw new Error(
      stats.noPosition
        ? `None of the ${fmt(stats.noPosition)} objects in this result has a position. End the query with "out center;" and export again.`
        : "This result contains no nodes, ways or relations to use as places.",
    );
  return {
    places,
    noPosition: stats.noPosition,
    lines,
    worked,
    hasCc: places.some(p => p.cc),
    countries: new Set(places.map(p => p.cc).filter(Boolean)).size,
  };
}

/* Countries grouped into parts of similar cost, the cheapest parts first. */
function makeParts(codes) {
  const bins = [];
  for (const c of [...codes].sort((x, y) => countryWeight(y) - countryWeight(x))) {
    let bin = bins.find(b => b.w + countryWeight(c) <= PART_WEIGHT);
    if (!bin) {
      bin = { codes: [], w: 0, top: 0 };
      bins.push(bin);
    }
    bin.codes.push(c);
    bin.w += countryWeight(c);
    bin.top = Math.max(bin.top, countryWeight(c));
  }
  return bins.sort((x, y) => x.top - y.top || x.w - y.w).map(b => b.codes);
}
/* Splits a part that was too big into two of about equal weight. */
function halve(codes) {
  const a = [],
    b = [];
  let wa = 0,
    wb = 0;
  for (const c of [...codes].sort((x, y) => countryWeight(y) - countryWeight(x))) {
    if (wa <= wb) {
      a.push(c);
      wa += countryWeight(c);
    } else {
      b.push(c);
      wb += countryWeight(c);
    }
  }
  return [a, b];
}
/* Waits ms milliseconds; stops early with an AbortError when the search is stopped. */
const pause = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", stop);
      resolve();
    }
    function stop() {
      clearTimeout(t);
      const e = new Error("stopped");
      e.name = "AbortError";
      reject(e);
    }
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop);
  });
/* Fetch the places. codes: list of country codes, or null for the whole world.
   Countries are requested a few at a time. A part that is too big for the server is split in two and
   tried again; a single country that still fails is skipped. Returns { places, skipped }. */
async function fetchPlaces(filter, codes, signal, onProgress = () => {}) {
  const byId = new Map();
  if (!codes) {
    mergeElements(await overpass(buildQuery(filter, null), signal), byId);
    return { places: [...byId.values()], skipped: [] };
  }

  const queue = makeParts(codes),
    total = weightOf(codes),
    skipped = [],
    failures = [];
  const inner = new AbortController(),
    stopInner = () => inner.abort();
  signal?.addEventListener("abort", stopInner);
  let grouped = true,
    active = 0,
    done = 0,
    okParts = 0,
    sent = 0,
    waiting = false;
  const report = () =>
    onProgress({ fraction: done / total, places: byId.size, skipped: skipped.length, waiting });

  const request = async part => {
    for (let attempt = 0; ; attempt++) {
      const asked = grouped;
      try {
        return await overpass(
          buildQuery(filter, part, asked, false, PART_TIMEOUT),
          inner.signal,
          sent++,
          PART_TIMEOUT,
        );
      } catch (e) {
        if (e.kind === "syntax" && asked) {
          grouped = false;
          continue;
        } // older server: ask without country grouping
        if (e.kind === "rate" && attempt < 3) {
          waiting = true;
          report();
          await pause(RATE_WAIT, inner.signal);
          waiting = false;
          report();
          continue;
        }
        throw e;
      }
    }
  };
  const runPart = async part => {
    let els;
    try {
      els = await request(part);
    } catch (e) {
      if (!["timeout", "memory", "busy"].includes(e.kind)) throw e;
      failures.push(`${part.length === 1 ? countryName(part[0]) : part.length + " countries"}: ${e.detail}`);
      // Nothing has worked and even the cheapest parts fail: this search is too heavy, stop instead of grinding on.
      if (!okParts && failures.length >= 3) throw new SearchError(e.kind, failures.join("\n"));
      if (part.length > 1) {
        queue.unshift(...halve(part));
        return;
      }
      skipped.push(part[0]);
      done += countryWeight(part[0]);
      report();
      return;
    }
    mergeElements(els, byId, part.length === 1 ? part[0] : undefined);
    okParts++;
    done += weightOf(part);
    report();
  };
  // OSM_PARALLEL workers take parts from the queue. A worker that finds the queue empty waits while the
  // others still run, as a failed part may put two halves back.
  const worker = async () => {
    for (;;) {
      const part = queue.shift();
      if (!part) {
        if (!active) return;
        await pause(150, inner.signal);
        continue;
      }
      active++;
      try {
        await runPart(part);
      } finally {
        active--;
      }
    }
  };
  try {
    report();
    await Promise.all(Array.from({ length: OSM_PARALLEL }, worker));
  } catch (e) {
    inner.abort();
    throw e;
  } finally {
    signal?.removeEventListener("abort", stopInner);
  }
  if (!okParts && skipped.length) throw new SearchError("timeout", failures.join("\n"));
  return { places: [...byId.values()], skipped };
}

/* ---------- Google Street View ---------- */
// Two ways to ask Google: the Street View metadata web service (lookupRest), which is free of charge,
// and Google's Maps JavaScript API (lookupScript). The web service is used whenever it works. The script
// is needed when the browser cannot reach the web service, to search official coverage only, and to
// read street names (roadInfo).
let restWorked = false,
  jsService = null;
/* Keep only well-formed values from a Street View answer. */
function cleanPano(r) {
  const status = cleanText(r.status, 40) || "NO_STATUS";
  if (status !== "OK") return { status, detail: cleanText(r.detail, 300) };
  if (!inRange(r.lat, -90, 90) || !inRange(r.lng, -180, 180))
    return { status: "MALFORMED", detail: "the answer had no usable position" };
  if (typeof r.panoId !== "string" || !/^[^\s<>"'`\\]{4,300}$/.test(r.panoId))
    return {
      status: "MALFORMED",
      detail: `the panorama ID had an unexpected form (${cleanText(String(r.panoId), 40)})`,
    };
  const date = cleanText(r.date, 10);
  return {
    status,
    lat: r.lat,
    lng: r.lng,
    panoId: r.panoId,
    copyright: cleanText(r.copyright),
    date: /^\d{4}(-\d{2})?$/.test(date) ? date : "",
  };
}
/* Nearest outdoor panorama within radius metres, from the metadata web service. @returns {Promise<PanoAnswer>} */
async function lookupRest(p, radius, key, signal) {
  const u = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${p.lat},${p.lng}&radius=${radius}&source=outdoor&key=${encodeURIComponent(key)}`;
  const r = await fetch(u, { signal });
  const j = await r.json();
  restWorked = true;
  return cleanPano({
    status: j.status,
    lat: j.location?.lat,
    lng: j.location?.lng,
    panoId: j.pano_id,
    copyright: j.copyright,
    date: j.date,
    detail: j.error_message,
  });
}
let scriptPrimary = false,
  scriptBroken = false;
/* Loads Google's Maps JavaScript API once and resolves to its StreetViewService. Fails ("denied" or
   "unreachable") if the key is refused or nothing usable loads within 12 seconds. */
function loadGoogleScript(key) {
  return (jsService ??= new Promise((resolve, reject) => {
    const giveUp = setTimeout(() => {
      scriptBroken = true;
      reject(new Error("unreachable"));
    }, 12000); // loaded nothing usable
    window.gm_authFailure = () => {
      scriptBroken = true;
      reject(new Error("denied"));
    };
    window.__lookoutReady = () =>
      google.maps.importLibrary("streetView").then(lib => {
        clearTimeout(giveUp);
        resolve(new lib.StreetViewService());
      }, reject);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__lookoutReady`;
    s.onerror = () => {
      scriptBroken = true;
      reject(new Error("unreachable"));
    };
    document.head.append(s);
  }));
}
/* sources: "outdoor" for any outdoor panorama; "google" limits the search to official Google coverage. */
async function lookupScript(p, radius, key, sources = ["outdoor"]) {
  const sv = await loadGoogleScript(key);
  return new Promise(resolve => {
    setTimeout(() => resolve({ status: "NETWORK" }), 15000); // never wait forever for the script to answer
    sv.getPanorama(
      { location: { lat: p.lat, lng: p.lng }, radius, sources, preference: "nearest" },
      (d, status) => {
        if (status !== "OK" || !d?.location) return resolve({ status: cleanText(status, 40) || "NO_STATUS" });
        resolve(
          cleanPano({
            status: "OK",
            lat: d.location.latLng?.lat(),
            lng: d.location.latLng?.lng(),
            panoId: d.location.pano,
            copyright: d.copyright,
            date: d.imageDate,
          }),
        );
      },
    );
  });
}
/* Nearest panorama for a place. Uses the web service, and switches to Google's script for good if the
   web service cannot be reached at all. A network error after it has worked once counts as a failed
   lookup instead. @returns {Promise<PanoAnswer>} */
async function lookup(p, radius, key, signal, officialOnly) {
  if (!scriptPrimary) {
    try {
      return await lookupRest(p, radius, key, signal);
    } catch (e) {
      if (e.name === "AbortError") throw e;
      if (restWorked) return { status: "NETWORK" };
      scriptPrimary = true;
    }
  }
  return lookupScript(p, radius, key, officialOnly ? ["google", "outdoor"] : ["outdoor"]);
}
/* A second look for official coverage, used when the nearest panorama was uploaded by someone else.
   First choice: Google's script, which can search official coverage only. If the script cannot be used
   with this key, probe six points around the place with the ordinary lookup and keep the closest official answer. */
let officialVia = "";
/* The point a given distance and direction away (good enough for short distances; 111,320 m per degree). */
function offsetPoint(p, metres, bearingDeg) {
  const t = toRadians(bearingDeg);
  return {
    lat: p.lat + (metres * Math.cos(t)) / 111320,
    lng: p.lng + (metres * Math.sin(t)) / (111320 * Math.max(0.01, Math.cos(toRadians(p.lat)))),
  };
}
async function officialNearby(p, maxDist, key, signal) {
  if (!scriptBroken) {
    try {
      const r = await lookupScript(p, Math.ceil(maxDist), key, ["google", "outdoor"]);
      if (!scriptBroken && (r.status === "OK" || r.status === "ZERO_RESULTS")) {
        officialVia = "script";
        return r;
      }
    } catch {
      scriptBroken = true;
    } // the script cannot be used with this key or connection
  }
  if (scriptPrimary) return { status: "ZERO_RESULTS" };
  officialVia = "ring";
  // Six points around the place, a little over half the distance out, each searched with a radius that
  // overlaps its neighbours, so that together they roughly cover the circle within maxDist.
  const answers = await Promise.all(
    [0, 60, 120, 180, 240, 300].map(b =>
      lookupRest(offsetPoint(p, maxDist * 0.55, b), Math.ceil(maxDist * 0.6), key, signal).catch(e => {
        if (e.name === "AbortError") throw e;
        return { status: "NETWORK" };
      }),
    ),
  );
  let best = null;
  for (const a of answers) {
    if (a.status !== "OK" || !isOfficial(a.copyright)) continue;
    const d = distance(a.lat, a.lng, p.lat, p.lng);
    if (!best || d < best.d) best = { ...a, d };
  }
  return best || { status: "ZERO_RESULTS" };
}
/* Does Street View show a street name at this panorama? The names are the labels of the links to the
   neighbouring panoramas, which only Google's script returns. state: "has", "none" or "unknown". */
async function roadInfo(panoId, key) {
  if (scriptBroken) return { state: "unknown" };
  let sv;
  try {
    sv = await loadGoogleScript(key);
  } catch {
    scriptBroken = true;
    return { state: "unknown" };
  }
  return new Promise(resolve => {
    const t = setTimeout(() => resolve({ state: "unknown" }), 15000);
    sv.getPanorama({ pano: panoId }, (d, status) => {
      clearTimeout(t);
      if (status !== "OK" || !d || scriptBroken) return resolve({ state: "unknown" });
      const names = (Array.isArray(d.links) ? d.links : [])
        .map(l => cleanText(l && l.description, 120).trim())
        .filter(Boolean);
      resolve(names.length ? { state: "has", name: names[0] } : { state: "none" });
    });
  });
}
/* Answers worth asking again, after a short wait. */
const RETRY = new Set(["OVER_QUERY_LIMIT", "UNKNOWN_ERROR", "NETWORK"]);
/* Why a lookup failed, in plain words: { key (for counting), short, text }. */
function failReason(r) {
  switch (r.status) {
    case "OVER_QUERY_LIMIT":
      return {
        key: "limit",
        short: "Google's request limit",
        text: "Google's request limit was reached: too many requests per minute, or the daily quota set on the API key.",
      };
    case "UNKNOWN_ERROR":
      return {
        key: "temporary",
        short: "a temporary error at Google",
        text: "Google reported a temporary error on its side.",
      };
    case "NETWORK":
      return {
        key: "network",
        short: "a connection problem",
        text: "The request did not reach Google. That points to a connection problem or a blocker in the browser.",
      };
    case "MALFORMED":
      return {
        key: "malformed",
        short: "an unexpected answer from Google",
        text: `Google's answer could not be used: ${r.detail || "it had an unexpected form"}.`,
      };
    case "INVALID_REQUEST":
      return {
        key: "invalid",
        short: "a request Google called invalid",
        text: "Google said the request was invalid.",
      };
    default:
      return {
        key: "other",
        short: `the answer "${cleanText(r.status, 40)}"`,
        text: `Google answered "${cleanText(r.status, 40)}".`,
      };
  }
}
/* Official Google coverage says "© 2024 Google" (or "Google LLC"); photos from others name the uploader. */
const isOfficial = c =>
  c
    .replace(/[©\d\s]/g, "")
    .replace(/LLC|Inc\.?/gi, "")
    .replace(/[,.]/g, "") === "Google";

/* ---------- run ---------- */
let results = [],
  running = false,
  abort = null,
  lastName = "",
  ticker = 0;
/* The places from the last successful OpenStreetMap search, kept so Street View can be checked again
   with other settings: { places, skipped, label, name, where } */
let lastFetch = null;
function renderAgain() {
  const on = !!lastFetch && !ownResult;
  $("againBox").hidden = !on;
  $("again").disabled = running;
  if (on)
    $("againHint").textContent =
      `Uses the ${fmt(lastFetch.places.length)} ${lastFetch.places.length === 1 ? "place" : "places"} already found for "${lastFetch.label}" (${lastFetch.where}) with the settings in step 3. OpenStreetMap is not asked again.`;
}
/* Counters for one search, shown under the map: places found, checked, left out (none, far, close,
   unofficial, dup = shares a panorama with another place), failed lookups and why, places rescued by
   the second official-only look, road name results, countries skipped, and progress from 0 to 1. */
const emptyStats = () => ({
  places: 0,
  checked: 0,
  none: 0,
  far: 0,
  close: 0,
  unofficial: 0,
  dup: 0,
  failed: 0,
  failWhy: {},
  rescued: 0,
  road: { has: 0, none: 0, unknown: 0 },
  skipped: 0,
  progress: 0,
});
let searchStats = emptyStats();

/* Shows a message next to the button. type: "note" or "error"; empty text hides it. */
function show(type, text) {
  const m = $("message");
  m.hidden = !text;
  m.className = "msg " + type;
  m.textContent = text || "";
  if (!text) $("fail").hidden = true;
}
/* A search that stopped with an error: explained on the map and next to the button. */
function fail(title, text, detail, canRetry) {
  $("failRetry").hidden = !canRetry;
  const m = $("message");
  m.hidden = false;
  m.className = "msg error";
  m.textContent = "";
  const b = document.createElement("b");
  b.textContent = title;
  m.append(b, text);
  $("failTitle").textContent = title;
  $("failText").textContent = text;
  $("failMore").hidden = !detail;
  $("failMore").open = false;
  $("failDetail").textContent = detail || "";
  $("fail").hidden = false;
  $("empty").hidden = true;
}
$("failClose").onclick = () => {
  $("fail").hidden = true;
  paint();
};
$("failRetry").onclick = () => {
  if (!running) startSearch(null);
};
/* Updates the counters, progress bar and buttons from searchStats and results. now: new status line. */
function paint(now) {
  if (now) $("now").textContent = now;
  $("count").textContent = fmt(results.length);
  $("fill").style.width = Math.min(100, 100 * searchStats.progress) + "%";
  const t = [];
  if (searchStats.places)
    t.push(
      `<span><b>${fmt(searchStats.places)}</b> places on OpenStreetMap</span>`,
      `<span><b>${fmt(searchStats.checked)}</b> checked</span>`,
    );
  if (searchStats.none) t.push(`<span><b>${fmt(searchStats.none)}</b> without Street View nearby</span>`);
  if (searchStats.far + searchStats.close)
    t.push(`<span><b>${fmt(searchStats.far + searchStats.close)}</b> outside your distance</span>`);
  if (searchStats.unofficial)
    t.push(`<span><b>${fmt(searchStats.unofficial)}</b> not official coverage</span>`);
  if (searchStats.dup) t.push(`<span><b>${fmt(searchStats.dup)}</b> duplicates</span>`);
  if (searchStats.road.has + searchStats.road.none)
    t.push(
      `<span><b>${fmt(searchStats.road.has)}</b> with a road name, <b>${fmt(searchStats.road.none)}</b> without</span>`,
    );
  if (searchStats.rescued)
    t.push(`<span><b>${fmt(searchStats.rescued)}</b> found by a second, official-only look</span>`);
  if (searchStats.failed) t.push(`<span><b>${fmt(searchStats.failed)}</b> lookups failed</span>`);
  if (searchStats.skipped)
    t.push(
      `<span><b>${fmt(searchStats.skipped)}</b> ${searchStats.skipped === 1 ? "country" : "countries"} left out</span>`,
    );
  if (removed.length)
    t.push(
      `<span><b>${fmt(removed.length)}</b> removed by you <button type="button" class="undo" id="undo">Undo</button></span>`,
    );
  if (!running && map && searchStats.checked > results.length + removed.length)
    t.push(
      `<span class="key"><i></i>Select a muted dot to see why a place was left out, with a Google Maps link.</span>`,
    );
  $("tally").innerHTML = t.join("");
  $("download").disabled = $("copy").disabled = !results.length;
  renderNames();
  $("empty").hidden = results.length > 0 || running || !$("fail").hidden;
}
/* phase: 1 = asking OpenStreetMap, 2 = checking Street View, 0 = idle */
let phaseSub = "";
function setPhase(phase, title, sub) {
  clearInterval(ticker);
  $("track").classList.remove("osm");
  running = phase > 0;
  $("fields").disabled = running;
  renderAgain();
  $("go").innerHTML = running ? `<span class="spin"></span>Stop` : "Find locations";
  $("go").classList.toggle("stop", running);
  $("track").classList.toggle("busy", phase === 1);
  $("live").hidden = !running;
  $("live").classList.toggle("corner", phase === 2);
  $("st1").className = phase === 1 ? "on" : "done";
  $("st2").className = phase === 2 ? "on" : "";
  if (!running) return;
  $("liveTitle").textContent = title;
  if (phase === 1) {
    const t0 = Date.now();
    phaseSub = sub;
    const tick = () => {
      const s = Math.round((Date.now() - t0) / 1000);
      $("liveSub").textContent = `${phaseSub} ${s} s so far.`;
    };
    tick();
    ticker = setInterval(tick, 1000);
  } else $("liveSub").textContent = sub;
}

$("form").onsubmit = ev => {
  ev.preventDefault();
  if (running) abort?.abort();
  else startSearch(null);
};
$("again").onclick = () => {
  if (!running && lastFetch && !ownResult) startSearch(lastFetch);
};
/* Runs a search: checks the settings, gets the places (from OpenStreetMap, the user's own result, or
   `reuse`), then checks Street View for each until "Locations wanted" is reached or all are checked.
   reuse: the kept result of an earlier OpenStreetMap search (lastFetch), to check Street View on it again. */
async function startSearch(reuse) {
  if (running) return;
  show("", "");
  // Places that are already there: an earlier search result, or the user's own Overpass result.
  const ownRun =
    reuse ||
    (ownResult ? { places: ownResult.places, skipped: [], label: ownLabel(), name: ownLabel() } : null);
  let words = [];
  if (!ownRun) {
    if (!kind) {
      // typed but not picked: accept an exact catalogue name
      const hit = searchCatalogue(kindEl.value, 1)[0];
      if (hit && foldAccents(hit.label) === foldAccents(kindEl.value.trim())) choose(hit);
    }
    words = nameWords();
    if (!kind && kindEl.value.trim())
      return show("error", "Pick one of the suggestions in step 1, or write a tag as key=value.");
    if (!kind && !words.length) return show("error", "Choose a kind of place or enter a name in step 1.");
  }
  const key = GOOGLE_API_KEY || $("apiKey").value.trim();
  const maxDist = Math.max(5, +$("maxDist").value || 50);
  const minDist = Math.max(0, +$("minDist").value || 0);
  const target = Math.max(1, Math.floor(+$("target").value || 1000));
  const official = $("official").checked,
    addTags = $("tags").checked,
    addCountry = $("tagCountry").checked,
    addName = $("tagName").checked,
    addRoad = $("tagRoad").checked;
  const sc = scope(),
    label = ownRun ? ownRun.label : searchLabel();
  const codes = ownRun || sc === "world" ? null : sc === "cov" ? [...COVERAGE] : [...selected];
  let filter = "";
  if (!ownRun) {
    try {
      filter = (kind ? tagFilter(kind.tag) : "") + nameFilter();
    } catch (e) {
      return show("error", e.message);
    }
  }
  if (!key) return show("error", `Enter a Google API key in step ${lastStep()}.`);
  if (minDist >= maxDist) return show("error", "The smallest distance has to be below the largest distance.");
  if (codes && !codes.length) return show("error", "Tick one or more countries in step 2.");
  if (!ownRun && !kind && sc !== "pick")
    return show(
      "error",
      `A name search without a kind of place has to read everything on the map, which is too much for this many countries. Choose "Only the countries I choose" in step 2, or add a kind of place.`,
    );
  if (!ownRun && kind && !words.length && sc !== "pick" && kind.count > TOO_MANY)
    return show(
      "error",
      `There are about ${fmt(kind.count)} of these worldwide, too many to search at once. Choose "Only the countries I choose" in step 2.`,
    );

  for (const id of ["maxDist", "minDist", "target"]) store.set(id, $(id).value);
  store.set("official", official);
  store.set("tagKind", addTags);
  store.set("tagCountry", addCountry);
  store.set("tagName", addName);
  store.set("tagRoad", addRoad);
  if (!GOOGLE_API_KEY) keyStore.set(key);

  lastName = $("mapName").value.trim() || (ownRun ? ownRun.name : $("mapName").placeholder);
  results = [];
  removed = [];
  searchStats = emptyStats();
  $("fail").hidden = true;
  layer?.clearLayers();
  dots?.clearLayers();
  initMap();
  abort = new AbortController();
  const signal = abort.signal;
  const whereText = !codes
    ? "the whole world"
    : codes.length === 1
      ? countryName(codes[0])
      : `${codes.length} countries`;
  if (!ownRun) {
    setPhase(1, `Looking up "${label}" on OpenStreetMap`, `Searching ${whereText}.`);
    paint("Asking OpenStreetMap for places…");
  }
  if (matchMedia("(max-width:860px)").matches) $("stage").scrollIntoView({ behavior: "smooth" });

  let fatal = null;
  const notes = [];
  osmUse.own = osmUse.pub = 0;
  osmUse.ownTrouble = "";
  try {
    // 1. places
    let places, skipped;
    if (ownRun) {
      places = ownRun.places.map(p => ({ ...p }));
      skipped = ownRun.skipped;
    } else
      try {
        ({ places, skipped } = await fetchPlaces(filter, codes, signal, p => {
          if (p.fraction > 0) {
            $("track").classList.remove("busy");
            $("track").classList.add("osm");
          }
          searchStats.progress = p.fraction;
          searchStats.places = p.places;
          paint();
          phaseSub = p.waiting
            ? "The servers asked to slow down. Waiting 20 seconds before continuing."
            : `Searching ${whereText}. ${Math.round(p.fraction * 100)}% done, ${fmt(p.places)} ${p.places === 1 ? "place" : "places"} so far.`;
        }));
      } catch (e) {
        if (e instanceof SearchError) {
          const [title, text] = explainOsm(e, { sc, kind });
          e.title = title;
          e.text = text;
          e.retry = true;
        }
        throw e;
      }
    searchStats.places = places.length;
    searchStats.progress = 0;
    searchStats.skipped = skipped.length;
    if (!ownRun && osmOwn) {
      if (osmOwn.mode === "first" && osmUse.ownTrouble && osmUse.pub)
        notes.push(
          `Your own Overpass server could not be used for ${osmUse.own ? "part of" : ""} this search (${osmUse.ownTrouble.split("\n")[0].replace(/^.*?: /, "")}), so the public servers answered instead.`.replace(
            "  ",
            " ",
          ),
        );
      if (osmOwn.mode === "fallback" && osmUse.own)
        notes.push(
          `The public servers failed for ${osmUse.pub ? "part of" : ""} this search; your own Overpass server answered instead.`.replace(
            "  ",
            " ",
          ),
        );
    }
    if (skipped.length)
      notes.push(
        `${skipped.length === 1 ? "One country was" : skipped.length + " countries were"} left out because OpenStreetMap could not read ${skipped.length === 1 ? "it" : "them"} in time: ${skipped.map(countryName).join(", ")}. To include ${skipped.length === 1 ? "it" : "them"}, search ${skipped.length === 1 ? "it" : "them"} separately with "Only the countries I choose", ideally with a name filter.`,
      );
    if (!places.length && skipped.length)
      throw Object.assign(new Error(`Nothing was found in the countries that could be read. ${notes[0]}`), {
        plain: true,
      });
    if (!places.length)
      throw Object.assign(
        new Error(
          words.length
            ? "OpenStreetMap has no places with that name in the chosen area. Names are in the local language, so try other spellings."
            : kind.count === 0 || kind.raw
              ? "OpenStreetMap has no places with this tag in the chosen area. Check the spelling of the tag."
              : "OpenStreetMap has no places of this kind in the chosen area.",
        ),
        { plain: true },
      );
    if (!ownRun)
      lastFetch = { places: places.map(p => ({ ...p })), skipped, label, name: lastName, where: whereText };
    shuffle(places);
    drawCandidates(places);
    setPhase(2, "Checking Street View", `${fmt(places.length)} places to check.`);
    paint("Checking Street View near each place…");

    // 2. Street View
    const seen = new Set();
    let next = 0,
      lastPaint = 0;
    const tagList = loc => [
      ...(addTags ? [label] : []),
      ...(addName && loc.poi.name ? [loc.poi.name] : []),
      ...(addCountry && loc.poi.cc ? [countryName(loc.poi.cc)] : []),
      ...(addRoad && loc.road === "has"
        ? ["Has road name"]
        : addRoad && loc.road === "none"
          ? ["No road name"]
          : []),
    ];
    const worker = async () => {
      while (next < places.length && results.length < target && !signal.aborted && !fatal) {
        const p = places[next++];
        let r,
          tries = 0;
        for (;;) {
          r = await lookup(p, Math.ceil(maxDist), key, signal, official);
          // up to three more tries, waiting 1.5, 3 and 4.5 seconds
          if (RETRY.has(r.status) && tries++ < 3) {
            await sleep(1500 * tries);
            continue;
          }
          break;
        }
        searchStats.checked++;
        if (r.status === "REQUEST_DENIED") {
          fatal = new SearchError(
            "key",
            r.detail ? "Google answered REQUEST_DENIED: " + r.detail : "Google answered REQUEST_DENIED.",
          );
          break;
        }
        if (r.status === "OK") {
          let second = false;
          if (official && !isOfficial(r.copyright)) {
            // nearest is someone's own photo: look again for official coverage
            const r2 = await officialNearby(p, maxDist, key, signal);
            if (r2.status === "OK" && isOfficial(r2.copyright)) {
              r = r2;
              second = true;
            }
          }
          const d = distance(r.lat, r.lng, p.lat, p.lng);
          const m = Math.round(d);
          if (official && !isOfficial(r.copyright)) {
            searchStats.unofficial++;
            markMissed(
              p,
              `Within ${maxDist} m there are only photos uploaded by other people, no official Google coverage.`,
              r,
            );
          } else if (d > maxDist) {
            searchStats.far++;
            markMissed(p, `The nearest Street View is ${m} m away, beyond your ${maxDist} m.`, r);
          } else if (d < minDist) {
            searchStats.close++;
            markMissed(p, `The nearest Street View is only ${m} m away, closer than your ${minDist} m.`, r);
          } else if (seen.has(r.panoId)) {
            searchStats.dup++;
            markMissed(p, "Shares its Street View spot with another place on the map.", r);
          } else if (results.length < target) {
            seen.add(r.panoId);
            if (second) searchStats.rescued++;
            if (p.dot) {
              dots.removeLayer(p.dot);
              p.dot = null;
            }
            const loc = {
              lat: r.lat,
              lng: r.lng,
              heading: bearing(r.lat, r.lng, p.lat, p.lng),
              panoId: r.panoId,
              date: r.date,
              dist: d,
              poi: p,
            };
            loc.tags = tagList(loc);
            results.push(loc);
            drawLocation(loc);
            if (addRoad) {
              // ask Google whether a street name is shown at this spot
              const info = await roadInfo(loc.panoId, key);
              loc.road = info.state;
              loc.roadName = info.name || "";
              searchStats.road[info.state]++;
              loc.tags = tagList(loc);
            }
          }
        } else if (r.status === "ZERO_RESULTS" || r.status === "NOT_FOUND") {
          searchStats.none++;
          markMissed(p, `No Street View within ${maxDist} m.`);
        } else {
          const why = failReason(r),
            n = Math.min(tries, 3) + 1;
          searchStats.failed++;
          searchStats.failWhy[why.key] = { n: (searchStats.failWhy[why.key]?.n || 0) + 1, short: why.short };
          markMissed(p, `The Street View lookup failed${n > 1 ? ` after ${n} tries` : ""}. ${why.text}`);
        }
        searchStats.progress = Math.max(results.length / target, searchStats.checked / places.length);
        // redraw at most about seven times a second; drawing after every lookup would slow the page down
        if (performance.now() - lastPaint > 150) {
          lastPaint = performance.now();
          paint();
          $("liveSub").textContent =
            `${fmt(results.length)} found, ${fmt(searchStats.checked)} of ${fmt(places.length)} checked.`;
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (fatal) throw fatal;
    searchStats.progress = 1;
    setPhase(0);
    if (signal.aborted) paint(`Stopped. ${fmt(results.length)} locations so far.`);
    else if (results.length >= target)
      paint(
        target === 1
          ? "Done. Found the location you asked for."
          : `Done. Found the ${fmt(target)} locations you asked for.`,
      );
    else {
      paint(
        `Done. Every place was checked; ${fmt(results.length)} ${results.length === 1 ? "has" : "have"} Street View within range.`,
      );
      if (!results.length && !searchStats.failed)
        notes.push(
          `No place had Street View within your distance. Try a larger distance in step ${lastStep()}.`,
        );
    }
    if (searchStats.failed && !signal.aborted) {
      const why = Object.entries(searchStats.failWhy).sort((x, y) => y[1].n - x[1].n),
        top = why[0][0];
      const advice =
        top === "limit"
          ? "Wait a few minutes, or check the key's quota in the Google Cloud console, then run the search again."
          : top === "network"
            ? "Check your connection and any blockers, then run the search again."
            : top === "malformed" || top === "invalid" || top === "other"
              ? "This should not happen; pass the reason on to whoever runs this page."
              : "Run the search again later to pick them up.";
      notes.push(
        `${fmt(searchStats.failed)} Street View ${searchStats.failed === 1 ? "lookup" : "lookups"} failed, so ${searchStats.failed === 1 ? "that place was" : "those places were"} skipped. Cause: ${why.map(([, v]) => `${fmt(v.n)} × ${v.short}`).join(", ")}. ${advice} Select a muted dot to see the reason for a single place.`,
      );
    }
    if (searchStats.road.unknown)
      notes.push(
        `${fmt(searchStats.road.unknown)} ${searchStats.road.unknown === 1 ? "location" : "locations"} could not be checked for a road name and ${searchStats.road.unknown === 1 ? "has" : "have"} no road tag. ${scriptBroken ? "Google's Maps JavaScript API could not be used with this key; enable it in the Google Cloud console." : "Google gave no answer for them; running the search again may fill them in."}`,
      );
    if (notes.length) show("note", notes.join(" "));
  } catch (e) {
    setPhase(0);
    if (e.name === "AbortError") paint(`Stopped. ${fmt(results.length)} locations so far.`);
    else {
      let title,
        text,
        detail = e.detail || "";
      if (e.title) {
        title = e.title;
        text = e.text;
      } else if (e.kind === "key" || e.message === "denied") {
        title = "Google rejected the API key";
        text = GOOGLE_API_KEY
          ? "The key built into this page was refused. The owner of this page needs to check that the key is valid, that the Street View Static API is enabled for it, and that this site's address is allowed."
          : `Check that the key in step ${lastStep()} is complete, that the Street View Static API is enabled for it, and that this site's address is allowed in the Google Cloud console.`;
      } else if (e.message === "unreachable") {
        title = "Google Street View could not be reached";
        text =
          "The page could not contact Google. Check your internet connection. Ad blockers, script blockers and company firewalls can also block Google's address.";
      } else if (e.plain) {
        title = "No places found";
        text = e.message;
      } else {
        title = "The search stopped unexpectedly";
        text =
          "Something went wrong inside the page itself. Running the search again often works. If it keeps happening, pass the technical details to whoever runs this page.";
        detail = String(e && (e.stack || e.message || e)).slice(0, 600);
      }
      if (!results.length) searchStats.progress = 0;
      fail(title, text, detail, !!e.retry);
      paint(
        results.length
          ? `Stopped early. ${title}. ${fmt(results.length)} locations so far.`
          : `Stopped. ${title}.`,
      );
    }
  }
  setPhase(0);
  paint();
}

/* ---------- export ---------- */
/* The results in map-making.app's format: { name, customCoordinates: [{ lat, lng, heading, pitch, zoom,
   panoId, countryCode?, extra: { tags } }] }. */
function exportJson() {
  return JSON.stringify({
    name: lastName,
    customCoordinates: results.map(l => {
      const o = {
        lat: +l.lat.toFixed(7),
        lng: +l.lng.toFixed(7),
        heading: +l.heading.toFixed(1),
        pitch: 0,
        zoom: 0,
        panoId: l.panoId,
      };
      if (l.poi.cc) o.countryCode = l.poi.cc;
      if (l.tags.length) o.extra = { tags: l.tags };
      return o;
    }),
  });
}
$("download").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([exportJson()], { type: "application/json" }));
  a.download =
    (foldAccents(lastName)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "lookout-map") + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("tally").onclick = e => {
  if (e.target.id === "undo") undoRemove();
};
$("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(exportJson());
    $("copy").textContent = "Copied";
  } catch {
    $("copy").textContent = "Copy failed";
  }
  setTimeout(() => ($("copy").textContent = "Copy"), 1500);
};
paint();
if (fromLink) linkNote();

/* ---------- welcome, shown once per browser ---------- */
let welcomeBack = null;
/* The dialog remembers what had the focus and gives it back when closed. */
function openWelcome() {
  welcomeBack = document.activeElement;
  $("welcome").hidden = false;
  $("welcomeBox").focus({ preventScroll: true });
  $("welcomeBox").scrollTop = 0; // start reading at the top
  store.set("welcomed", true);
}
function closeWelcome() {
  if ($("welcome").hidden) return;
  $("welcome").hidden = true;
  reapplyLink();
  if (welcomeBack && welcomeBack.focus && welcomeBack !== document.body) welcomeBack.focus();
}
$("welcome").onclick = e => {
  if (e.target === $("welcome")) closeWelcome();
}; // a click outside the box
$("welcomeX").onclick = closeWelcome;
$("welcomeOk").onclick = closeWelcome;
$("howBtn").onclick = openWelcome;
document.addEventListener("keydown", e => {
  if ($("welcome").hidden) return;
  if (e.key === "Escape") closeWelcome();
  if (e.key === "Tab") {
    // keep the keyboard inside the box
    const f = [$("welcomeX"), $("welcomeOk")],
      i = f.indexOf(document.activeElement);
    e.preventDefault();
    f[(i + (e.shiftKey ? f.length - 1 : 1) + f.length) % f.length].focus();
  }
});
$("welcomeN").textContent = $("welcomeN2").textContent = COVERAGE.size;
if (!store.get("welcomed", false) && !FRAMED) openWelcome();
