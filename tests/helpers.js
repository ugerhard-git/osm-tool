// Small helpers shared by the test files.

/** Makes `text` the only kind of place in step 1, as a visitor would: remove the chosen kinds, then type
 *  and pick the first suggestion (for a typed key=value tag, that is "Use the tag you typed"). */
async function chooseKind(page, text) {
  await clearKinds(page);
  await page.fill("#kind", text);
  await page.keyboard.press("Enter");
}

/** Removes every chosen kind of place, so the field is shown and empty again. */
async function clearKinds(page) {
  await page.evaluate(() => {
    kinds = [];
    addingKind = false;
    document.getElementById("kind").value = "";
    renderKinds();
    renderPicked();
  });
}

/** The chosen kinds of place, as their chip labels joined with commas ("" when none). */
const kindLabels = page => page.evaluate(() => kinds.map(k => k.label).join());

module.exports = { chooseKind, clearKinds, kindLabels };
