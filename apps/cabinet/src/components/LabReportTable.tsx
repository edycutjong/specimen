/**
 * The LabReportTable (Requirement 11). It shows the field-by-field diff of one jar on ruled
 * paper with a red margin line.
 *
 * `labReportOf()` turns one Result_Entry into plain rows. It reads `changes`, `compatible`,
 * `ignored`, `state`, `reason` and the jarred literals that `referenceOf()` of @specimen/core
 * copies from `response_text`. The component only renders those rows.
 *
 * A changed row is struck through and set in red ink, and the printed flag word repeats that
 * cue (Requirement 11.12). A compatible addition is neither struck nor red (Requirement 11.8).
 */
import { referenceOf, type Change, type ChangeKind, type ReferenceElement, type ResultEntry } from "@specimen/core";
import "../styles/lab-report.css";

export type FlagWord = "REMOVED" | "ADDED" | "TYPE" | "VALUE" | "LENGTH";

const FLAG_WORDS: Record<ChangeKind, FlagWord> = {
  removed: "REMOVED",
  added: "ADDED",
  value: "VALUE",
  type: "TYPE",
  length: "LENGTH",
};

/** One row of `changes` or `compatible`. */
export type LabReportChangeRow = {
  type: "change";
  /** The RFC 6901 path, or "(whole body)" for the empty pointer. */
  path: string;
  /** The replayed value as JSON text, or "absent" when the replayed side has no value. */
  replayed: string;
  flag: FlagWord;
  /** The jarred literal, a key, "—", or "not jarred" for an added field. */
  reference: string;
};

/** An annotation row that carries the text of a rename note. */
export type LabReportNoteRow = { type: "note"; text: string };

export type LabReportModel = {
  state: ResultEntry["state"];
  /** Rows of `changes` in order. Each distinct note follows the first row that carries it. */
  rows: (LabReportChangeRow | LabReportNoteRow)[];
  /** Rows of `compatible`, shown under the "compatible additions" heading. */
  compatibleRows: LabReportChangeRow[];
  /** The volatile paths the normaliser ignored, with the empty pointer shown as "(whole body)". */
  ignored: string[];
  /** True for a preserved entry with no change and no compatible addition (Requirement 11.9). */
  noDiff: boolean;
  /** The failure reason of a cracked, unsealed or skipped entry (Requirement 11.10). */
  reason: string | null;
  /** Set when `referenceOf()` cannot locate a change in `response_text`. */
  referenceError: string | null;
};

const REASON_STATES: ReadonlySet<ResultEntry["state"]> = new Set(["cracked", "unsealed", "skipped"]);

function displayPath(path: string): string {
  return path === "" ? "(whole body)" : path;
}

/** The last RFC 6901 token of a pointer, unescaped. */
function lastToken(path: string): string {
  const cut = path.lastIndexOf("/");
  return path.slice(cut + 1).replace(/~1/g, "/").replace(/~0/g, "~");
}

/** The jarred text shown for one change. Literals are copied, never re-rendered from a number. */
function referenceCell(change: Change, elements: readonly ReferenceElement[] | null): string {
  if (change.kind === "added") return "not jarred";
  if (elements === null) return "unavailable";
  for (const element of elements) {
    if (element.kind === "path-literal" && element.path === change.path) return element.literal;
  }
  for (const element of elements) {
    if (element.kind === "key" && change.kind === "removed" && element.key === lastToken(change.path)) {
      return element.key;
    }
    if (element.kind === "tool" && change.path === "") return element.tool;
  }
  return "—";
}

function changeRow(change: Change, elements: readonly ReferenceElement[] | null): LabReportChangeRow {
  return {
    type: "change",
    path: displayPath(change.path),
    replayed: change.now === undefined ? "absent" : JSON.stringify(change.now),
    flag: FLAG_WORDS[change.kind],
    reference: referenceCell(change, elements),
  };
}

/** The view model of one jar's lab report, built from its Result_Entry. Pure: no clock, no I/O. */
export function labReportOf(entry: ResultEntry): LabReportModel {
  let elements: ReferenceElement[] | null = null;
  let referenceError: string | null = null;
  if (entry.changes.length > 0) {
    try {
      elements = referenceOf(entry);
    } catch (error) {
      referenceError = error instanceof Error ? error.message : String(error);
    }
  }

  const rows: (LabReportChangeRow | LabReportNoteRow)[] = [];
  const notes = new Set<string>();
  for (const change of entry.changes) {
    rows.push(changeRow(change, elements));
    if (change.note !== undefined && !notes.has(change.note)) {
      notes.add(change.note);
      rows.push({ type: "note", text: change.note });
    }
  }

  const compatibleRows = entry.compatible.map((change) => changeRow(change, null));
  const reason = REASON_STATES.has(entry.state) ? (entry.reason ?? entry.error ?? "no reason recorded") : null;
  const noDiff = entry.state === "preserved" && entry.changes.length === 0 && entry.compatible.length === 0;

  return {
    state: entry.state,
    rows,
    compatibleRows,
    ignored: entry.ignored.map(displayPath),
    noDiff,
    reason,
    referenceError,
  };
}

export type LabReportTableProps = {
  /** The Result_Entry of the jar in the selected Replay_Result. */
  entry: ResultEntry;
};

function ChangeCells({ row, changed }: { row: LabReportChangeRow; changed: boolean }) {
  return (
    <>
      <td>{changed ? <s className="lab-report__data">{row.path}</s> : <span className="lab-report__data">{row.path}</span>}</td>
      <td>{changed ? <s className="lab-report__data">{row.replayed}</s> : <span className="lab-report__data">{row.replayed}</span>}</td>
      <td className="lab-report__flag">{row.flag}</td>
      <td className="lab-report__data">{row.reference}</td>
    </>
  );
}

export function LabReportTable({ entry }: LabReportTableProps) {
  const report = labReportOf(entry);
  return (
    <div className="lab-report">
      <div className="lab-report__paper">
        <table className="lab-report__table" aria-label="Field-by-field diff of the replayed jar">
          <thead>
            <tr>
              <th scope="col">Path</th>
              <th scope="col">Replayed</th>
              <th scope="col">Flag</th>
              <th scope="col">Reference (jarred)</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row, index) =>
              row.type === "note" ? (
                <tr key={index} className="lab-report__note">
                  <td colSpan={4}>{row.text}</td>
                </tr>
              ) : (
                <tr key={index} className="lab-report__row lab-report__row--changed">
                  <ChangeCells row={row} changed />
                </tr>
              ),
            )}
          </tbody>
          {report.compatibleRows.length > 0 ? (
            <tbody className="lab-report__compatible">
              <tr>
                <th scope="rowgroup" colSpan={4}>
                  compatible additions
                </th>
              </tr>
              {report.compatibleRows.map((row, index) => (
                <tr key={index} className="lab-report__row lab-report__row--compatible">
                  <ChangeCells row={row} changed={false} />
                </tr>
              ))}
            </tbody>
          ) : null}
        </table>

        {report.noDiff ? (
          <p className="lab-report__statement">No field differs after normalisation.</p>
        ) : null}
        {report.referenceError !== null ? (
          <p className="lab-report__statement">Reference unavailable: {report.referenceError}</p>
        ) : null}
        {report.reason !== null ? (
          <p className="lab-report__statement">
            Reason: <span className="lab-report__data">{report.reason}</span>
          </p>
        ) : null}
      </div>

      <section className="lab-report__ignored" aria-label="Ignored volatile paths">
        <p className="lab-report__label">Ignored volatile paths</p>
        {report.ignored.length === 0 ? (
          <p className="lab-report__statement">none</p>
        ) : (
          <ul className="lab-report__list">
            {report.ignored.map((path) => (
              <li key={path} className="lab-report__data">
                {path}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
