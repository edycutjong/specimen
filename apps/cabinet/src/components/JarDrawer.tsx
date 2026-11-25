/**
 * The JarDrawer (Requirement 10): the panel or sheet that shows one Jar.
 *
 * The form follows the viewport width (Requirements 10.2 to 10.5). A right panel is non-modal and
 * leaves the page operable (10.11). A bottom sheet or a full-screen sheet is a modal dialog: it
 * keeps Tab inside itself and makes the page behind it inert (10.10).
 *
 * Focus moves to the heading when the drawer opens (10.9). Escape and the Close control close it,
 * and focus goes back to the element that was focused when the most recently activated Jar was
 * activated (10.8). A new replay result for the same accession replaces the content without
 * remounting the drawer, so focus stays where it was (10.15).
 *
 * The component takes plain props. It derives nothing from the replay or the spec files, except
 * the Result_Entry it looks up by accession for LabReportTable.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import type { BugfixSpec, ResultEntry } from "@specimen/core";
import type { CabinetReplayResult, HollowInnVersion } from "../browser-replay.js";
import type { JarViewModel } from "../cabinet-model.js";
import { CrackLine, JarArt } from "../jar-art.js";
import "../styles/jar-drawer.css";
import { LabReportTable } from "./LabReportTable.js";
import { SpecViewer } from "./SpecViewer.js";

export type DrawerForm = "panel-wide" | "panel-narrow" | "sheet" | "fullscreen";

/** The width of each right-panel form, in CSS pixels (Requirements 10.2, 10.3). */
export const DRAWER_WIDTH_PX = { "panel-wide": 480, "panel-narrow": 420 } as const;

/** The CSS custom property that the page can read to leave room for a right panel. */
export const DRAWER_INSET_PROPERTY = "--jar-drawer-inset";

/** The form for a viewport width. Edges are inclusive: 1280, 1024 and 600 start their form. */
export function drawerFormFor(viewportWidth: number): DrawerForm {
  if (viewportWidth >= 1280) return "panel-wide";
  if (viewportWidth >= 1024) return "panel-narrow";
  if (viewportWidth >= 600) return "sheet";
  return "fullscreen";
}

/** The bottom sheet and the full-screen sheet are modal. The right panel is not. */
export function isModalForm(form: DrawerForm): boolean {
  return form === "sheet" || form === "fullscreen";
}

type TabId = "jarred" | "replayed";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/** The viewport width, updated on resize. */
function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/** The Result_Entry of a jar in the current replay, or null when the jar has none. */
function entryFor(jar: JarViewModel, result: CabinetReplayResult | null): ResultEntry | null {
  if (result === null) return null;
  const match = result.jars.find((entry) =>
    entry.id !== null ? entry.id === jar.id : `${entry.session_id}#${entry.seq}` === jar.accession,
  );
  return match ?? null;
}

function formatJson(value: unknown): string {
  return value === null || value === undefined ? "not recorded" : JSON.stringify(value, null, 2);
}

export type JarDrawerProps = {
  /** The Jar to show, or null while the drawer is closed. */
  jar: JarViewModel | null;
  /** The Version the page shows. Used in the not-replayed statement (Requirement 10.14). */
  version: HollowInnVersion;
  /** The current Replay_Result, or null before a replay of the selected Version. */
  result: CabinetReplayResult | null;
  /** The committed Bugfix_Specs, passed to SpecViewer. */
  specs: readonly BugfixSpec[];
  /** Called by Escape and by the Close control. The parent sets `jar` to null. */
  onClose: () => void;
};

export function JarDrawer({ jar, version, result, specs, onClose }: JarDrawerProps): ReactElement | null {
  const form = drawerFormFor(useViewportWidth());
  const modal = isModalForm(form);
  const isOpen = jar !== null;
  const accession = jar?.accession ?? null;
  const replayed = jar !== null && jar.state !== "not replayed";

  const drawerRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ jarred: null, replayed: null });
  const lastFocusedTab = useRef<TabId | null>(null);
  const headingId = useId();
  const tabListLabel = useId();
  const panelId = useId();
  const [selected, setSelected] = useState<TabId>("jarred");

  // The element focused when each Jar is activated. Escape returns focus to the latest one.
  // Focus inside the drawer never replaces it.
  useEffect(() => {
    if (accession === null) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !drawerRef.current?.contains(active)) {
      originRef.current = active;
    }
  }, [accession]);

  // Opening moves focus to the heading (Requirement 10.9).
  useEffect(() => {
    if (isOpen) headingRef.current?.focus();
  }, [isOpen]);

  // Closing returns focus to the origin (Requirement 10.8). The origin is cleared after use.
  useEffect(() => {
    if (isOpen) return undefined;
    const origin = originRef.current;
    originRef.current = null;
    if (origin !== null && origin.isConnected) origin.focus();
    return undefined;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // A modal drawer makes the other body children inert and keeps Tab inside itself (Requirement 10.10).
  useEffect(() => {
    const root = drawerRef.current;
    if (!isOpen || !modal || root === null) return undefined;

    const inerted: { element: Element; hadAttribute: boolean }[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child === root) continue;
      inerted.push({ element: child, hadAttribute: child.hasAttribute("inert") });
      child.setAttribute("inert", "");
    }

    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Tab") return;
      const items = focusableIn(root);
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      const inside = active instanceof Node && root.contains(active);
      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      for (const { element, hadAttribute } of inerted) {
        if (!hadAttribute) element.removeAttribute("inert");
      }
    };
  }, [isOpen, modal]);

  // A right panel reserves its width on the page, so the layout can keep the jars clear of it.
  useEffect(() => {
    const root = document.documentElement;
    if (!isOpen || (form !== "panel-wide" && form !== "panel-narrow")) {
      root.style.removeProperty(DRAWER_INSET_PROPERTY);
      return undefined;
    }
    root.style.setProperty(DRAWER_INSET_PROPERTY, `${DRAWER_WIDTH_PX[form]}px`);
    return () => {
      root.style.removeProperty(DRAWER_INSET_PROPERTY);
    };
  }, [isOpen, form]);

  // The Replayed tab is disabled once the Jar is not replayed. Focus on it moves to the Jarred tab.
  useEffect(() => {
    if (!replayed && lastFocusedTab.current === "replayed") {
      tabRefs.current.jarred?.focus();
      lastFocusedTab.current = "jarred";
    }
  }, [replayed]);

  if (jar === null) return null;

  const activeTab: TabId = replayed ? selected : "jarred";
  const order: TabId[] = replayed ? ["jarred", "replayed"] : ["jarred"];
  const entry = entryFor(jar, result);
  const flagLabel = jar.flagWord ?? jar.state.toUpperCase();

  const selectTab = (id: TabId): void => {
    setSelected(id);
    tabRefs.current[id]?.focus();
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: TabId): void => {
    const index = order.indexOf(current);
    const last = order.length - 1;
    let target: TabId | undefined;
    switch (event.key) {
      case "ArrowRight":
        target = order[index === last ? 0 : index + 1];
        break;
      case "ArrowLeft":
        target = order[index <= 0 ? last : index - 1];
        break;
      case "Home":
        target = order[0];
        break;
      case "End":
        target = order[last];
        break;
      default:
        return;
    }
    event.preventDefault();
    if (target !== undefined) selectTab(target);
  };

  const tabButton = (id: TabId, label: string): ReactElement => (
    <button
      ref={(node) => {
        tabRefs.current[id] = node;
      }}
      type="button"
      role="tab"
      id={`${tabListLabel}-${id}`}
      className="jar-drawer__tab"
      aria-selected={activeTab === id}
      aria-controls={panelId}
      tabIndex={activeTab === id ? 0 : -1}
      disabled={id === "replayed" && !replayed}
      onClick={() => setSelected(id)}
      onKeyDown={(event) => onTabKeyDown(event, id)}
      onFocus={() => {
        lastFocusedTab.current = id;
      }}
      onBlur={() => {
        lastFocusedTab.current = null;
      }}
    >
      {label}
    </button>
  );

  const panel =
    activeTab === "jarred" ? (
      <>
        <h3 className="jar-drawer__subheading">Jarred body</h3>
        <pre className="jar-drawer__data">{jar.responseText ?? "no response recorded"}</pre>
      </>
    ) : jar.replayedText !== null ? (
      <pre className="jar-drawer__data">{jar.replayedText}</pre>
    ) : (
      <p className="jar-drawer__statement">
        No replayed text. Reason: <span className="jar-drawer__data">{jar.reason ?? "no reason recorded"}</span>
      </p>
    );

  const section = (
    <section
      ref={drawerRef}
      className="jar-drawer"
      data-form={form}
      role={modal ? "dialog" : "region"}
      aria-modal={modal ? "true" : undefined}
      aria-labelledby={headingId}
    >
      <CrackLine className="jar-drawer__crack" />
      <header className="jar-drawer__header">
        <span className="jar-drawer__mini" aria-hidden="true">
          <JarArt className="jar-drawer__svg" state={jar.state} accession={jar.accession} tool={jar.tool} />
        </span>
        <div className="jar-drawer__titles">
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="jar-drawer__heading">
            {jar.accession}
          </h2>
          <p className="jar-drawer__tool">{jar.tool}</p>
          <p className="jar-drawer__place">
            {jar.rackCode} · shelf position {jar.positionCode}
          </p>
          <p className="jar-drawer__flag" data-flag={jar.flagWord === null ? "none" : jar.flagWord.toLowerCase()}>
            {flagLabel}
          </p>
        </div>
        <button type="button" className="jar-drawer__close" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="jar-drawer__body">
        {replayed && entry !== null ? (
          <section className="jar-drawer__section" aria-label="Lab report">
            <h3 className="jar-drawer__subheading">Lab report</h3>
            <LabReportTable entry={entry} />
          </section>
        ) : null}

        <section className="jar-drawer__section" aria-label="Bugfix spec for this Jar">
          <SpecViewer jar={jar} specs={specs} result={result} />
        </section>

        <section className="jar-drawer__section" aria-label="Jarred input">
          <h3 className="jar-drawer__subheading">Jarred input</h3>
          <pre className="jar-drawer__data">{formatJson(jar.input)}</pre>
        </section>

        <section className="jar-drawer__section" aria-label="Jar bodies">
          <div role="tablist" aria-label="Jar data" className="jar-drawer__tabs">
            {tabButton("jarred", "Jarred")}
            {tabButton("replayed", "Replayed")}
          </div>

          {replayed ? null : (
            <p className="jar-drawer__statement">No replay has been made for this Version ({version}).</p>
          )}

          <div id={panelId} role="tabpanel" aria-labelledby={`${tabListLabel}-${activeTab}`} tabIndex={0} className="jar-drawer__panel">
            {panel}
          </div>
        </section>
      </div>
    </section>
  );

  return createPortal(section, document.body);
}
