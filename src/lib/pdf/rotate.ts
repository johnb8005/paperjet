import { PDFDocument, degrees } from "pdf-lib";

/**
 * Apply per-page rotation deltas (in degrees, clockwise, multiples of 90)
 * on top of each page's existing rotation.
 */
export async function rotatePdf(
  bytes: ArrayBuffer,
  deltas: number[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const delta = deltas[i] ?? 0;
    if (delta % 360 === 0) return;
    const current = page.getRotation().angle;
    page.setRotation(degrees(((current + delta) % 360 + 360) % 360));
  });
  return doc.save();
}
