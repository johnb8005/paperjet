// Dev/production app server: serves the bundled SPA (with SPA fallback for
// deep links), the pdf.js worker file and a health probe. Every tool —
// Word → PDF included — runs in the browser, so there is no conversion API.
import index from "./index.html";

const pdfWorkerPath = Bun.resolveSync(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.dir,
);
const fontsDir = new URL("../fonts/", import.meta.url);

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/pdf.worker.min.mjs": () =>
      new Response(Bun.file(pdfWorkerPath), {
        headers: { "Content-Type": "text/javascript" },
      }),
    // TrueType fonts for the Word → PDF renderer (copied to dist/fonts in builds).
    "/fonts/:name": async (req) => {
      const name = req.params.name;
      if (!/^[\w-]+\.ttf$/.test(name)) return new Response("Not found", { status: 404 });
      const file = Bun.file(new URL(name, fontsDir));
      if (!(await file.exists())) return new Response("Not found", { status: 404 });
      return new Response(file, {
        headers: { "Content-Type": "font/ttf", "Cache-Control": "public, max-age=31536000, immutable" },
      });
    },
    "/api/health": () => Response.json({ ok: true }),
    // SPA: every other path serves the app shell; the client router takes over.
    "/*": index,
  },
});

console.log(`Paperjet running at ${server.url}`);
