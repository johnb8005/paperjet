# Paperjet

Fast, private, browser-first PDF tools. Merge, split, compress, convert, rotate, and sign PDFs — no account, no ads, and for 7 of 8 tools **your files never leave your device**.

Built from the [Paperjet PRD](#product-scope): a lighter, faster, more private alternative to iLovePDF/Smallpdf.

## Stack

- **Runtime / bundler / server:** [Bun](https://bun.sh) (fullstack `Bun.serve` with HTML imports)
- **UI:** React 19 + TypeScript, Tailwind CSS v4, shadcn-style components
- **PDF engine (client-side):** [pdf-lib](https://pdf-lib.js.org) for manipulation, [pdf.js](https://mozilla.github.io/pdf.js/) for rendering, [fflate](https://github.com/101arrowz/fflate) for zips
- **Word → PDF (server-side):** headless LibreOffice behind a Bun API route
- **CI typechecking:** [tsgo](https://github.com/microsoft/typescript-go) (`@typescript/native-preview`)

## Getting started

```sh
bun install
bun run dev        # dev server with hot reload → http://localhost:3000
```

Other commands:

```sh
bun run typecheck  # tsgo --noEmit
bun test           # unit tests (merge/split/rotate engines)
bun run build      # static production build → dist/
bun run start      # production server (serves app + conversion API)
```

Word → PDF requires LibreOffice (`soffice`) on the server's PATH; without it the endpoint degrades gracefully to a 503 and the UI explains the service is unavailable.

## Deployment

**GitHub Pages (backend-less):** every push to `main` triggers `.github/workflows/deploy-pages.yml`, which builds the static site with `BASE_PATH=/<repo>` and publishes `dist/` to Pages. All client-side tools work fully; the Word → PDF page detects the missing backend via `/api/health` and shows a service-unavailable notice. Deep links work through the `404.html` SPA fallback. One-time setup: repo **Settings → Pages → Source: GitHub Actions**.

**Full deployment (with Word → PDF):** host `dist/` on any static host/CDN at the root path and run `bun run start` (needs LibreOffice) behind `/api/*`.

`BASE_PATH` controls subpath hosting: it prefixes bundled asset URLs, router paths, and the pdf.js worker URL at build time (see `build.ts` and `src/lib/base.ts`).

## Tools

| Tool | Route | Processing |
|------|-------|------------|
| Merge | `/merge` | Client-side (pdf-lib) — drag-to-reorder, up to 20 files / 100 MB |
| Split | `/split` | Client-side — extract ranges (`1-3, 5`) or burst to single pages + zip |
| Compress | `/compress` | Client-side — Light / Balanced / Extreme presets, before/after size |
| PDF → Image | `/pdf-to-image` | Client-side — PNG/JPG at 72–216 dpi, zip for multi-page |
| Image → PDF | `/image-to-pdf` | Client-side — JPG/PNG/WebP, EXIF auto-orient, drag-to-reorder |
| Rotate | `/rotate` | Client-side — per-page or all pages, live thumbnails |
| Word → PDF | `/word-to-pdf` | **Server-side** — LibreOffice headless, files hard-deleted immediately |
| Sign | `/sign` | Client-side — draw/type/upload, stored in `localStorage` only |

Every result page offers **download → chain into another tool → start over**.

## Privacy model

- **Client-side tools** never upload anything: pdf-lib/pdf.js run in the browser (pdf.js in a web worker). This is stated on every tool page.
- **Word → PDF** writes the upload to a per-request temp directory and hard-deletes it in a `finally` block — files never outlive the request (well inside the PRD's 1-hour promise). No file-content analytics anywhere.
- Signatures for the Sign tool live in `localStorage` and are never sent to a server.

## Architecture notes

- `src/server.ts` — Bun fullstack server: serves the bundled SPA (with SPA fallback for deep links), the pdf.js worker file, `/api/health`, and `POST /api/convert/docx`.
- `src/lib/pdf/` — pure processing engines (merge, split, rotate, compress, images, sign), UI-free and unit-tested where they don't need a DOM.
- `src/pages/` — one lazy-loadable page per tool; `src/components/` — shared shell (dropzone with drag/browse/paste, progress, result panel with chaining).
- `build.ts` — static build to `dist/` for CDN hosting; the conversion API deploys separately, matching the PRD's client-side-first cost model.
- Compression re-renders pages to JPEG at preset resolution/quality (rasterizes text). A Ghostscript-WASM pipeline that preserves vector text is the planned upgrade path.

## Product scope

v1 implements the 8 core tools from the PRD (§4) with the free-tier limits (20 files / 100 MB per task), the UX requirements (§5: tool-grid homepage, drag-and-drop + paste everywhere, progress feedback, result-page chaining, no account wall), and the privacy stance (§6). Monetization (§7) and user management are out of scope for now — user auth will be integrated separately.

## License

[MIT](./LICENSE)
