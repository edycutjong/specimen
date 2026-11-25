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
import { Fragment, type ReactElement } from "react";
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
  /** The replayed value as JSON text, or "—" when the replayed side has no value (a removed field). */
  replayed: string;
  flag: FlagWord;
  /** The jarred literal or a key, or "—" when the jarred side has no value (an added field). */
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
  if (change.kind === "added") return NO_VALUE;
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

/** The mark for a side of a change that has no value: a removed field has no replayed value, and an added one no jarred value. */
const NO_VALUE = "—";

function changeRow(change: Change, elements: readonly ReferenceElement[] | null): LabReportChangeRow {
  return {
    type: "change",
    path: displayPath(change.path),
    replayed: change.now === undefined ? NO_VALUE : JSON.stringify(change.now),
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

/**
 * The suspected-rename callout (design pass, item 5): the old path and its jarred value, the new path and
 * its replayed value, the factor, and the plain sentence under them. Built from the rename note and the rows.
 */
export type RenameCallout = {
  oldPath: string;
  oldValue: string;
  newPath: string;
  newValue: string;
  /** The factor digits of the note, for example "100" for ×100. */
  factor: string;
  /** The last name of the old path, for example "total" for "/total". */
  oldName: string;
  /** The plain sentence under the line. */
  sentence: string;
};

const RENAME_NOTE = /^suspected rename from (.+) ×(\d+)$/;

/** The unit change that the factor names. Only ×100 has a plain name; any other factor reads as a multiple. */
function unitPhrase(factor: string): string {
  return factor === "100" ? "from dollars to cents" : `by a factor of ${factor}`;
}

/** The callout of a jar whose changes carry a suspected-rename note, or null when none does. */
export function renameCalloutOf(entry: ResultEntry): RenameCallout | null {
  const note = entry.changes.find((change) => change.note !== undefined && RENAME_NOTE.test(change.note))?.note;
  if (note === undefined) return null;
  const match = RENAME_NOTE.exec(note);
  if (match === null) return null;
  const oldPath = match[1] ?? "";
  const factor = match[2] ?? "";
  const added = entry.changes.find((change) => change.note === note && change.kind === "added");
  if (added === undefined) return null;

  const oldRow = labReportOf(entry).rows.find(
    (row): row is LabReportChangeRow => row.type === "change" && row.path === displayPath(oldPath) && row.flag === "REMOVED",
  );
  const oldValue = oldRow?.reference ?? NO_VALUE;
  const oldName = lastToken(oldPath);
  return {
    oldPath,
    oldValue,
    newPath: added.path,
    newValue: added.now === undefined ? NO_VALUE : JSON.stringify(added.now),
    factor,
    oldName,
    sentence: `Renamed, and the unit changed ${unitPhrase(factor)}. A client that reads ${oldName} gets nothing.`,
  };
}

function RenameCalloutView({ callout }: { callout: RenameCallout }): ReactElement {
  return (
    <section className="lab-report__rename" aria-label="Suspected rename">
      <p className="lab-report__rename-line">
        <span className="lab-report__rename-path">{callout.oldPath}</span>{" "}
        <s className="lab-report__rename-old">{callout.oldValue}</s> → <span className="lab-report__rename-path">{callout.newPath}</span>{" "}
        <span className="lab-report__rename-new">{callout.newValue}</span>{" "}
        <span className="lab-report__chip">×{callout.factor}</span>
      </p>
      <p className="lab-report__rename-sentence">{callout.sentence}</p>
    </section>
  );
}

export type LabReportTableProps = {
  /** The Result_Entry of the jar in the selected Replay_Result. */
  entry: ResultEntry;
};

/**
 * A JSON pointer with a line break after each "/", so a long path wraps only at a slash and never inside a
 * name. The text content stays the same path.
 */
function PathText({ path }: { path: string }): ReactElement {
  const pieces = path.split("/");
  return (
    <>
      {pieces.map((piece, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <>
              /<wbr />
            </>
          ) : null}
          {piece}
        </Fragment>
      ))}
    </>
  );
}

/** One side of the values cell: the label in --muted, then the value in --ink. */
function ValueLine({ label, value, changed }: { label: string; value: string; changed: boolean }): ReactElement {
  return (
    <span className="lab-report__value">
      <span className="lab-report__value-label">{label}</span>{" "}
      <span className="lab-report__value-text">{changed ? <s>{value}</s> : value}</span>
    </span>
  );
}

/** The cells of one change row. Only a REMOVED row is struck through (design pass, item 5). */
function ChangeCells({ row, changed }: { row: LabReportChangeRow; changed: boolean }) {
  return (
    <>
      <td className="lab-report__path">
        {changed ? (
          <s className="lab-report__data">
            <PathText path={row.path} />
          </s>
        ) : (
          <span className="lab-report__data">
            <PathText path={row.path} />
          </span>
        )}
      </td>
      <td className="lab-report__flag">{row.flag}</td>
      <td className="lab-report__values">
        <ValueLine label="replayed" value={row.replayed} changed={changed && row.replayed !== NO_VALUE} />
        <ValueLine label="jarred" value={row.reference} changed={false} />
      </td>
    </>
  );
}

export function LabReportTable({ entry }: LabReportTableProps) {
  const report = labReportOf(entry);
  const callout = renameCalloutOf(entry);
  return (
    <div className="lab-report">
      {callout !== null ? <RenameCalloutView callout={callout} /> : null}
      <div className="lab-report__paper">
        <table className="lab-report__table" aria-label="Field-by-field diff of the replayed jar">
          <thead>
            <tr>
              <th scope="col">Path</th>
              <th scope="col">Flag</th>
              <th scope="col">Values</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row, index) =>
              row.type === "note" ? (
                <tr key={index} className="lab-report__note">
                  <td colSpan={3}>{row.text}</td>
                </tr>
              ) : (
                <tr key={index} className="lab-report__row lab-report__row--changed">
                  <ChangeCells row={row} changed={row.flag === "REMOVED"} />
                </tr>
              ),
            )}
          </tbody>
          {report.compatibleRows.length > 0 ? (
            <tbody className="lab-report__compatible">
              <tr>
                <th scope="rowgroup" colSpan={3}>
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
