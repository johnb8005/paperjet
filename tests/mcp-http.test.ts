import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PDFDocument } from "pdf-lib";
import { join } from "node:path";
import type { Subprocess } from "bun";

const PORT = 39271;
const TOKEN = "test-secret";
const BASE = `http://localhost:${PORT}`;

let proc: Subprocess;
let client: Client;

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("MCP HTTP server did not start");
}

beforeAll(async () => {
  proc = Bun.spawn(["bun", join(import.meta.dir, "../src/mcp-http.ts")], {
    env: { ...process.env, PORT: String(PORT), MCP_AUTH_TOKEN: TOKEN },
    stdout: "ignore",
    stderr: "inherit",
  });
  await waitForServer();
  client = new Client({ name: "test-client", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  await client.connect(transport);
});

afterAll(async () => {
  await client.close();
  proc.kill();
});

async function makePdfBase64(pages: number): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    doc.addPage([600, 800]).drawText(`Page ${i + 1}`, { x: 40, y: 750, size: 24 });
  }
  return Buffer.from(await doc.save()).toString("base64");
}

function firstBlob(result: Awaited<ReturnType<Client["callTool"]>>): Uint8Array {
  const content = result.content as Array<{ type: string; resource?: { blob?: string } }>;
  const res = content.find((c) => c.type === "resource");
  if (!res?.resource?.blob) throw new Error("No blob resource in result");
  return Uint8Array.from(Buffer.from(res.resource.blob, "base64"));
}

describe("paperjet remote MCP (streamable http)", () => {
  test("rejects requests without the bearer token", async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(401);
  });

  test("lists tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain("merge_pdfs");
    expect(names).toContain("markdown_to_pdf");
    expect(names).toContain("split_pdf");
    expect(names).toContain("rotate_pdf");
    expect(names).toContain("images_to_pdf");
  });

  test("merge_pdfs merges base64 inputs and returns a PDF blob", async () => {
    const result = await client.callTool({
      name: "merge_pdfs",
      arguments: {
        files: [{ data_base64: await makePdfBase64(2) }, { data_base64: await makePdfBase64(3) }],
      },
    });
    expect(result.isError).toBeFalsy();
    const doc = await PDFDocument.load(firstBlob(result));
    expect(doc.getPageCount()).toBe(5);
  });

  test("split_pdf returns one resource per range", async () => {
    const result = await client.callTool({
      name: "split_pdf",
      arguments: { file: { data_base64: await makePdfBase64(6) }, ranges: "1-2, 5-6" },
    });
    expect(result.isError).toBeFalsy();
    const blobs = (result.content as Array<{ type: string }>).filter((c) => c.type === "resource");
    expect(blobs).toHaveLength(2);
  });

  test("markdown_to_pdf renders text", async () => {
    const result = await client.callTool({
      name: "markdown_to_pdf",
      arguments: { markdown: "# Remote\n\nHello from **HTTP**." },
    });
    expect(result.isError).toBeFalsy();
    const doc = await PDFDocument.load(firstBlob(result));
    expect(doc.getPageCount()).toBe(1);
  });

  test("blocks URLs that resolve to private addresses", async () => {
    const result = await client.callTool({
      name: "markdown_to_pdf",
      arguments: { url: "http://127.0.0.1:9/readme.md" },
    });
    expect(result.isError).toBe(true);
  });
});
