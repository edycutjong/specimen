# site/ — the landing page and the pitch deck

Not the product. Two static pages served beside the cabinet on the same Vercel project:

| URL | File |
|---|---|
| `/landing/` | `public/landing/index.html` |
| `/deck/` | `public/deck/index.html` |
| `/static/` | fonts (OFL, from `@fontsource`), images, and `replay.js` |

`vercel.json` builds the cabinet first, then `npx vite build --config site/vite.config.ts`, which copies `public/` into
`apps/cabinet/dist/` and bundles `replay-entry.ts` — the cabinet's own `apps/cabinet/src/browser-replay.ts` — into
`/static/replay.js`. The landing's shelf and the deck run that bundle in the browser, so the replay a visitor sees is
the same code the cabinet runs; if it cannot load, the page shows the committed CLI replay and labels it RECORDED.

The two HTML files are generated (not by Kiro) by a script kept outside this repository (it also renders the social card
and the cabinet screenshots from the working folder). It takes every figure from `evidence/`, `replays/`, `prompts/` and
`.kiro/` at generation time. The check you can run here is `scripts/check_submission_readiness.ts`: the built pages are
present and request no third-party host. Links to this repository appear only when the build sets `VITE_REPO_PUBLIC=1`.
