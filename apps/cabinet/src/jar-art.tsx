/**
 * Jar artwork for the Cabinet (Requirements 8.1, 8.3, 8.11, 9.10, 2.6 to 2.9 and 2.12).
 *
 * The geometry, paths and motif are retyped by hand from the night-lab-specimen jar drawing that
 * the design was made from. Nothing is imported or copied from outside this package. Colours come
 * from the Token_File through `var(--token)`. Shades that the Token_File does not name are derived
 * with `color-mix()` from those tokens, so the file contains no hex literal.
 *
 * Text is not drawn here. The toe-tag words (accession, tool name, ABNORMAL or CRACKED) are HTML
 * drawn by `components/Jar.tsx` over the boxes exported as `TOE_TAG_BOX` and `FLAG_STRIP_BOX`.
 * Every state is distinct by shape even without that text: see `lookOf` and the per-state notes.
 */
import { useId, type CSSProperties, type ReactElement, type ReactNode } from "react";
import type { JarState } from "./cabinet-model.js";

/** The jar's viewBox (`-26 -16 172 222`): lid, neck, glass body and toe-tag. */
export const JAR_VIEW_BOX = "-26 -16 172 222";

/** The curled "{" specimen, the jarred JSON answer preserved in formalin. */
export const BRACE =
  "M11 -34 C1 -34 -3 -28 -3 -19 L-3 -9 C-3 -3 -7 0 -14 0 C-7 0 -3 3 -3 9 L-3 19 C-3 28 1 34 11 34";

/** The glass body outline. */
export const BODY =
  "M24 28 Q10 30 10 46 L10 176 Q10 190 24 190 L96 190 Q110 190 110 176 L110 46 Q110 30 96 28 Z";

/** The inner glass edge, used as the clip path for everything inside the jar. */
export const INNER =
  "M26 33 Q15 35 15 49 L15 173 Q15 185 27 185 L93 185 Q105 185 105 173 L105 49 Q105 35 94 33 Z";

/**
 * The toe-tag's shape box in jar viewBox units, before its rotation. Task 5.2 positions the HTML
 * accession and tool-name text inside this box.
 */
export const TOE_TAG_BOX = { x: 26, y: 116, width: 76, height: 48 } as const;

/** The strip that carries ABNORMAL or CRACKED, in jar viewBox units before the tag rotation. */
export const FLAG_STRIP_BOX = { x: 29, y: 148, width: 73, height: 14 } as const;

/** Toe-tag rotation in degrees. A rattled tag hangs at a different angle from a calm one. */
export function toeTagRotation(state: JarState): number {
  return state === "rattled" ? 4 : -5;
}

export type Mote = { cx: number; cy: number; r: number; opacity: number };

const round = (value: number, digits: number): number => Number(value.toFixed(digits));

/**
 * Deterministic particulate: a linear congruential generator seeded by the caller. The same seed
 * and bounds always give the same motes, so a jar looks identical on every render.
 */
export function moteField(seed: number, count: number, y0: number, y1: number): Mote[] {
  let state = seed;
  const next = (): number => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
  const motes: Mote[] = [];
  for (let i = 0; i < count; i++) {
    const x = 20 + next() * 80;
    const y = y0 + next() * (y1 - y0);
    const r = 0.6 + next() * 1.6;
    const opacity = 0.1 + next() * 0.22;
    motes.push({ cx: round(x, 1), cy: round(y, 1), r: round(r, 1), opacity: round(opacity, 2) });
  }
  return motes;
}

/** Derives a shade from a token: `pct` percent of `token`, the rest is `other`. */
const mixed = (token: string, pct: number, other: string): string =>
  `color-mix(in srgb, ${token} ${pct}%, ${other})`;

/** React's useId output can contain characters that are unsafe in `url(#…)` references. */
const safeId = (raw: string): string => raw.replace(/[^A-Za-z0-9_-]/g, "");

type Stop = { offset: number; color: string };

function LinearStops({ stops }: { stops: readonly Stop[] }): ReactElement {
  return (
    <>
      {stops.map((stop) => (
        <stop key={stop.offset} offset={stop.offset} style={{ stopColor: stop.color }} />
      ))}
    </>
  );
}

const FLUID_STOPS: readonly Stop[] = [
  { offset: 0, color: mixed("var(--before)", 45, "white") },
  { offset: 0.18, color: "var(--before)" },
  { offset: 0.7, color: mixed("var(--before)", 55, "black") },
  { offset: 1, color: mixed("var(--before)", 30, "black") },
];

const RED_STOPS: readonly Stop[] = [
  { offset: 0, color: mixed("var(--after)", 60, "white") },
  { offset: 0.2, color: "var(--after)" },
  { offset: 0.75, color: mixed("var(--after)", 60, "black") },
  { offset: 1, color: mixed("var(--after)", 25, "black") },
];

const DIM_STOPS: readonly Stop[] = [
  { offset: 0, color: mixed("var(--cracked)", 80, "white") },
  { offset: 1, color: mixed("var(--cracked)", 45, "black") },
];

const LID_STOPS: readonly Stop[] = [
  { offset: 0, color: mixed("var(--muted)", 75, "var(--bg)") },
  { offset: 0.45, color: mixed("var(--muted)", 45, "var(--bg)") },
  { offset: 1, color: mixed("var(--bg)", 80, "var(--muted)") },
];

const BOLT_STOPS: readonly Stop[] = [
  { offset: 0, color: mixed("var(--muted)", 90, "var(--ink)") },
  { offset: 0.5, color: mixed("var(--muted)", 50, "var(--bg)") },
  { offset: 1, color: mixed("var(--bg)", 80, "var(--muted)") },
];

type Look = {
  glow: string;
  glowOpacity: number;
  /** Specimen rotation in degrees. */
  rotation: number;
  specimenX: number;
  specimenY: number;
  specimenOpacity: number;
};

/** The per-state look. Each state is also distinct by shape: see the comments on each branch. */
function lookOf(state: JarState): Look {
  switch (state) {
    case "rattled":
      // red flood, shake ghosts and rattle arcs, specimen twitched hard
      return { glow: "var(--after)", glowOpacity: 0.62, rotation: -18, specimenX: 54, specimenY: 92, specimenOpacity: 0.9 };
    case "cracked":
      // dimmed low fluid, crack line, specimen sunk and tilted
      return { glow: "var(--cracked)", glowOpacity: 0.22, rotation: 24, specimenX: 62, specimenY: 150, specimenOpacity: 0.45 };
    case "preserved":
      // green fluid, one bubble, specimen drifting
      return { glow: "var(--before)", glowOpacity: 0.46, rotation: 8, specimenX: 62, specimenY: 92, specimenOpacity: 0.9 };
    case "unsealed":
      // lid lifted off the neck, fluid in a neutral grey
      return { glow: "var(--muted)", glowOpacity: 0.3, rotation: 8, specimenX: 62, specimenY: 92, specimenOpacity: 0.9 };
    case "skipped":
      // no fluid, a diagonal bar across the glass
      return { glow: "var(--muted)", glowOpacity: 0.12, rotation: 8, specimenX: 62, specimenY: 92, specimenOpacity: 0.4 };
    case "not replayed":
      // empty glass, faint specimen, one bubble
      return { glow: "var(--muted)", glowOpacity: 0.16, rotation: 8, specimenX: 62, specimenY: 92, specimenOpacity: 0.6 };
  }
}

export type JarArtProps = {
  state: JarState;
  /** The accession, used only as the mote seed and for the root's `data-accession`. */
  accession: string;
  /** The tool name, used only as the mote seed (lowercased, as in the design input). */
  tool: string;
  /** Tilt in degrees (Requirement 8.2). Applied to the whole jar. */
  tilt?: number;
  className?: string;
};

/**
 * One jar. The SVG is `aria-hidden` because `Jar.tsx` supplies the accessible name on the
 * surrounding button. The root carries `data-state` so CSS in `motion.css` can select by state.
 */
export function JarArt({ state, accession, tool, tilt = 0, className }: JarArtProps): ReactElement {
  const uid = safeId(useId());
  const ids = {
    glow: `${uid}-glow`,
    fluid: `${uid}-fluid`,
    red: `${uid}-red`,
    dim: `${uid}-dim`,
    lid: `${uid}-lid`,
    bolt: `${uid}-bolt`,
    clip: `${uid}-clip`,
  };

  const rattled = state === "rattled";
  const cracked = state === "cracked";
  const unsealed = state === "unsealed";
  const skipped = state === "skipped";
  const notReplayed = state === "not replayed";
  const preserved = state === "preserved";
  const hasFluid = !notReplayed && !skipped;
  const flag = rattled ? "ABNORMAL" : cracked ? "CRACKED" : null;
  const fluidTop = cracked ? 112 : 52;
  const look = lookOf(state);
  const motes = moteField(accession.length * 97 + tool.toLowerCase().length * 13 + 7, 14, fluidTop + 8, 178);

  const meniscusColor = rattled
    ? mixed("var(--after)", 45, "white")
    : cracked
      ? mixed("var(--cracked)", 60, "white")
      : unsealed
        ? "var(--muted)"
        : mixed("var(--before)", 30, "white");

  const body = (
    <>
      <path d={BODY} style={{ fill: "var(--glass)" }} fillOpacity={0.55} />
      <g clipPath={`url(#${ids.clip})`}>
        {(preserved || rattled) && (
          <rect x={10} y={52} width={100} height={138} fill={`url(#${ids.fluid})`} />
        )}
        {rattled && (
          <rect className="jar-art__flood" x={10} y={52} width={100} height={138} fill={`url(#${ids.red})`} />
        )}
        {cracked && (
          <rect x={10} y={112} width={100} height={78} fill={`url(#${ids.dim})`} />
        )}
        {unsealed && (
          <rect
            x={10}
            y={52}
            width={100}
            height={138}
            style={{ fill: mixed("var(--muted)", 40, "var(--bg)") }}
          />
        )}
        {hasFluid && (
          <ellipse cx={60} cy={fluidTop} rx={46} ry={3.2} style={{ fill: meniscusColor }} opacity={0.55} />
        )}
        <ellipse cx={60} cy={186} rx={52} ry={16} style={{ fill: "var(--bg)" }} opacity={0.45} />
        {motes.map((mote, i) => (
          <circle
            key={i}
            cx={mote.cx}
            cy={mote.cy}
            r={mote.r}
            style={{ fill: "var(--ink)" }}
            opacity={mote.opacity}
          />
        ))}
        <g transform={`translate(${look.specimenX} ${look.specimenY}) rotate(${look.rotation})`} opacity={look.specimenOpacity}>
          <g className="jar-art__specimen">
            <path
              d={BRACE}
              fill="none"
              style={{ stroke: "var(--bg)" }}
              strokeOpacity={0.45}
              strokeWidth={12}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={BRACE}
              fill="none"
              style={{ stroke: "var(--ink)" }}
              strokeOpacity={0.82}
              strokeWidth={8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={BRACE}
              fill="none"
              style={{ stroke: rattled ? mixed("var(--after)", 45, "black") : mixed("var(--before)", 35, "var(--bg)") }}
              strokeOpacity={0.55}
              strokeWidth={1.6}
              strokeDasharray="2 4"
              strokeLinecap="round"
            />
          </g>
        </g>
        {skipped && (
          <line
            className="jar-art__slash"
            x1={12}
            y1={44}
            x2={108}
            y2={188}
            style={{ stroke: "var(--ink)" }}
            strokeOpacity={0.55}
            strokeWidth={2.4}
          />
        )}
        {(preserved || notReplayed) && (
          <circle
            className="jar-art__bubble"
            cx={84}
            cy={150}
            r={2.6}
            fill="none"
            style={{ stroke: "var(--ink)" }}
            strokeOpacity={0.5}
            strokeWidth={1}
          />
        )}
        <rect x={20} y={46} width={6} height={124} rx={3} style={{ fill: "var(--ink)" }} opacity={0.16} />
        <rect x={96} y={58} width={3} height={80} rx={1.5} style={{ fill: "var(--ink)" }} opacity={0.1} />
      </g>
      {cracked && <CrackLine variant="jar" />}
      <path
        d={BODY}
        fill="none"
        style={{ stroke: "var(--ink)" }}
        strokeOpacity={0.5}
        strokeWidth={2.6}
      />
      <rect
        x={22}
        y={17}
        width={76}
        height={12}
        rx={3}
        style={{ fill: mixed("var(--glass)", 85, "var(--muted)"), stroke: "var(--bg)" }}
        strokeOpacity={0.6}
      />
      <IronLid lidFill={`url(#${ids.lid})`} boltFill={`url(#${ids.bolt})`} unsealed={unsealed} />
      <path
        d="M40 27 C 34 60 22 96 22 128"
        fill="none"
        style={{ stroke: mixed("var(--tag)", 90, "white") }}
        strokeWidth={1.4}
        strokeOpacity={0.85}
      />
      <g transform={`translate(62 140) rotate(${toeTagRotation(state)})`}>
        <path
          d="M-36 -18 L-30 -24 L40 -24 L40 24 L-30 24 L-36 18 Z"
          style={{ fill: "var(--tag)", stroke: mixed("var(--tag)", 60, "black") }}
          strokeWidth={0.8}
        />
        <circle cx={-28} cy={0} r={4.6} style={{ fill: mixed("var(--tag)", 85, "black") }} />
        <circle cx={-28} cy={0} r={2.4} style={{ fill: "var(--label-ink)" }} />
        <line
          x1={-40}
          y1={-14}
          x2={-28}
          y2={0}
          style={{ stroke: mixed("var(--tag)", 90, "white") }}
          strokeWidth={1.4}
        />
        {flag ? (
          <rect className="jar-art__strip" x={-33} y={8} width={73} height={14} style={{ fill: "var(--after)" }} />
        ) : (
          <line
            x1={-19}
            y1={16}
            x2={32}
            y2={16}
            style={{ stroke: "var(--label-ink)" }}
            strokeOpacity={0.35}
            strokeWidth={0.8}
          />
        )}
      </g>
    </>
  );

  return (
    <svg
      className={className}
      viewBox={JAR_VIEW_BOX}
      aria-hidden="true"
      focusable="false"
      data-state={state}
      data-flag={flag ?? undefined}
      style={{ transform: tilt === 0 ? undefined : `rotate(${tilt}deg)`, transformOrigin: "50% 50%" }}
    >
      <defs>
        <radialGradient id={ids.glow} cx="50%" cy="58%" r="58%">
          <stop offset={0} style={{ stopColor: look.glow }} stopOpacity={look.glowOpacity} />
          <stop offset={0.55} style={{ stopColor: look.glow }} stopOpacity={look.glowOpacity * 0.35} />
          <stop offset={1} style={{ stopColor: look.glow }} stopOpacity={0} />
        </radialGradient>
        <linearGradient id={ids.fluid} x1={0} y1={0} x2={0} y2={1}>
          <LinearStops stops={FLUID_STOPS} />
        </linearGradient>
        <linearGradient id={ids.red} x1={0} y1={0} x2={0} y2={1}>
          <LinearStops stops={RED_STOPS} />
        </linearGradient>
        <linearGradient id={ids.dim} x1={0} y1={0} x2={0} y2={1}>
          <LinearStops stops={DIM_STOPS} />
        </linearGradient>
        <linearGradient id={ids.lid} x1={0} y1={0} x2={0} y2={1}>
          <LinearStops stops={LID_STOPS} />
        </linearGradient>
        <linearGradient id={ids.bolt} x1={0} y1={0} x2={0} y2={1}>
          <LinearStops stops={BOLT_STOPS} />
        </linearGradient>
        <clipPath id={ids.clip}>
          <path d={INNER} />
        </clipPath>
      </defs>
      <ellipse cx={60} cy={116} rx={84} ry={88} fill={`url(#${ids.glow})`} />
      {rattled ? <RattleOverlay>{body}</RattleOverlay> : body}
    </svg>
  );
}

/**
 * The iron lid with four rivets and two neck bolts. Each bolt is a shaft with a hex nut on each
 * side of the neck. An unsealed jar lifts the lid off the neck, and the bolts stay put.
 */
export function IronLid({
  lidFill,
  boltFill,
  unsealed = false,
}: {
  lidFill: string;
  boltFill: string;
  unsealed?: boolean;
}): ReactElement {
  const outline: CSSProperties = { stroke: "var(--bg)" };
  return (
    <>
      <g transform={unsealed ? "translate(0 -9) rotate(-7 60 9)" : undefined}>
        <rect x={16} y={-1} width={88} height={20} rx={4} fill={lidFill} style={outline} strokeOpacity={0.7} />
        <rect x={18} y={1} width={84} height={3} rx={1.5} style={{ fill: "var(--ink)" }} opacity={0.18} />
        {[0, 1, 2, 3].map((k) => (
          <circle key={k} cx={30 + k * 20} cy={11} r={2} style={{ fill: "var(--muted)", stroke: "var(--bg)" }} strokeOpacity={0.6} />
        ))}
      </g>
      <rect x={-4} y={17} width={27} height={9} rx={2} fill={boltFill} />
      <rect x={-12} y={14} width={10} height={15} rx={2} fill={boltFill} style={outline} strokeOpacity={0.6} />
      <rect x={97} y={17} width={27} height={9} rx={2} fill={boltFill} />
      <rect x={122} y={14} width={10} height={15} rx={2} fill={boltFill} style={outline} strokeOpacity={0.6} />
    </>
  );
}

/**
 * The rattle of a rattled jar: two shake ghosts, the body rotated by -3.5 degrees, and four rattle
 * arcs. The whole group sits in one `jar-art__shake` wrapper, so CSS can animate the shake without
 * fighting the SVG `transform` attributes, and Reduced_Motion can switch it off on its own.
 */
export function RattleOverlay({ children }: { children: ReactNode }): ReactElement {
  const red: CSSProperties = { stroke: "var(--after)" };
  return (
    <g className="jar-art__shake">
      <g transform="translate(-7 0) rotate(-3 60 190)" opacity={0.22}>
        <path d={BODY} fill="none" style={red} strokeWidth={2} />
      </g>
      <g transform="translate(7 0) rotate(3 60 190)" opacity={0.16}>
        <path d={BODY} fill="none" style={red} strokeWidth={2} />
      </g>
      <g transform="rotate(-3.5 60 190)">{children}</g>
      <g className="jar-art__arcs" fill="none" style={red} strokeWidth={4} strokeLinecap="round">
        <path d="M-6 84 Q-18 104 -6 124" />
        <path d="M-16 74 Q-32 104 -16 134" strokeOpacity={0.55} />
        <path d="M126 84 Q138 104 126 124" />
        <path d="M136 74 Q152 104 136 134" strokeOpacity={0.55} />
      </g>
    </g>
  );
}

/**
 * A crack. `variant="jar"` draws the crack across a cracked jar's glass in jar coordinates and
 * must sit inside a `JarArt` SVG. `variant="corner"` (the default) is a standalone SVG for a
 * notebook corner in the lab report.
 */
export function CrackLine({
  variant = "corner",
  className,
}: {
  variant?: "corner" | "jar";
  className?: string;
}): ReactElement {
  if (variant === "jar") {
    return (
      <path
        className={className ?? "jar-art__crack"}
        d="M78 40 L70 64 L80 74 L68 104"
        fill="none"
        style={{ stroke: "var(--ink)" }}
        strokeOpacity={0.7}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    );
  }
  const path = "M120 6 L92 22 L98 34 L70 46 L76 60 L48 72 L52 90";
  return (
    <svg className={className} viewBox="0 0 120 90" aria-hidden="true" focusable="false">
      <path d={path} fill="none" style={{ stroke: "var(--bg)" }} strokeWidth={3} strokeLinejoin="round" />
      <path
        d={path}
        fill="none"
        style={{ stroke: "var(--ink)" }}
        strokeOpacity={0.35}
        strokeWidth={1}
        strokeLinejoin="round"
        transform="translate(1 1)"
      />
      <path d="M92 22 L80 14 M70 46 L58 40" fill="none" style={{ stroke: "var(--bg)" }} strokeWidth={2} />
    </svg>
  );
}

/**
 * The barred storm window. It is environment light and never marks a jar state, so it is the only
 * other place besides the lightning where `--storm` appears. `flash` raises the glow for the
 * cold-open lightning. The flash and bolt carry CSS class names for `motion.css`.
 */
export function StormWindow({ flash = true, className }: { flash?: boolean; className?: string }): ReactElement {
  const uid = safeId(useId());
  const ids = { sky: `${uid}-sky`, flash: `${uid}-flash`, clip: `${uid}-clip` };
  const rain = Array.from({ length: 18 }, (_, i) => ({ x: 20 + i * 15.5, y: 30 + ((i * 53) % 300) }));
  const bolt = "M196 30 L158 118 L188 124 L140 230 L162 234 L126 330";
  return (
    <svg className={className} viewBox="0 0 300 400" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={ids.sky} x1={0} y1={0} x2={0} y2={1}>
          <stop offset={0} style={{ stopColor: mixed("var(--storm)", 22, "var(--bg)") }} />
          <stop offset={0.55} style={{ stopColor: mixed("var(--storm)", 12, "var(--bg)") }} />
          <stop offset={1} style={{ stopColor: mixed("var(--storm)", 6, "var(--bg)") }} />
        </linearGradient>
        <radialGradient id={ids.flash} cx="62%" cy="22%" r="60%">
          <stop offset={0} style={{ stopColor: "var(--storm)" }} stopOpacity={flash ? 0.85 : 0.35} />
          <stop offset={1} style={{ stopColor: "var(--storm)" }} stopOpacity={0} />
        </radialGradient>
        <clipPath id={ids.clip}>
          <path d="M30 392 L30 150 Q30 34 150 22 Q270 34 270 150 L270 392 Z" />
        </clipPath>
      </defs>
      <path d="M14 400 L14 148 Q14 14 150 4 Q286 14 286 148 L286 400 Z" style={{ fill: mixed("var(--glass)", 70, "var(--bg)") }} />
      <path
        d="M14 400 L14 148 Q14 14 150 4 Q286 14 286 148 L286 400"
        fill="none"
        style={{ stroke: "var(--rule)" }}
        strokeWidth={3}
      />
      <g clipPath={`url(#${ids.clip})`}>
        <rect width={300} height={400} fill={`url(#${ids.sky})`} />
        <rect className="storm-window__flash" width={300} height={400} fill={`url(#${ids.flash})`} />
        <path
          d="M10 120 Q60 88 110 112 Q150 80 200 108 Q250 84 300 112 L300 160 L0 160 Z"
          style={{ fill: mixed("var(--bg)", 70, "black") }}
          opacity={0.75}
        />
        <path
          d="M0 200 Q50 176 96 196 Q150 168 204 194 Q252 176 300 196 L300 240 L0 240 Z"
          style={{ fill: mixed("var(--bg)", 55, "black") }}
          opacity={0.6}
        />
        <g className="storm-window__bolt">
          <path
            d={bolt}
            fill="none"
            style={{ stroke: "var(--storm)" }}
            strokeOpacity={0.35}
            strokeWidth={14}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d={bolt}
            fill="none"
            style={{ stroke: "white" }}
            strokeWidth={4.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d="M150 160 L118 196"
            fill="none"
            style={{ stroke: "white" }}
            strokeOpacity={0.7}
            strokeWidth={2.4}
            strokeLinecap="round"
          />
        </g>
        <g style={{ stroke: "var(--storm)" }} strokeOpacity={0.18} strokeWidth={1.2}>
          {rain.map((drop, i) => (
            <line key={i} x1={drop.x} y1={drop.y} x2={drop.x - 6} y2={drop.y + 26} />
          ))}
        </g>
      </g>
      <g style={{ fill: "var(--bg)", stroke: "var(--rule)" }} strokeWidth={1.5}>
        <rect x={86} y={24} width={12} height={372} rx={3} />
        <rect x={144} y={18} width={12} height={378} rx={3} />
        <rect x={202} y={24} width={12} height={372} rx={3} />
        <rect x={30} y={232} width={240} height={12} rx={3} />
      </g>
      <g style={{ fill: "var(--muted)" }}>
        {[92, 150, 208].map((x) => (
          <circle key={x} cx={x} cy={238} r={3} />
        ))}
      </g>
      <rect x={4} y={384} width={292} height={16} rx={2} style={{ fill: mixed("var(--glass)", 80, "var(--bg)") }} />
    </svg>
  );
}

/**
 * A surgical suture: a seam with stitch bars crossing it and needle holes at both ends, bolted at
 * each end. Decorative, so it is `aria-hidden`.
 */
export function Suture({ w = 64, className }: { w?: number; className?: string }): ReactElement {
  const h = 24;
  const stitchCount = Math.max(2, Math.round((w - 16) / 11));
  const step = (w - 20) / (stitchCount - 1);
  const stitches = Array.from({ length: stitchCount }, (_, i) => {
    const x = 10 + i * step;
    const t = i % 2 ? 1.2 : -1.2;
    return { x, t };
  });
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" focusable="false">
      <path
        d={`M4 12 Q${w / 2} 14.5 ${w - 4} 12`}
        fill="none"
        style={{ stroke: "var(--cracked)" }}
        strokeWidth={2.6}
        strokeLinecap="round"
      />
      <g style={{ stroke: "var(--tag)" }} strokeWidth={2.4} strokeLinecap="round">
        {stitches.map((s, i) => (
          <line key={i} x1={s.x - s.t} y1={4.5} x2={s.x + s.t} y2={19.5} />
        ))}
      </g>
      <g style={{ fill: "var(--bg)" }}>
        {stitches.map((s, i) => (
          <g key={i}>
            <circle cx={s.x - s.t} cy={4.5} r={1.3} />
            <circle cx={s.x + s.t} cy={19.5} r={1.3} />
          </g>
        ))}
      </g>
      <circle cx={3.5} cy={12} r={3.5} style={{ fill: "var(--muted)" }} />
      <circle cx={w - 3.5} cy={12} r={3.5} style={{ fill: "var(--muted)" }} />
    </svg>
  );
}
