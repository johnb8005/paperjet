import { PDFDocument } from "pdf-lib";

export type ProgressFn = (done: number, total: number) => void;

/** Merge PDFs in order into a single document. Runs entirely in the browser. */
export async function mergePdfs(
  files: ArrayBuffer[],
  onProgress?: ProgressFn,
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  let done = 0;
  for (const bytes of files) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const page of pages) out.addPage(page);
    done += 1;
    onProgress?.(done, files.length);
  }
  return out.save();
}
