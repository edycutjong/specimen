# Interaction QA of the live cabinet — https://specimen.edycu.dev/

Run 2026-11-25 20:58 UTC+7 (13:58Z) by a Puppeteer + axe-core script against the deployed page (headless Chrome, 1440×900 first, then 375×812 and 320×640). Raw result: `ux-r3.json` in this folder (copied unchanged from the run).

| Check | How | Result |
|---|---|---|
| Hover feedback | one element per class (7 classes: server-switch segment, replay button, jar button, the three `<summary>` disclosures, the footer link); screenshot of the element before and after `hover()`, byte comparison | 7 of 7 changed |
| Keyboard focus ring | Tab-focus each of the same classes, read the computed outline | 7 of 7 show a ring |
| Links | every `<a href>` on the page, `HEAD` request | 1 link; it is the footer link to the repository's `.kiro` folder, 404 while the repository is private (expected until the public flip) |
| Layout at 375 and 320 px | `scrollWidth` vs `clientWidth` | no horizontal scroll at 1440, 375 or 320; first jar top at 449 / 453 / 498 px |
| Third-party hosts | every request the page makes | none (own host only) |
| Console | errors and page errors during the run | 0 |
| axe-core | full ruleset at all three widths | one rule only: `color-contrast` (serious), 28 / 27 / 25 nodes, all toe-tag text on the jars |

**About the axe result.** The ink on a toe-tag measures 10.24:1 (`#1E1912` on `#D9C49A`), and the accession label is the topmost element at its own points
(`document.elementsFromPoint`), yet axe samples the dark jar art behind the rotated, overlapping tag. Four changes to the tag's rotation, pointer events and compositing left the axe
count unchanged, so we treat it as an axe false positive. We do not claim "0 axe violations". A real-browser re-check is on the human list. `label-content-name-mismatch` was a real finding in the
first run (the accessible name did not start with the visible label) and was fixed by Kiro in turns 46–47.

**What the first run found and what changed** (`prompts/turn-46.md`, `turn-47.md`): hover feedback was missing on three disclosures and the footer link; the favicon returned 404; the first jar sat at y = 624 on a 375 px phone. All three were fixed
(first jar 453 px). The `Details` fold is closed by default, so the gate opens it before it measures the version-notes disclosure.

The harness is a short Puppeteer + axe-core script kept outside this repository; the raw result above is what it printed.
