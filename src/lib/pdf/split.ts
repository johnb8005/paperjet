import { PDFDocument } from "pdf-lib";
import type { ProgressFn } from "./merge";

/**
 * Parse a page-range expression like "1-3, 5, 8-10" into groups of 0-based
 * page indices. Each comma-separated group becomes one output document.
 * Throws with a user-facing message on invalid input.
 */
export function parseRanges(input: string, pageCount: number): number[][] {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Enter at least one page or range, e.g. 1-3, 5");
  const groups: number[][] = [];
  for (const part of trimmed.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token);
    if (!match) throw new Error(`"${token}" is not a valid page or range`);
    const start = Number(match[1]);
    const end = match[2] !== undefined ? Number(match[2]) : start;
    if (start < 1 || end < 1 || start > pageCount || end > pageCount) {
      throw new Error(`"${token}" is outside the document (${pageCount} page${pageCount === 1 ? "" : "s"})`);
    }
    if (end < start) throw new Error(`"${token}" is reversed — use ${end}-${start}`);
    const group: number[] = [];
    for (let p = start; p <= end; p++) group.push(p - 1);
    groups.push(group);
  }
  if (groups.length === 0) throw new Error("Enter at least one page or range, e.g. 1-3, 5");
  return groups;
}

/** Extract each group of page indices into its own PDF. */
export async function extractRanges(
  bytes: ArrayBuffer,
  groups: number[][],
  onProgress?: ProgressFn,
): Promise<Uint8Array[]> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const outputs: Uint8Array[] = [];
  for (let i = 0; i < groups.length; i++) {
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, groups[i]!);
    for (const page of pages) out.addPage(page);
    outputs.push(await out.save());
    onProgress?.(i + 1, groups.length);
  }
  return outputs;
}

/** Burst a PDF into one single-page document per page. */
export async function burstPages(
  bytes: ArrayBuffer,
  onProgress?: ProgressFn,
): Promise<Uint8Array[]> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const groups = src.getPageIndices().map((i) => [i]);
  return extractRanges(bytes, groups, onProgress);
}
