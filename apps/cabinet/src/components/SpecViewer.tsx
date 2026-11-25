/**
 * SpecViewer: the bugfix spec for one jar (Requirements 12.1 to 12.8).
 *
 * The spec is the first citing Bugfix_Spec that passes `checkSpec()` against the current browser
 * Replay_Result. When none passes, it is the first citing spec in code-unit order of its path. The
 * PASS badge needs a live `checkSpec()` pass for a red jar, so it never comes from a cached CLI
 * result. The spec text goes through the local markdown renderer, which never builds raw HTML.
 */
import { checkSpec, citesId, type BugfixSpec, type ResultEntry } from "@specimen/core";
import sliceNote from "../../../../evidence/slice/01-specimen-file.md?raw";
import type { CabinetReplayResult } from "../browser-replay.js";
import type { JarViewModel } from "../cabinet-model.js";
import { renderMarkdown } from "../markdown/render-markdown.js";
import "../styles/spec-viewer.css";

/** The GitHub blob base. A spec's repository path is appended to it (Requirement 12.6). */
export const GITHUB_BLOB_URL = "https://github.com/edycutjong/specimen/blob/main/";

/**
 * The date in the heading of the vertical-slice note, for example `2026-11-25` from
 * `(P1b, 2026-11-25 03:52 WIB)`. The first line starting with `# ` is the heading.
 */
export function parseFiledDate(note: string): string {
  const heading = note.split(/\r?\n/).find((line) => line.startsWith("# "));
  const date = heading === undefined ? null : /\b(\d{4}-\d{2}-\d{2})\b/.exec(heading);
  if (date === null || date[1] === undefined) {
    throw new Error("evidence/slice/01-specimen-file.md has no dated heading");
  }
  return date[1];
}

/** Requirement 12.3: the date is read at build time from the slice note. */
export const SPEC_FILED_DATE = parseFiledDate(sliceNote);

export type SpecChoice = { spec: BugfixSpec; passes: boolean };

/** Code-unit order of the spec paths, the order Requirement 12.1 names. */
function byCodeUnitPath(a: BugfixSpec, b: BugfixSpec): number {
  if (a.name === b.name) return 0;
  return a.name < b.name ? -1 : 1;
}

/**
 * The spec to show for one jar id. `jars` is the entry list of the current Replay_Result, which
 * `checkSpec()` reads. Returns null when no spec cites the id.
 */
export function chooseSpec(
  jarId: string,
  specs: readonly BugfixSpec[],
  jars: readonly ResultEntry[],
): SpecChoice | null {
  const citing = specs.filter((spec) => citesId(spec.text, jarId)).sort(byCodeUnitPath);
  const first = citing[0];
  if (first === undefined) return null;

  const passing = citing.find((spec) => checkSpec(spec.text, jarId, [...jars]) === "pass");
  if (passing !== undefined) return { spec: passing, passes: true };
  return { spec: first, passes: false };
}

export type SpecViewerProps = {
  jar: JarViewModel;
  specs: readonly BugfixSpec[];
  /** The current browser Replay_Result for the selected Version, or null before a replay. */
  result: CabinetReplayResult | null;
  /** Called when the reader follows the GitHub link to the spec. That counts as reading it (design pass, item 6). */
  onSourceOpened?: () => void;
};

function filingStatus(jar: JarViewModel, result: CabinetReplayResult | null, choice: SpecChoice | null): string {
  if (result === null) return "not replayed yet";
  if (!jar.isRed) return "not red in this replay";
  if (choice?.passes === true) return "filed as a Kiro bugfix spec";
  if (choice !== null) return "not filed: the citing spec fails check-spec";
  return "not filed";
}

export function SpecViewer({ jar, specs, result, onSourceOpened }: SpecViewerProps) {
  const choice = jar.id === null ? null : chooseSpec(jar.id, specs, result?.jars ?? []);
  const showPass = result !== null && jar.isRed && choice?.passes === true;
  const status = filingStatus(jar, result, choice);

  return (
    <section className="spec-viewer" aria-label="Bugfix spec">
      <h3 className="spec-viewer__heading">Bugfix spec</h3>

      <p className="spec-viewer__status">
        <span>{status}</span>
        {showPass ? (
          <span className="spec-viewer__badge" data-badge="check-spec-pass">
            check-spec PASS
          </span>
        ) : null}
      </p>

      {choice === null ? null : (
        <>
          <p className="spec-viewer__provenance">
            Filed by the specimen-curator agent through <code>specimen file</code> on {SPEC_FILED_DATE} (WIB).
          </p>
          <p className="spec-viewer__link">
            <a
              href={`${GITHUB_BLOB_URL}${choice.spec.name}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onSourceOpened?.()}
            >
              View {choice.spec.name} on GitHub
            </a>
          </p>
          <div className="spec-viewer__body">{renderMarkdown(choice.spec.text)}</div>
        </>
      )}
    </section>
  );
}
