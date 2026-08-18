#!/usr/bin/env bun
// Paperjet MCP server (stdio): exposes the same PDF engines that power the
// web app as MCP tools operating on local file paths. Register it with e.g.
//   claude mcp add paperjet -- bun /path/to/paperjet/src/mcp.ts
// Everything runs locally; nothing is uploaded anywhere.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mkdtemp, readdir, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { mergePdfs } from "./lib/pdf/merge";
import { burstPages, extractRanges, parseRanges } from "./lib/pdf/split";
import { rotatePdf } from "./lib/pdf/rotate";
import { markdownToPdf } from "./lib/pdf/markdown";
import { embedImagesToPdf, kindFromName, type ImageInput } from "./lib/pdf/imagesCore";

const server = new McpServer({ name: "paperjet", version: "0.1.0" });

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

async function readPdf(path: string): Promise<ArrayBuffer> {
  const file = Bun.file(resolve(path));
  if (!(await file.exists())) throw new Error(`File not found: ${path}`);
  return file.arrayBuffer();
}

async function writeBytes(path: string, bytes: Uint8Array): Promise<string> {
  const abs = resolve(path);
  await mkdir(dirname(abs), { recursive: true });
  await Bun.write(abs, bytes.slice());
  return abs;
}

server.registerTool(
  "merge_pdfs",
  {
    title: "Merge PDFs",
    description:
      "Merge two or more PDF files into a single PDF, in the given order. All processing is local.",
    inputSchema: {
      input_paths: z.array(z.string()).min(2).describe("Paths of the PDFs to merge, in order"),
      output_path: z.string().describe("Path to write the merged PDF to"),
    },
  },
  async ({ input_paths, output_path }) => {
    const buffers: ArrayBuffer[] = [];
    for (const p of input_paths) buffers.push(await readPdf(p));
    const merged = await mergePdfs(buffers);
    const out = await writeBytes(output_path, merged);
    const pages = (await PDFDocument.load(merged)).getPageCount();
    return ok(`Merged ${input_paths.length} PDFs (${pages} pages) into ${out}`);
  },
);

server.registerTool(
  "split_pdf",
  {
    title: "Split PDF",
    description:
      "Extract page ranges from a PDF into separate PDFs, or burst every page into its own file. Ranges use 1-based pages like \"1-3, 5\" — each comma-separated group becomes one output file. Omit ranges to burst all pages.",
    inputSchema: {
      input_path: z.string().describe("Path of the PDF to split"),
      ranges: z
        .string()
        .optional()
        .describe('Page ranges like "1-3, 5, 8-10"; omit to split every page separately'),
      output_dir: z.string().describe("Directory to write the output PDFs into"),
    },
  },
  async ({ input_path, ranges, output_dir }) => {
    const bytes = await readPdf(input_path);
    const pageCount = (await PDFDocument.load(bytes)).getPageCount();
    const base = basename(input_path, extname(input_path));
    let outputs: Uint8Array[];
    let names: string[];
    if (ranges?.trim()) {
      const groups = parseRanges(ranges, pageCount);
      outputs = await extractRanges(bytes, groups);
      names = groups.map((_, i) => `${base}-part-${i + 1}.pdf`);
    } else {
      outputs = await burstPages(bytes);
      const pad = String(pageCount).length;
      names = outputs.map((_, i) => `${base}-page-${String(i + 1).padStart(pad, "0")}.pdf`);
    }
    const written: string[] = [];
    for (let i = 0; i < outputs.length; i++) {
      written.push(await writeBytes(join(output_dir, names[i]!), outputs[i]!));
    }
    return ok(`Wrote ${written.length} files:\n${written.join("\n")}`);
  },
);

server.registerTool(
  "rotate_pdf",
  {
    title: "Rotate PDF",
    description:
      "Rotate pages of a PDF clockwise by 90, 180, or 270 degrees. Rotates every page unless a 1-based page selection like \"2, 4-6\" is given.",
    inputSchema: {
      input_path: z.string().describe("Path of the PDF to rotate"),
      degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]).describe("Clockwise rotation"),
      pages: z.string().optional().describe('Pages to rotate, e.g. "2, 4-6"; omit for all pages'),
      output_path: z.string().describe("Path to write the rotated PDF to"),
    },
  },
  async ({ input_path, degrees, pages, output_path }) => {
    const bytes = await readPdf(input_path);
    const pageCount = (await PDFDocument.load(bytes)).getPageCount();
    const deltas = new Array<number>(pageCount).fill(0);
    if (pages?.trim()) {
      for (const group of parseRanges(pages, pageCount)) {
        for (const idx of group) deltas[idx] = degrees;
      }
    } else {
      deltas.fill(degrees);
    }
    const out = await writeBytes(output_path, await rotatePdf(bytes, deltas));
    return ok(`Rotated ${pages?.trim() ? `pages ${pages}` : "all pages"} by ${degrees}° → ${out}`);
  },
);

server.registerTool(
  "images_to_pdf",
  {
    title: "Images to PDF",
    description:
      "Combine PNG/JPG images into a single PDF, one page per image, in the given order.",
    inputSchema: {
      input_paths: z.array(z.string()).min(1).describe("Image paths (.png, .jpg) in page order"),
      output_path: z.string().describe("Path to write the PDF to"),
    },
  },
  async ({ input_paths, output_path }) => {
    const images: ImageInput[] = [];
    for (const p of input_paths) {
      const kind = kindFromName(p);
      if (!kind) throw new Error(`Unsupported image type (need .png/.jpg): ${p}`);
      images.push({ bytes: new Uint8Array(await readPdf(p)), kind });
    }
    const out = await writeBytes(output_path, await embedImagesToPdf(images));
    return ok(`Combined ${images.length} images into ${out}`);
  },
);

server.registerTool(
  "markdown_to_pdf",
  {
    title: "Markdown to PDF",
    description:
      "Render Markdown to a clean PDF (headings, lists, code blocks, tables, blockquotes, links). Provide either markdown text or the path of a .md file.",
    inputSchema: {
      markdown: z.string().optional().describe("Markdown text to render"),
      input_path: z.string().optional().describe("Path of a Markdown file to render"),
      output_path: z.string().describe("Path to write the PDF to"),
    },
  },
  async ({ markdown, input_path, output_path }) => {
    let source = markdown;
    if (!source && input_path) source = await Bun.file(resolve(input_path)).text();
    if (!source?.trim()) throw new Error("Provide either `markdown` text or `input_path`.");
    const bytes = await markdownToPdf(source);
    const out = await writeBytes(output_path, bytes);
    const pages = (await PDFDocument.load(bytes)).getPageCount();
    return ok(`Rendered Markdown to ${out} (${pages} page${pages === 1 ? "" : "s"})`);
  },
);

server.registerTool(
  "docx_to_pdf",
  {
    title: "Word to PDF",
    description:
      "Convert a .docx document to PDF using headless LibreOffice (must be installed locally as `soffice`).",
    inputSchema: {
      input_path: z.string().describe("Path of the .docx file"),
      output_path: z.string().describe("Path to write the PDF to"),
    },
  },
  async ({ input_path, output_path }) => {
    const binary = Bun.which("soffice") ?? Bun.which("libreoffice");
    if (!binary) throw new Error("LibreOffice (`soffice`) is not installed or not on PATH.");
    const abs = resolve(input_path);
    if (!(await Bun.file(abs).exists())) throw new Error(`File not found: ${input_path}`);
    const dir = await mkdtemp(join(tmpdir(), "paperjet-mcp-"));
    try {
      const proc = Bun.spawn(
        [binary, "--headless", "--norestore", "--convert-to", "pdf", "--outdir", dir, abs],
        { stdout: "ignore", stderr: "pipe", env: { ...process.env, HOME: dir } },
      );
      const timeout = setTimeout(() => proc.kill(), 120_000);
      const exitCode = await proc.exited;
      clearTimeout(timeout);
      const produced = (await readdir(dir)).find((n) => n.endsWith(".pdf"));
      if (exitCode !== 0 || !produced) {
        throw new Error("LibreOffice could not convert this document.");
      }
      const bytes = new Uint8Array(await Bun.file(join(dir, produced)).arrayBuffer());
      const out = await writeBytes(output_path, bytes);
      return ok(`Converted ${input_path} → ${out}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
