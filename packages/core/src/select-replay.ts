/**
 * Picks the Replay_Result file that `specimen check-spec` reads when `--replay` is absent
 * (replay-engine Requirement 11 criterion 2). Pure: no file access and no clock. The caller
 * lists the names in `replays/`. It imports nothing from Node, so the cabinet can bundle it.
 */

/**
 * A file name of the form `<server>-<iso>.json`. The ISO part is the 24 characters
 * `YYYY-MM-DDTHH-mm-ss.sssZ` written by `replayFileName`, where `:` became `-`. The server part
 * is one or more characters and is followed by a single `-` before the ISO part.
 */
const REPLAY_NAME = /^(.+)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z)\.json$/;

/**
 * Returns the name whose ISO suffix is the greatest. Because the suffix has a fixed width and
 * is zero-padded, comparing the suffix as text is the same as comparing the times. Two names
 * with the same suffix are ordered by the whole name in code-unit order (JavaScript string
 * comparison), so the greatest name wins. Names that do not match the pattern are ignored.
 * Returns undefined when no name matches.
 */
export function selectLatestReplay(names: readonly string[]): string | undefined {
  let best: { name: string; iso: string } | undefined;
  for (const name of names) {
    const match = REPLAY_NAME.exec(name);
    const iso = match?.[2];
    if (iso === undefined) continue;
    if (best === undefined || iso > best.iso || (iso === best.iso && name > best.name)) {
      best = { name, iso };
    }
  }
  return best?.name;
}
