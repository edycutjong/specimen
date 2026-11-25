/// <reference types="vite/client" />
/**
 * The per-Version change notes of the ServerSwitch (Requirements 3.5, 3.9, 3.10). The notes come
 * from `servers/hollow-inn/CHANGES.md`, imported as raw text at build time and split at its
 * `## v<version>` headings. The headings name patch versions (`## v2.1.0`, `## v2.0.0`, `## v1.0.0`),
 * and the Versions of the switch name the minor line (`v2.1`, `v2`, `v1`), so a `.0` minor maps to
 * its major and any other minor keeps it. No clock, randomness or network here.
 */
import changesMarkdown from "../../../servers/hollow-inn/CHANGES.md?raw";
import type { HollowInnVersion } from "./browser-replay.js";

export type VersionNote = {
  version: HollowInnVersion;
  /** The heading text after `## `, for example "v2.1.0 — `quote` returns `total` again". */
  heading: string;
  /** The entry body under the heading, as markdown, without the heading line. */
  body: string;
};

/**
 * Requirement 3.9 and design pass, item 6: the v2.1 lead. It says v2.1 is what Kiro built, and what
 * it fixes and what it does not. The clause "still HOLD" comes from the plate, in `v21FixLead`.
 */
export const V21_FIX_LEAD =
  "v2.1 is the version Kiro built from the filed quote bugfix spec. It fixes only quote — the search_rooms page size and the cancel_booking rename are not filed yet";

/** The v2.1 lead for a plate verdict. "still HOLD" is said only when the plate says HOLD. */
export function v21FixLead(verdict: "SHIP" | "HOLD" | null): string {
  return verdict === "HOLD" ? `${V21_FIX_LEAD}, so v2.1 is still HOLD.` : `${V21_FIX_LEAD}.`;
}

/**
 * A heading split into its title and its parenthetical aside, with the backticks removed. The aside
 * is the honesty note of a version (for example "this is the demo's planted break set"), or null.
 */
export function splitHeading(heading: string): { title: string; aside: string | null } {
  const plain = heading.replace(/`/g, "");
  const match = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(plain);
  if (match === null) return { title: plain, aside: null };
  return { title: (match[1] ?? "").trim(), aside: (match[2] ?? "").trim() };
}

/**
 * Requirement 3.10: the wording for v2.1 once its replay has run. The VerdictPlate shows the
 * measured verdict, so this line only points to it and does not restate a result.
 */
export const V21_REPLAYED_NOTE =
  "The verdict and counts below are measured by replaying v2.1 now. Any jar still rattled or cracked is listed there.";

const HEADING = /^## v(\d+)\.(\d+)\.(\d+)(?:\s.*)?$/;

/** Maps a heading's major, minor and patch numbers to the Version of the switch, or null. */
export function versionOfHeading(major: string, minor: string): HollowInnVersion | null {
  const key = minor === "0" ? `v${major}` : `v${major}.${minor}`;
  return key === "v1" || key === "v2" || key === "v2.1" ? key : null;
}

/** Splits CHANGES.md at its `## v<version>` headings. Headings of other shapes stay inside the entry above. */
export function splitChanges(markdown: string): VersionNote[] {
  const notes: VersionNote[] = [];
  let current: { version: HollowInnVersion; heading: string; lines: string[] } | null = null;

  const close = () => {
    if (current !== null) {
      notes.push({ version: current.version, heading: current.heading, body: current.lines.join("\n").trim() });
      current = null;
    }
  };

  for (const line of markdown.split("\n")) {
    const match = HEADING.exec(line);
    if (match !== null) {
      close();
      const version = versionOfHeading(match[1] ?? "", match[2] ?? "");
      if (version !== null) {
        current = { version, heading: line.replace(/^## /, "").trim(), lines: [] };
      }
      continue;
    }
    if (line.startsWith("## ")) {
      close();
      continue;
    }
    if (current !== null) current.lines.push(line);
  }
  close();
  return notes;
}

/** Every Version's note, in the order of CHANGES.md. */
export const VERSION_NOTES: readonly VersionNote[] = splitChanges(changesMarkdown);

/** The note of one Version, or null when CHANGES.md has no entry for it. */
export function versionNote(version: HollowInnVersion): VersionNote | null {
  return VERSION_NOTES.find((note) => note.version === version) ?? null;
}
