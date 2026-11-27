import { fileURLToPath } from "node:url";
import { defineConfig, transformWithEsbuild, type Plugin } from "vite";

// The landing page, the deck and the judge page: static files in site/public/ (landing/, deck/, judge/, static/), copied next to the cabinet
// in apps/cabinet/dist/ after the cabinet's own build, plus /static/replay.js, the cabinet's replay code bundled for
// those pages. Run from the repository root: `npx vite build --config site/vite.config.ts` (vercel.json does).

// Vite does not minify whitespace in an ES-format library build, so this step does it for the one output file.
const minifyEsLib: Plugin = {
  name: "minify-es-lib",
  async renderChunk(code, chunk) {
    const out = await transformWithEsbuild(code, chunk.fileName, { minify: true, format: "esm", target: "es2022" });
    return { code: out.code, map: null };
  },
};

// The pages link the GitHub repo only once it is public: the same VITE_REPO_PUBLIC switch as the cabinet.
const repoFlag: Plugin = {
  name: "repo-flag",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "static/repo.json", source: JSON.stringify({ public: process.env.VITE_REPO_PUBLIC === "1" }) });
  },
};

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [minifyEsLib, repoFlag],
  build: {
    outDir: "../apps/cabinet/dist",
    emptyOutDir: false,
    target: "es2022",
    lib: { entry: "replay-entry.ts", formats: ["es"], fileName: () => "static/replay.js" },
  },
});
