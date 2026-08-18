#!/usr/bin/env bun
// Paperjet remote MCP server — Streamable HTTP transport, stateless.
//
// Unlike src/mcp.ts (stdio, local file paths), this variant is meant to be
// hosted: clients pass files in-band as URLs or base64, and receive results
// back as base64 PDF resources. Connect from claude.ai / Claude Code with
// the endpoint URL, e.g. https://your-host/mcp
//
// Env:
//   PORT            — listen port (default 3000)
//   MCP_AUTH_TOKEN  — if set, requests must send "Authorization: Bearer <token>"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { lookup } from "node:dns/promises";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { PDFDocument } from "pdf-lib";
import { mergePdfs } from "./lib/pdf/merge";
import { burstPages, extractRanges, parseRanges } from "./lib/pdf/split";
import { rotatePdf } from "./lib/pdf/rotate";
import { markdownToPdf } from "./lib/pdf/markdown";
import { embedImagesToPdf, type ImageInput } from "./lib/pdf/imagesCore";

const PORT = Number(process.env.PORT ?? 3000);
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

// ---------------------------------------------------------------------------
// File intake: URL or base64, with SSRF guards for URL fetches.

const fileSpec = z
  .object({
    url: z.string().optional().describe("HTTP(S) URL to fetch the file from"),
    data_base64: z.string().optional().describe("File content as base64"),
  })
  .describe("One input file: provide either `url` or `data_base64`");

type FileSpec = z.infer<typeof fileSpec>;

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return (
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80") ||
      lower.startsWith("::ffff:") // mapped IPv4 — re-check the v4 part
    );
  }
  const parts = ip.split(".").map(Number);
  const [a, b] = [parts[0] ?? 0, parts[1] ?? 0];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

async function fetchUrl(raw: string): Promise<Uint8Array> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http(s) URLs are supported");
  }
  const { address } = await lookup(url.hostname);
  if (isPrivateIp(address)) {
    throw new Error("URLs resolving to private addresses are not allowed");
  }
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Fetching ${raw} failed with HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error(`File from ${raw} exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB limit`);
  }
  return bytes;
}

async function loadFile(spec: FileSpec): Promise<Uint8Array> {
  if (spec.data_base64) {
    const bytes = Uint8Array.from(Buffer.from(spec.data_base64, "base64"));
    if (bytes.byteLength === 0) throw new Error("data_base64 decoded to zero bytes");
    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error(`Input exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB per-file limit`);
    }
    return bytes;
  }
  if (spec.url) return fetchUrl(spec.url);
  throw new Error("Provide either `url` or `data_base64` for each file");
}

async function loadFiles(specs: FileSpec[]): Promise<Uint8Array[]> {
  const files: Uint8Array[] = [];
  let total = 0;
  for (const spec of specs) {
    const bytes = await loadFile(spec);
    total += bytes.byteLength;
    if (total > MAX_TOTAL_BYTES) {
      throw new Error(`Inputs exceed the ${MAX_TOTAL_BYTES / 1024 / 1024} MB total limit`);
    }
    files.push(bytes);
  }
  return files;
}

function sniffImageKind(bytes: Uint8Array): "png" | "jpg" | null {
  if (bytes.length > 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return "png";
  if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  return null;
}

function pdfResult(name: string, bytes: Uint8Array, summary: string) {
  return {
    content: [
      { type: "text" as const, text: summary },
      {
        type: "resource" as const,
        resource: {
          uri: `paperjet://${name}`,
          name,
          mimeType: "application/pdf",
          blob: Buffer.from(bytes).toString("base64"),
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tool registration (fresh server per request — stateless transport).

function buildServer(): McpServer {
  const server = new McpServer({ name: "paperjet", version: "0.1.0" });

  server.registerTool(
    "merge_pdfs",
    {
      title: "Merge PDFs",
      description: "Merge two or more PDFs (given as URLs or base64) into one PDF, in order.",
      inputSchema: { files: z.array(fileSpec).min(2) },
    },
    async ({ files }) => {
      const inputs = await loadFiles(files);
      const merged = await mergePdfs(inputs.map((b) => b.slice().buffer as ArrayBuffer));
      const pages = (await PDFDocument.load(merged)).getPageCount();
      return pdfResult("merged.pdf", merged, `Merged ${files.length} PDFs into ${pages} pages.`);
    },
  );

  server.registerTool(
    "split_pdf",
    {
      title: "Split PDF",
      description:
        'Extract 1-based page ranges (e.g. "1-3, 5" — each comma group becomes one PDF) or omit ranges to burst every page into its own PDF.',
      inputSchema: { file: fileSpec, ranges: z.string().optional() },
    },
    async ({ file, ranges }) => {
      const bytes = (await loadFile(file)).slice().buffer as ArrayBuffer;
      const pageCount = (await PDFDocument.load(bytes)).getPageCount();
      const groups = ranges?.trim() ? parseRanges(ranges, pageCount) : null;
      const outputs = groups ? await extractRanges(bytes, groups) : await burstPages(bytes);
      const content = [
        { type: "text" as const, text: `Produced ${outputs.length} PDFs.` },
        ...outputs.map((out, i) => ({
          type: "resource" as const,
          resource: {
            uri: `paperjet://part-${i + 1}.pdf`,
            name: `part-${i + 1}.pdf`,
            mimeType: "application/pdf",
            blob: Buffer.from(out).toString("base64"),
          },
        })),
      ];
      return { content };
    },
  );

  server.registerTool(
    "rotate_pdf",
    {
      title: "Rotate PDF",
      description:
        'Rotate pages clockwise by 90/180/270 degrees. Rotates all pages unless a 1-based selection like "2, 4-6" is given.',
      inputSchema: {
        file: fileSpec,
        degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]),
        pages: z.string().optional(),
      },
    },
    async ({ file, degrees, pages }) => {
      const bytes = (await loadFile(file)).slice().buffer as ArrayBuffer;
      const pageCount = (await PDFDocument.load(bytes)).getPageCount();
      const deltas = new Array<number>(pageCount).fill(0);
      if (pages?.trim()) {
        for (const group of parseRanges(pages, pageCount)) {
          for (const idx of group) deltas[idx] = degrees;
        }
      } else {
        deltas.fill(degrees);
      }
      const out = await rotatePdf(bytes, deltas);
      return pdfResult("rotated.pdf", out, `Rotated ${pages?.trim() ? `pages ${pages}` : "all pages"} by ${degrees}°.`);
    },
  );

  server.registerTool(
    "images_to_pdf",
    {
      title: "Images to PDF",
      description: "Combine PNG/JPG images (URLs or base64) into one PDF, one page per image.",
      inputSchema: { images: z.array(fileSpec).min(1) },
    },
    async ({ images }) => {
      const loaded = await loadFiles(images);
      const inputs: ImageInput[] = loaded.map((bytes, i) => {
        const kind = sniffImageKind(bytes);
        if (!kind) throw new Error(`Input ${i + 1} is not a PNG or JPG`);
        return { bytes, kind };
      });
      const out = await embedImagesToPdf(inputs);
      return pdfResult("images.pdf", out, `Combined ${inputs.length} images into a PDF.`);
    },
  );

  server.registerTool(
    "markdown_to_pdf",
    {
      title: "Markdown to PDF",
      description:
        "Render Markdown (headings, lists, code, tables, blockquotes, links) to a clean PDF. Pass the markdown text directly, or a URL to a .md file.",
      inputSchema: {
        markdown: z.string().optional().describe("Markdown text"),
        url: z.string().optional().describe("URL of a Markdown file"),
      },
    },
    async ({ markdown, url }) => {
      let source = markdown;
      if (!source?.trim() && url) source = new TextDecoder().decode(await fetchUrl(url));
      if (!source?.trim()) throw new Error("Provide `markdown` text or a `url`.");
      const out = await markdownToPdf(source);
      const pages = (await PDFDocument.load(out)).getPageCount();
      return pdfResult("document.pdf", out, `Rendered Markdown to ${pages} page${pages === 1 ? "" : "s"}.`);
    },
  );

  if (Bun.which("soffice") ?? Bun.which("libreoffice")) {
    server.registerTool(
      "docx_to_pdf",
      {
        title: "Word to PDF",
        description: "Convert a .docx document (URL or base64) to PDF via headless LibreOffice.",
        inputSchema: { file: fileSpec },
      },
      async ({ file }) => {
        const bytes = await loadFile(file);
        const binary = (Bun.which("soffice") ?? Bun.which("libreoffice"))!;
        const dir = await mkdtemp(join(tmpdir(), "paperjet-remote-"));
        try {
          const inputPath = join(dir, "input.docx");
          await Bun.write(inputPath, bytes.slice());
          const proc = Bun.spawn(
            [binary, "--headless", "--norestore", "--convert-to", "pdf", "--outdir", dir, inputPath],
            { stdout: "ignore", stderr: "ignore", env: { ...process.env, HOME: dir } },
          );
          const timeout = setTimeout(() => proc.kill(), 120_000);
          const exitCode = await proc.exited;
          clearTimeout(timeout);
          const produced = (await readdir(dir)).find((n) => n.endsWith(".pdf"));
          if (exitCode !== 0 || !produced) {
            throw new Error("LibreOffice could not convert this document.");
          }
          const out = new Uint8Array(await Bun.file(join(dir, produced)).arrayBuffer());
          return pdfResult("converted.pdf", out, "Converted the document to PDF.");
        } finally {
          // Privacy contract: uploads never outlive the request.
          await rm(dir, { recursive: true, force: true });
        }
      },
    );
  }

  return server;
}

// ---------------------------------------------------------------------------
// HTTP plumbing (stateless Streamable HTTP: one server+transport per POST).

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_TOTAL_BYTES * 1.5) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const httpServer = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/" || url.pathname === "/health") {
    sendJson(res, 200, {
      name: "paperjet-mcp",
      transport: "streamable-http",
      endpoint: "/mcp",
      docx: Boolean(Bun.which("soffice") ?? Bun.which("libreoffice")),
    });
    return;
  }

  if (url.pathname !== "/mcp") {
    sendJson(res, 404, { error: "Not found — the MCP endpoint is /mcp" });
    return;
  }

  if (AUTH_TOKEN && req.headers.authorization !== `Bearer ${AUTH_TOKEN}`) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  if (req.method !== "POST") {
    // Stateless mode: no SSE stream, no sessions to delete.
    res.writeHead(405, { Allow: "POST" });
    res.end();
    return;
  }

  try {
    const body: unknown = JSON.parse(await readBody(req));
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) {
      sendJson(res, 500, {
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

httpServer.listen(PORT, () => {
  console.log(`Paperjet remote MCP listening on :${PORT} (endpoint: /mcp${AUTH_TOKEN ? ", auth: bearer" : ""})`);
});
