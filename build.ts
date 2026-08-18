// Production build: bundles the SPA into dist/ for static hosting (CDN or
// GitHub Pages). The Word→PDF API (src/server.ts) deploys separately and is
// optional — without it, the Word to PDF page shows a service-unavailable
// notice and every other tool still works.
//
// Set BASE_PATH (e.g. "/paperjet") to build for subpath hosting.
import tailwind from "bun-plugin-tailwind";
import { cp, rm } from "node:fs/promises";

const rawBase = process.env.BASE_PATH ?? "";
const base = rawBase === "/" ? "" : rawBase.replace(/\/+$/, "");
if (base && !base.startsWith("/")) {
  console.error(`BASE_PATH must start with "/", got "${rawBase}"`);
  process.exit(1);
}

await rm("dist", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["src/index.html"],
  outdir: "dist",
  minify: true,
  sourcemap: "linked",
  plugins: [tailwind],
  publicPath: base ? `${base}/` : undefined,
  define: {
    __BASE_PATH__: JSON.stringify(base),
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// pdf.js renders in a web worker loaded from a plain URL at runtime.
const workerPath = Bun.resolveSync("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.dir);
await cp(workerPath, "dist/pdf.worker.min.mjs");

// SPA deep-link fallback for static hosts that serve 404.html (GitHub Pages).
await cp("dist/index.html", "dist/404.html");

console.log(`Built ${result.outputs.length} files to dist/${base ? ` (base path ${base})` : ""}`);
