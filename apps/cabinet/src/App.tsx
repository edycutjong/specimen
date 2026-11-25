import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { getBugfixSpecs, runReplay, type CabinetReplayResult, type HollowInnVersion } from "./browser-replay.js";
import { buildViewModel, revealOrder, type JarViewModel } from "./cabinet-model.js";
import { RACK_META } from "./rack-meta.js";
import { CabinetFrame, FrameSuture } from "./components/CabinetFrame.js";
import { CountsPair } from "./components/CountsPair.js";
import { GuideStrip } from "./components/GuideStrip.js";
import { HowJarsWereMade } from "./components/HowJarsWereMade.js";
import { JarDrawer } from "./components/JarDrawer.js";
import { Legend } from "./components/Legend.js";
import { ReplayButton } from "./components/ReplayButton.js";
import { ServerSwitch } from "./components/ServerSwitch.js";
import { ShelfRow } from "./components/ShelfRow.js";
import { SpoiledTray } from "./components/SpoiledTray.js";
import { VerdictPlate } from "./components/VerdictPlate.js";
import { VersionNotes } from "./components/VersionNotes.js";
import { StormWindow } from "./jar-art.js";
import {
  COLD_OPEN_LEAD_MS,
  REVEAL_INTERVAL_MS,
  REVEAL_SETTLE_MS,
  useLightning,
  useReducedMotion,
  useReveal,
} from "./reveal.js";
import "./styles/motion.css";
import "./styles/header.css";

/** The Version selected on page load (Requirement 2.1). */
const PAGE_VERSION: HollowInnVersion = "v2";

/** The id of the element that wraps the JarDrawer. Each Jar's aria-controls names it. */
const DRAWER_ID = "jar-drawer";

/** The cue on the first red filed jar lasts this long (design pass, item 4). */
const CUE_MS = 1200;

/** The committed Bugfix_Specs, read once. */
const BUGFIX_SPECS = getBugfixSpecs();

function messageOf(caught: unknown): string {
  if (caught instanceof Error && caught.message !== "") return caught.message;
  return "The replay failed without a message.";
}

export function App(): ReactElement {
  const [version, setVersion] = useState<HollowInnVersion>(PAGE_VERSION);
  const [result, setResult] = useState<CabinetReplayResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [guideFlags, setGuideFlags] = useState({
    openedRedJar: false,
    viewedSpec: false,
    replayedFixedVersion: false,
  });
  // The cue on the first red filed jar plays once per page load (design pass, item 4).
  const [cueOn, setCueOn] = useState(false);
  const [cueSpent, setCueSpent] = useState(false);
  const reducedMotion = useReducedMotion();

  // Each replay request takes the next token. A result is applied only while its token is the
  // latest one, so a replay that the user has overtaken (by a Version switch or a newer replay)
  // never reaches the page.
  const requestToken = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const retryButton = useRef<HTMLButtonElement | null>(null);

  const cancelPending = useCallback((): void => {
    requestToken.current += 1;
    controller.current?.abort();
    controller.current = null;
  }, []);

  const startReplay = useCallback(
    (target: HollowInnVersion): void => {
      cancelPending();
      const token = requestToken.current;
      const abort = new AbortController();
      controller.current = abort;
      setRunning(true);
      setError(null);

      runReplay(target, { signal: abort.signal }).then(
        (next) => {
          if (token !== requestToken.current) return;
          controller.current = null;
          setResult(next);
          setRunning(false);
          if (target === "v2.1") setGuideFlags((flags) => ({ ...flags, replayedFixedVersion: true }));
        },
        (caught: unknown) => {
          if (token !== requestToken.current) return;
          controller.current = null;
          setResult(null);
          setError(messageOf(caught));
          setRunning(false);
        },
      );
    },
    [cancelPending],
  );

  // The page load replay (Requirement 2.1). Unmounting drops any replay still in flight.
  useEffect(() => {
    startReplay(PAGE_VERSION);
    return cancelPending;
  }, [startReplay, cancelPending]);

  // Focus moves to Retry when a thrown replay shows its error (Requirement 15.3).
  useEffect(() => {
    if (error !== null) retryButton.current?.focus();
  }, [error]);

  const onVersionChange = (next: HollowInnVersion): void => {
    if (next === version) return;
    cancelPending();
    setVersion(next);
    setResult(null);
    setError(null);
    setRunning(false);
  };

  const onReplay = (): void => {
    if (running) return;
    startReplay(version);
  };

  const viewModel = useMemo(
    () =>
      buildViewModel({
        result,
        version,
        bugfixSpecs: BUGFIX_SPECS,
        racks: RACK_META,
        guideFlags,
        schemaDiffError: result?.schemaDiffError,
      }),
    [result, version, guideFlags],
  );

  // The Reveal paces the jars of the current result in Reveal order (Requirements 2.3, 2.15, 2.16).
  // The first jar waits for the cold-open lightning: a hold, then two flashes (design pass, item 2).
  const order = useMemo(() => revealOrder(viewModel), [viewModel]);
  const reveal = useReveal(order, result, reducedMotion, reducedMotion ? 0 : COLD_OPEN_LEAD_MS);

  // The first red jar flips, and the flash fires once for it.
  const firstRed = useMemo(() => order.find((jar) => jar.isRed), [order]);
  const firstRedRevealed = firstRed !== undefined && reveal.isRevealed(firstRed);
  const lit = useLightning(result, reducedMotion, firstRedRevealed);

  // The first red filed jar glows once, after the cold open has settled.
  const cueJar = useMemo(() => order.find((jar) => jar.isRed && jar.filed), [order]);
  useEffect(() => {
    if (!reveal.complete || cueSpent || cueJar === undefined || reducedMotion) return undefined;
    const start = window.setTimeout(() => setCueOn(true), REVEAL_SETTLE_MS);
    const end = window.setTimeout(() => {
      setCueOn(false);
      setCueSpent(true);
    }, REVEAL_SETTLE_MS + CUE_MS);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(end);
      setCueOn(false);
    };
  }, [reveal.complete, cueSpent, cueJar, reducedMotion]);

  const openJar: JarViewModel | null =
    openKey === null ? null : (order.find((jar) => jar.accession === openKey) ?? null);

  const onActivate = (jar: JarViewModel): void => {
    if (jar.accession === openKey) {
      setOpenKey(null);
      return;
    }
    setOpenKey(jar.accession);
    if (jar.isRed) setGuideFlags((flags) => ({ ...flags, openedRedJar: true }));
    if (jar.filed) setGuideFlags((flags) => ({ ...flags, viewedSpec: true }));
  };

  // The VerdictPlate and the GuideStrip pulse wait for the whole Reveal to complete.
  const revealed = reveal.complete;

  return (
    <>
      <header className="cabinet-header">
        <div className="cabinet-header__top">
          <div className="cabinet-brand">
            <h1 className="cabinet-wordmark">
              <span className="cabinet-wordmark__specimen">SPECIMEN</span>{" "}
              <span className="cabinet-wordmark__jar">JAR</span>
            </h1>
            <p className="cabinet-tagline">MCP calls · jarred · replayed</p>
          </div>
          <div className="cabinet-plate-slot">
            {error !== null ? (
              <div className="verdict-error">
                <p className="verdict-error__message" role="alert">
                  {error}
                </p>
                <button ref={retryButton} type="button" className="verdict-error__retry" onClick={onReplay}>
                  Retry
                </button>
              </div>
            ) : (
              <VerdictPlate
                plate={viewModel.plate}
                revealed={revealed}
                revealIntervalMs={REVEAL_INTERVAL_MS}
                part="plaque"
              />
            )}
          </div>
        </div>
        <div className="cabinet-controls">
          <ServerSwitch version={version} onVersionChange={onVersionChange} />
          <ReplayButton version={version} running={running} onReplay={onReplay} />
        </div>
      </header>

      <CabinetFrame lit={lit}>
        <main className="cabinet-main">
          <div className="cabinet-wall">
            <div className="cabinet-wall__text">
              <CountsPair
                counts={viewModel.counts}
                replayed={viewModel.replayed}
                result={result}
                jarCount={order.length}
                revealed={revealed}
                countUp={!reducedMotion}
              />
              <div className="cabinet-ledger">
                <VerdictPlate
                  plate={viewModel.plate}
                  revealed={revealed}
                  revealIntervalMs={REVEAL_INTERVAL_MS}
                  part="ledger"
                />
                <VersionNotes version={version} verdict={viewModel.plate.verdict} />
              </div>
              <GuideStrip steps={viewModel.guide} coldOpenDone={revealed} reducedMotion={reducedMotion} />
            </div>
            <StormWindow className="cabinet-wall__window" lit={lit} />
          </div>

          {viewModel.racks.map((rack) => (
            <div key={rack.code} className="rack-slot">
              <ShelfRow
                rack={rack}
                isRevealed={reveal.isRevealed}
                expandedAccession={openKey}
                stampAccession={reveal.stampAccession}
                cueAccession={cueOn ? (cueJar?.accession ?? null) : null}
                drawerId={DRAWER_ID}
                onActivate={onActivate}
              />
            </div>
          ))}

          <FrameSuture />
          <Legend skippedToolsPresent={viewModel.skippedToolsPresent} />
          <SpoiledTray spoiled={viewModel.spoiled} />
          <HowJarsWereMade />

          <div id={DRAWER_ID}>
            <JarDrawer
              jar={openJar}
              version={version}
              result={result}
              specs={BUGFIX_SPECS}
              onClose={() => setOpenKey(null)}
            />
          </div>
        </main>
      </CabinetFrame>
    </>
  );
}
