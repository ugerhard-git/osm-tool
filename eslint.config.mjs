// Linting: finds likely mistakes (unknown names, unused variables, …). Layout is left to Prettier.
// Run with `npm run lint`; it also runs on every pull request.
import js from "@eslint/js";
import globals from "globals";
import * as espree from "espree";
import { readFileSync } from "node:fs";

// Names the page itself defines: the build adds Leaflet (L), the place catalogue (CAT) and the framing
// check (FRAMED) before app.js, and Google's script adds `google` when it loads.
const pageGlobals = { L: "readonly", google: "readonly", CAT: "readonly", FRAMED: "readonly" };

// The tests run some code inside the page (page.evaluate), where it uses app.js's top-level names.
// Read those names from app.js, so this list never goes out of date.
const appNames = {};
for (const node of espree.parse(readFileSync("src/app.js", "utf8"), { ecmaVersion: "latest" }).body) {
  if (node.type === "VariableDeclaration")
    for (const d of node.declarations) if (d.id.type === "Identifier") appNames[d.id.name] = "writable";
  if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id)
    appNames[node.id.name] = "readonly";
}

export default [
  { ignores: ["dist/", "node_modules/"] },
  js.configs.recommended,
  {
    rules: {
      // `catch {}` is used on purpose where the browser may block storage (private windows).
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["src/app.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser, ...pageGlobals } },
  },
  {
    files: ["src/build.js", "src/catalog.js", "tests/**/*.js"],
    languageOptions: { sourceType: "commonjs", globals: { ...globals.node } },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: { globals: { ...globals.browser, ...pageGlobals, ...appNames } },
  },
];
