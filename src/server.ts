// Dev/production app server: serves the bundled SPA (with SPA fallback for
// deep links), the pdf.js worker file and a health probe. Every tool —
// Word → PDF included — runs in the browser, so there is no conversion API.
import index from "./index.html";

const pdfWorkerPath = Bun.resolveSync(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.dir,
);

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/pdf.worker.min.mjs": () =>
      new Response(Bun.file(pdfWorkerPath), {
        headers: { "Content-Type": "text/javascript" },
      }),
    "/api/health": () => Response.json({ ok: true }),
    // SPA: every other path serves the app shell; the client router takes over.
    "/*": index,
  },
});

console.log(`Paperjet running at ${server.url}`);
