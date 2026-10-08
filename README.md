# Paperjet

Fast, private, browser-first PDF tools. Merge, split, compress, convert, rotate, and sign PDFs — no account, no ads, and **your files never leave your device**: every tool runs entirely in the browser.

Built from the [Paperjet PRD](#product-scope): a lighter, faster, more private alternative to iLovePDF/Smallpdf.

## Stack

- **Runtime / bundler / server:** [Bun](https://bun.sh) (fullstack `Bun.serve` with HTML imports)
- **UI:** React 19 + TypeScript, Tailwind CSS v4, shadcn-style components
- **PDF engine (client-side):** [pdf-lib](https://pdf-lib.js.org) for manipulation, [pdf.js](https://mozilla.github.io/pdf.js/) for rendering, [fflate](https://github.com/101arrowz/fflate) for zips
- **Word → PDF (client-side):** our own DOM-free `.docx` renderer (`src/lib/pdf/docx.ts`) — fflate unzips the document, [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) reads the WordprocessingML, pdf-lib lays it out
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
bun run start      # production server (serves the static app)
```

## Deployment

The app is fully static — there is no backend. **GitHub Pages:** every push to `main` triggers `.github/workflows/deploy-pages.yml`, which builds the site with `BASE_PATH=/<repo>` and publishes `dist/` to Pages. Deep links work through the `404.html` SPA fallback. One-time setup: repo **Settings → Pages → Source: GitHub Actions**. Any other static host/CDN works the same way (`bun run build`, upload `dist/`).

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
| Word → PDF | `/word-to-pdf` | Client-side — styles, lists, tables, images, links, page setup (see [limitations](#word--pdf-renderer)) |
| Markdown → PDF | `/markdown-to-pdf` | Client-side — headings, lists, code, tables, blockquotes |
| Sign | `/sign` | Client-side — draw/type/upload, stored in `localStorage` only |

Every result page offers **download → chain into another tool → start over**.

## MCP server

The same PDF engines are exposed as an [MCP](https://modelcontextprotocol.io) server (stdio), so Claude Code, Claude Desktop, or any MCP client can merge/split/rotate/convert PDFs on local files:

```sh
bun run mcp            # or: bun src/mcp.ts
```

Register with Claude Code:

```sh
claude mcp add paperjet -- bun /path/to/paperjet/src/mcp.ts
```

Or in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "paperjet": { "command": "bun", "args": ["/path/to/paperjet/src/mcp.ts"] }
  }
}
```

**Tools:** `merge_pdfs`, `split_pdf`, `rotate_pdf`, `images_to_pdf`, `markdown_to_pdf`, `docx_to_pdf`. All tools take local file paths and process everything locally — nothing is uploaded, and nothing beyond Bun needs to be installed.

The package exposes a `paperjet-mcp` bin, so publishing to npm would make it runnable via `bunx paperjet-mcp` (Bun is required — the server uses Bun APIs). For wider distribution, add it to an MCP registry listing once published.

### Remote MCP server (hosted)

`src/mcp-http.ts` is the hosted variant: **Streamable HTTP transport, stateless**, for use as a claude.ai custom connector or from any remote MCP client. Because a remote server can't see the caller's disk, tools take files as **URLs or base64** and return PDFs as base64 resources. Limits: 25 MB per file, 100 MB per request; URL fetches are SSRF-guarded (http/https only, private addresses blocked); uploads are processed in memory and never touch disk.

```sh
bun run mcp:remote                      # listens on :3000, endpoint /mcp
MCP_AUTH_TOKEN=secret bun run mcp:remote  # optional bearer-token auth
```

**Deploying:** GitHub Pages and other static hosts can't run it — it needs compute. Every push to `main` builds and publishes a ready-to-run image to **`ghcr.io/johnb8005/paperjet-mcp:latest`** (see `.github/workflows/docker.yml`), so hosts don't have to build anything:

- **Render:** New → Web Service → "Existing image" → `ghcr.io/johnb8005/paperjet-mcp:latest` (or connect the repo and let it build the Dockerfile). Set `MCP_AUTH_TOKEN` if you want auth.
- **Railway:** New service → "Docker Image" → same image.
- **Fly.io:** `fly launch --image ghcr.io/johnb8005/paperjet-mcp:latest`.
- Any VPS: `docker run -p 3000:3000 ghcr.io/johnb8005/paperjet-mcp:latest`.

One-time step for registry deploys: make the GHCR package public (GitHub → your profile → Packages → paperjet-mcp → Package settings → Change visibility → Public), so hosts can pull it without credentials.

Building locally instead: `docker build -t paperjet-mcp .` — the image is just Bun plus the app, no system packages.

Then connect from claude.ai (Settings → Connectors → Add custom connector) or Claude Code:

```sh
claude mcp add --transport http paperjet-remote https://your-host/mcp
```

## Privacy model

- **Every tool** runs in the browser and never uploads anything: pdf-lib/pdf.js run client-side (pdf.js in a web worker), and so does the Word → PDF renderer. This is stated on every tool page. No file-content analytics anywhere.
- Signatures for the Sign tool live in `localStorage` and are never sent to a server.

## Architecture notes

- `src/server.ts` — Bun dev/production server: serves the bundled SPA (with SPA fallback for deep links), the pdf.js worker file and `/api/health`.
- `src/lib/pdf/` — pure processing engines (merge, split, rotate, compress, images, sign, markdown, docx), UI-free and unit-tested where they don't need a DOM.
- `src/pages/` — one lazy-loadable page per tool; `src/components/` — shared shell (dropzone with drag/browse/paste, progress, result panel with chaining).
- `build.ts` — static build to `dist/` for CDN hosting, matching the PRD's client-side-first cost model.
- Compression re-renders pages to JPEG at preset resolution/quality (rasterizes text). A Ghostscript-WASM pipeline that preserves vector text is the planned upgrade path.

### Word → PDF renderer

`src/lib/pdf/docx.ts` is a from-scratch `.docx` layout engine rather than a LibreOffice/WASM port (LibreOffice-in-WASM builds are hundreds of MB and need cross-origin isolation headers that static hosts like GitHub Pages can't set). It converts a typical document in well under a second and handles:

- paragraphs: alignment, indents, hanging indents, spacing, line spacing, borders, shading, tabs, page/line/section breaks, page size and margins
- runs: bold, italic, underline, strikethrough, size, color, highlight, super/subscript, caps, hyperlinks
- styles: paragraph and character styles with `basedOn` chains and document defaults
- lists: bullets and multi-level numbering from `numbering.xml` (decimal, letters, roman)
- tables: grid widths, column spans, vertical merges, borders, cell shading, nested tables
- images: inline PNG and JPEG (other formats show an `[image]` placeholder)

Not rendered yet: headers/footers, footnotes, text boxes and shapes (their text is salvaged inline), floating-image wrapping. Text uses the PDF standard fonts (Helvetica/Times/Courier families chosen by the document's font names), which cover Latin-1 only — other accented Latin letters fall back to their base letter and non-Latin scripts are dropped. Embedding a Unicode font is the planned upgrade path.

## Product scope

v1 implements the 8 core tools from the PRD (§4) with the free-tier limits (20 files / 100 MB per task), the UX requirements (§5: tool-grid homepage, drag-and-drop + paste everywhere, progress feedback, result-page chaining, no account wall), and the privacy stance (§6). Monetization (§7) and user management are out of scope for now — user auth will be integrated separately.

## License

[MIT](./LICENSE)
