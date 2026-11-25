/**
 * The version notes under the CountsPair (Requirements 3.5, 3.9). The page shows the heading of the
 * selected Version's CHANGES.md entry, then a collapsed "What changed" disclosure with the entry body.
 * The body is rendered as markdown, so the CHANGES table is a real table. The v2.1 lead line stays
 * visible (Requirement 3.9).
 */
import type { ReactElement } from "react";
import type { HollowInnVersion } from "../browser-replay.js";
import { splitHeading, v21FixLead, versionNote } from "../changes.js";
import { renderMarkdown } from "../markdown/render-markdown.js";
import "../styles/version-notes.css";

export type VersionNotesProps = {
  version: HollowInnVersion;
  /** The plate verdict of the selected Version, or null before its replay. Only the v2.1 lead reads it. */
  verdict?: "SHIP" | "HOLD" | null;
  /** False keeps the notes in place but hidden (visibility) until the Reveal has ended (design pass, item 4). */
  revealed?: boolean;
};

export function VersionNotes({ version, verdict = null, revealed = true }: VersionNotesProps): ReactElement | null {
  const note = versionNote(version);
  if (note === null) return null;
  const { title, aside } = splitHeading(note.heading);
  const className = revealed ? "version-notes" : "version-notes version-notes--pending";
  return (
    <section className={className} aria-label={`Changes in ${version}`}>
      <h3 className="version-notes__heading">{title}</h3>
      {aside !== null ? <p className="version-notes__honesty">({aside})</p> : null}
      {version === "v2.1" ? <p className="version-notes__lead">{v21FixLead(verdict)}</p> : null}
      <details className="version-notes__details">
        <summary className="version-notes__summary">What changed in {version}</summary>
        <div className="version-notes__body">{renderMarkdown(note.body)}</div>
      </details>
    </section>
  );
}
