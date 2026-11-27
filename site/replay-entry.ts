/**
 * The live replay on the landing page (/landing/), the deck (/deck/) and the judge page (/judge): the cabinet's own Replay_Module
 * (apps/cabinet/src/browser-replay.ts), bundled on its own into /static/replay.js by site/vite.config.ts, so those
 * pages run the same replay and verdict code as the cabinet without loading the React app.
 */
export { runReplay, JAR_FILES } from "../apps/cabinet/src/browser-replay.js";
export type { CabinetReplayResult, HollowInnVersion } from "../apps/cabinet/src/browser-replay.js";
