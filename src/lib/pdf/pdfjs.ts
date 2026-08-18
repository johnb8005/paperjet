import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

// The worker file is served by our server in dev and copied to dist/ by the
// production build (see build.ts and src/server.ts).
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export type { PDFDocumentProxy, PDFPageProxy };

/**
 * Load a PDF for rendering. Copies the input bytes because pdf.js transfers
 * the buffer to its worker, which would detach the caller's copy.
 */
export function loadPdf(bytes: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  const copy = new Uint8Array(bytes instanceof Uint8Array ? bytes.slice() : bytes.slice(0));
  return pdfjs.getDocument({ data: copy }).promise;
}

export async function renderPageToCanvas(
  page: PDFPageProxy,
  scale: number,
  canvas?: HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const target = canvas ?? document.createElement("canvas");
  target.width = Math.ceil(viewport.width);
  target.height = Math.ceil(viewport.height);
  const ctx = target.getContext("2d");
  if (!ctx) throw new Error("Could not create canvas context");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, target.width, target.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return target;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Image encoding failed"))),
      type,
      quality,
    );
  });
}
