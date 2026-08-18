import { describe, expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { mergePdfs } from "../src/lib/pdf/merge";
import { burstPages, extractRanges, parseRanges } from "../src/lib/pdf/split";
import { rotatePdf } from "../src/lib/pdf/rotate";

async function makePdf(pageCount: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([600, 800]);
    page.drawText(`Page ${i + 1}`, { x: 50, y: 750, size: 24 });
  }
  const bytes = await doc.save();
  return bytes.slice().buffer as ArrayBuffer;
}

async function pageCountOf(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

describe("mergePdfs", () => {
  test("merges files in order and reports progress", async () => {
    const a = await makePdf(2);
    const b = await makePdf(3);
    const progress: Array<[number, number]> = [];
    const merged = await mergePdfs([a, b], (done, total) => progress.push([done, total]));
    expect(await pageCountOf(merged)).toBe(5);
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});

describe("parseRanges", () => {
  test("parses single pages and ranges into groups", () => {
    expect(parseRanges("1-3, 5", 10)).toEqual([[0, 1, 2], [4]]);
  });

  test("accepts a bare page number", () => {
    expect(parseRanges("7", 10)).toEqual([[6]]);
  });

  test("rejects out-of-bounds pages", () => {
    expect(() => parseRanges("11", 10)).toThrow(/outside the document/);
    expect(() => parseRanges("0", 10)).toThrow();
  });

  test("rejects reversed and malformed ranges", () => {
    expect(() => parseRanges("5-2", 10)).toThrow(/reversed/);
    expect(() => parseRanges("abc", 10)).toThrow(/not a valid page/);
    expect(() => parseRanges("", 10)).toThrow(/at least one page/);
  });
});

describe("extractRanges / burstPages", () => {
  test("extracts each group into its own document", async () => {
    const src = await makePdf(6);
    const outputs = await extractRanges(src, [
      [0, 1, 2],
      [4, 5],
    ]);
    expect(outputs).toHaveLength(2);
    expect(await pageCountOf(outputs[0]!)).toBe(3);
    expect(await pageCountOf(outputs[1]!)).toBe(2);
  });

  test("bursts a document into single pages", async () => {
    const src = await makePdf(4);
    const outputs = await burstPages(src);
    expect(outputs).toHaveLength(4);
    for (const out of outputs) {
      expect(await pageCountOf(out)).toBe(1);
    }
  });
});

describe("rotatePdf", () => {
  test("applies per-page rotation deltas on top of existing rotation", async () => {
    const src = await makePdf(3);
    const out = await rotatePdf(src, [90, 0, 270]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(1).getRotation().angle).toBe(0);
    expect(doc.getPage(2).getRotation().angle).toBe(270);
  });

  test("normalizes negative deltas", async () => {
    const src = await makePdf(1);
    const out = await rotatePdf(src, [-90]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(0).getRotation().angle).toBe(270);
  });
});
