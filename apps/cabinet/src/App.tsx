import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { getBugfixSpecs, runReplay, type CabinetReplayResult, type HollowInnVersion } from "./browser-replay.js";
import { buildViewModel, revealOrder, type JarViewModel } from "./cabinet-model.js";
import { RACK_META } from "./rack-meta.js";
import { CabinetFrame } from "./components/CabinetFrame.js";
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
import { REVEAL_INTERVAL_MS, STAMP_TEXT, useReducedMotion, useReveal } from "./reveal.js";
import "./styles/motion.css";

/** The Version selected on page load (Requirement 2.1). */
const PAGE_VERSION: HollowInnVersion = "v2";

/** The id of the element that wraps the JarDrawer. Each Jar's aria-controls names it. */
const DRAWER_ID = "jar-drawer";

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
  const order = useMemo(() => revealOrder(viewModel), [viewModel]);
  const reveal = useReveal(order, result, reducedMotion);

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
  const stampRack =
    reveal.stampAccession === null
      ? null
      : (viewModel.racks.find((rack) => rack.jars.some((jar) => jar.accession === reveal.stampAccession))?.code ??
        null);

  return (
    <CabinetFrame>
      <header className="cabinet-header">
        <h1 className="cabinet-wordmark">SPECIMEN JAR</h1>
        <div className="cabinet-controls">
          <ServerSwitch version={version} onVersionChange={onVersionChange} />
          <ReplayButton version={version} running={running} onReplay={onReplay} />
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
            <VerdictPlate plate={viewModel.plate} revealed={revealed} revealIntervalMs={REVEAL_INTERVAL_MS} />
          )}
        </div>
      </header>

      <main className="cabinet-main">
        <CountsPair counts={viewModel.counts} replayed={viewModel.replayed} />
        <GuideStrip steps={viewModel.guide} coldOpenDone={revealed} reducedMotion={reducedMotion} />

        {viewModel.racks.map((rack) => (
          <div key={rack.code} className="rack-slot">
            <ShelfRow
              rack={rack}
              isRevealed={reveal.isRevealed}
              expandedAccession={openKey}
              drawerId={DRAWER_ID}
              onActivate={onActivate}
            />
            {stampRack === rack.code ? (
              <span className="its-moving-stamp" aria-hidden="true">
                {STAMP_TEXT}
              </span>
            ) : null}
          </div>
        ))}

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
  );
}
