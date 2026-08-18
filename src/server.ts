import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import index from "./index.html";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const CONVERT_TIMEOUT_MS = 120_000;

const pdfWorkerPath = Bun.resolveSync(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.dir,
);

function soffice(): string | null {
  return Bun.which("soffice") ?? Bun.which("libreoffice");
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * Convert a .docx upload to PDF with headless LibreOffice.
 * Privacy contract (PRD §6): everything is written to a per-request temp dir
 * that is hard-deleted in `finally` — files never outlive the request.
 */
async function convertDocx(req: Request): Promise<Response> {
  const binary = soffice();
  if (!binary) {
    return jsonError(
      "The conversion service is temporarily unavailable. Please try again later.",
      503,
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError("Expected a multipart form upload with a `file` field.", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonError("Expected a multipart form upload with a `file` field.", 400);
  }
  if (!file.name.toLowerCase().endsWith(".docx")) {
    return jsonError("Only .docx files are supported.", 415);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonError("File is larger than the 100 MB limit.", 413);
  }

  const dir = await mkdtemp(join(tmpdir(), "paperjet-"));
  try {
    const inputPath = join(dir, "input.docx");
    await Bun.write(inputPath, file);

    const proc = Bun.spawn(
      [binary, "--headless", "--norestore", "--convert-to", "pdf", "--outdir", dir, inputPath],
      { stdout: "ignore", stderr: "pipe", env: { ...process.env, HOME: dir } },
    );
    const timeout = setTimeout(() => proc.kill(), CONVERT_TIMEOUT_MS);
    const exitCode = await proc.exited;
    clearTimeout(timeout);

    if (exitCode !== 0) {
      console.error("soffice failed:", await new Response(proc.stderr).text());
      return jsonError(
        "This document could not be converted. It may be corrupted or use unsupported features.",
        422,
      );
    }

    const produced = (await readdir(dir)).find((name) => name.endsWith(".pdf"));
    if (!produced) {
      return jsonError(
        "This document could not be converted. It may be corrupted or use unsupported features.",
        422,
      );
    }

    const pdfBytes = await Bun.file(join(dir, produced)).arrayBuffer();
    return new Response(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("docx conversion error:", err);
    return jsonError("Conversion failed — please try again.", 500);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/pdf.worker.min.mjs": () =>
      new Response(Bun.file(pdfWorkerPath), {
        headers: { "Content-Type": "text/javascript" },
      }),
    "/api/health": () => Response.json({ ok: true, convert: soffice() !== null }),
    "/api/convert/docx": { POST: convertDocx },
    // SPA: every other path serves the app shell; the client router takes over.
    "/*": index,
  },
});

console.log(`Paperjet running at ${server.url}`);
