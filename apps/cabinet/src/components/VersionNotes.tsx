/**
 * The version notes under the CountsPair (Requirements 3.5, 3.9). The page shows the heading of the
 * selected Version's CHANGES.md entry, then a collapsed "What changed" disclosure with the entry body.
 * The body is rendered as markdown, so the CHANGES table is a real table. The v2.1 lead line stays
 * visible (Requirement 3.9).
 */
import type { ReactElement } from "react";
import type { HollowInnVersion } from "../browser-replay.js";
import { V21_FIX_LEAD, versionNote } from "../changes.js";
import { renderMarkdown } from "../markdown/render-markdown.js";
import "../styles/version-notes.css";

export type VersionNotesProps = {
  version: HollowInnVersion;
};

export function VersionNotes({ version }: VersionNotesProps): ReactElement | null {
  const note = versionNote(version);
  if (note === null) return null;
  return (
    <section className="version-notes" aria-label={`Changes in ${version}`}>
      <h3 className="version-notes__heading">{note.heading.replace(/`/g, "")}</h3>
      {version === "v2.1" ? <p className="version-notes__lead">{V21_FIX_LEAD}</p> : null}
      <details className="version-notes__details">
        <summary className="version-notes__summary">What changed in {version}</summary>
        <div className="version-notes__body">{renderMarkdown(note.body)}</div>
      </details>
    </section>
  );
}
