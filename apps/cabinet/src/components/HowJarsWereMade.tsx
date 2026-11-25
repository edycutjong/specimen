/**
 * "How the jars were made" (Requirements 14.8 to 14.11).
 *
 * The two Kiro hook files are imported as raw text at build time, so the page shows the exact
 * files committed under `.kiro/hooks/`. The demo line keeps `<your test instance>` as literal
 * text. The SHIP sentence says what SHIP means and what it does not mean.
 */
import preHook from "../../../../.kiro/hooks/specimen-jar-pre.json?raw";
import postHook from "../../../../.kiro/hooks/specimen-jar-post.json?raw";
import "../styles/frame.css";

/** The `/.kiro` folder on GitHub (Requirement 14.9). */
export const KIRO_GITHUB_URL = "https://github.com/edycutjong/specimen/tree/main/.kiro";

/**
 * The interactive-demo line (Requirement 14.10). It is one string, so the placeholder is text and
 * never parsed as an element.
 */
export const DEMO_LINE =
  "This page is an interactive demo over the hollow-inn server with jars captured by Kiro hooks. " +
  "On your own server: capture with the hooks → specimen replay --server <your test instance>";

/** The CLI fragment at the end of the demo line. It is set in <code> (design pass, item 10). */
export const DEMO_CLI = "specimen replay --server <your test instance>";

/** Requirement 14.11. */
export const SHIP_LINE =
  'SHIP means "replay clean on the recorded set". It never means "this server is safe".';

export const HOOK_FILES = [
  { name: "specimen-jar-pre", path: ".kiro/hooks/specimen-jar-pre.json", text: preHook },
  { name: "specimen-jar-post", path: ".kiro/hooks/specimen-jar-post.json", text: postHook },
] as const;

export function HowJarsWereMade() {
  const lead = DEMO_LINE.slice(0, DEMO_LINE.indexOf(DEMO_CLI));
  return (
    <section className="how-made" aria-labelledby="how-made-heading">
      <h2 id="how-made-heading" className="how-made__title">
        How the jars were made
      </h2>

      <p>
        {lead}
        <code>{DEMO_CLI}</code>
      </p>

      <p>
        Two Kiro hooks record each call to the hollow-inn server. The pre hook runs before the call
        and the post hook runs after it.
      </p>

      <p>
        RACK A&apos;s fifth call (A5) came from one follow-up prompt in the same session: call search_rooms without the
        limit argument, because the first search sent limit: 50.
      </p>

      <details className="how-made__details">
        <summary className="how-made__summary">Show the two hook files</summary>
        <div className="how-made__hooks">
          {HOOK_FILES.map((hook) => (
            <figure key={hook.name} className="how-made__hook">
              <figcaption>{hook.path}</figcaption>
              <pre data-hook={hook.name}>
                <code>{hook.text}</code>
              </pre>
            </figure>
          ))}
        </div>
      </details>

      <p>
        The hook configuration and the rest of the Kiro setup are in{" "}
        <a className="how-made__link" href={KIRO_GITHUB_URL} target="_blank" rel="noopener noreferrer">
          /.kiro on GitHub
        </a>
        .
      </p>

      <p className="how-made__ship">{SHIP_LINE}</p>
    </section>
  );
}
