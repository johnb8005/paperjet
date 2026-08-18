import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PDFDocument } from "pdf-lib";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let client: Client;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "paperjet-mcp-test-"));
  client = new Client({ name: "test-client", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: "bun",
    args: [join(import.meta.dir, "../src/mcp.ts")],
  });
  await client.connect(transport);
});

afterAll(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

async function makePdf(path: string, pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    doc.addPage([600, 800]).drawText(`Page ${i + 1}`, { x: 40, y: 750, size: 24 });
  }
  await Bun.write(path, await doc.save());
}

describe("paperjet MCP server", () => {
  test("lists the expected tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "docx_to_pdf",
      "images_to_pdf",
      "markdown_to_pdf",
      "merge_pdfs",
      "rotate_pdf",
      "split_pdf",
    ]);
  });

  test("merge_pdfs merges files", async () => {
    const a = join(dir, "a.pdf");
    const b = join(dir, "b.pdf");
    await makePdf(a, 2);
    await makePdf(b, 3);
    const out = join(dir, "merged.pdf");
    const result = await client.callTool({
      name: "merge_pdfs",
      arguments: { input_paths: [a, b], output_path: out },
    });
    expect(result.isError).toBeFalsy();
    const doc = await PDFDocument.load(await Bun.file(out).arrayBuffer());
    expect(doc.getPageCount()).toBe(5);
  });

  test("split_pdf extracts ranges", async () => {
    const src = join(dir, "src.pdf");
    await makePdf(src, 6);
    const outDir = join(dir, "split");
    const result = await client.callTool({
      name: "split_pdf",
      arguments: { input_path: src, ranges: "1-2, 5", output_dir: outDir },
    });
    expect(result.isError).toBeFalsy();
    const part1 = await PDFDocument.load(await Bun.file(join(outDir, "src-part-1.pdf")).arrayBuffer());
    const part2 = await PDFDocument.load(await Bun.file(join(outDir, "src-part-2.pdf")).arrayBuffer());
    expect(part1.getPageCount()).toBe(2);
    expect(part2.getPageCount()).toBe(1);
  });

  test("rotate_pdf rotates selected pages", async () => {
    const src = join(dir, "rot.pdf");
    await makePdf(src, 3);
    const out = join(dir, "rotated.pdf");
    const result = await client.callTool({
      name: "rotate_pdf",
      arguments: { input_path: src, degrees: 90, pages: "2", output_path: out },
    });
    expect(result.isError).toBeFalsy();
    const doc = await PDFDocument.load(await Bun.file(out).arrayBuffer());
    expect(doc.getPage(0).getRotation().angle).toBe(0);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
  });

  test("markdown_to_pdf renders text", async () => {
    const out = join(dir, "md.pdf");
    const result = await client.callTool({
      name: "markdown_to_pdf",
      arguments: { markdown: "# Hello\n\nFrom **MCP**.", output_path: out },
    });
    expect(result.isError).toBeFalsy();
    const doc = await PDFDocument.load(await Bun.file(out).arrayBuffer());
    expect(doc.getPageCount()).toBe(1);
  });

  test("surfaces errors for missing files", async () => {
    const result = await client.callTool({
      name: "merge_pdfs",
      arguments: { input_paths: ["/nope/a.pdf", "/nope/b.pdf"], output_path: join(dir, "x.pdf") },
    });
    expect(result.isError).toBe(true);
  });
});
