// Production build: bundles the SPA into dist/ for static hosting (CDN).
// The Word→PDF API (src/server.ts) deploys separately; everything else is static.
import tailwind from "bun-plugin-tailwind";
import { cp, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["src/index.html"],
  outdir: "dist",
  minify: true,
  sourcemap: "linked",
  plugins: [tailwind],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// pdf.js renders in a web worker loaded from a plain URL at runtime.
const workerPath = Bun.resolveSync("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.dir);
await cp(workerPath, "dist/pdf.worker.min.mjs");

console.log(`Built ${result.outputs.length} files to dist/`);
