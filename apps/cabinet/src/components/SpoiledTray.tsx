/**
 * The tray of lines left out of the replay (Requirements 14.6, 14.7, 15.4). It lists each spoiled
 * line with its `file:line` and its reason. With no spoiled line it renders nothing, so the tray
 * is omitted from the page.
 */
import type { ReactElement } from "react";
import "../styles/shelf.css";

export type SpoiledTrayProps = {
  spoiled: readonly { file: string; line: number; reason: string }[];
};

export function SpoiledTray({ spoiled }: SpoiledTrayProps): ReactElement | null {
  if (spoiled.length === 0) return null;
  return (
    <section className="spoiled-tray" aria-labelledby="spoiled-tray-title">
      <h2 id="spoiled-tray-title" className="spoiled-tray__title">
        Spoiled lines
      </h2>
      <p>Each line below is left out of the replay. A spoiled line makes the verdict HOLD.</p>
      <ul className="spoiled-tray__list">
        {spoiled.map((item, index) => (
          <li key={index} className="spoiled-tray__item">
            <span className="spoiled-tray__where">{`${item.file}:${item.line}`}</span>
            <span>{item.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
