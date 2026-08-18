import { PDFDocument } from "pdf-lib";
import { zipSync } from "fflate";
import { canvasToBlob, loadPdf, renderPageToCanvas } from "./pdfjs";
import type { ProgressFn } from "./merge";

export interface PdfToImageOptions {
  format: "png" | "jpeg";
  /** JPEG quality 0..1 (ignored for PNG). */
  quality: number;
  /** Render scale multiplier (1 = 72 dpi equivalent). */
  scale: number;
}

export interface PageImage {
  blob: Blob;
  name: string;
  width: number;
  height: number;
}

/** Render every PDF page to an image, entirely in the browser. */
export async function pdfToImages(
  bytes: ArrayBuffer,
  base: string,
  { format, quality, scale }: PdfToImageOptions,
  onProgress?: ProgressFn,
): Promise<PageImage[]> {
  const doc = await loadPdf(bytes);
  try {
    const images: PageImage[] = [];
    const ext = format === "png" ? "png" : "jpg";
    const pad = String(doc.numPages).length;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const canvas = await renderPageToCanvas(page, scale);
      const blob = await canvasToBlob(
        canvas,
        format === "png" ? "image/png" : "image/jpeg",
        format === "jpeg" ? quality : undefined,
      );
      images.push({
        blob,
        name: `${base}-page-${String(i).padStart(pad, "0")}.${ext}`,
        width: canvas.width,
        height: canvas.height,
      });
      page.cleanup();
      onProgress?.(i, doc.numPages);
    }
    return images;
  } finally {
    await doc.destroy();
  }
}

/** Zip a set of images (stored, not re-compressed — they are already encoded). */
export async function zipImages(images: PageImage[]): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {};
  for (const img of images) {
    entries[img.name] = new Uint8Array(await img.blob.arrayBuffer());
  }
  const zipped = zipSync(entries, { level: 0 });
  return new Blob([zipped.slice().buffer], { type: "application/zip" });
}

/**
 * Combine images into a single PDF. Each image becomes one page sized to the
 * image. EXIF orientation is applied via createImageBitmap ("auto-orient").
 */
export async function imagesToPdf(
  files: File[],
  onProgress?: ProgressFn,
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  let done = 0;
  for (const file of files) {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create canvas context");
    // JPEG has no alpha; white background keeps transparent PNGs readable too.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const isPng = file.type === "image/png";
    const blob = await canvasToBlob(canvas, isPng ? "image/png" : "image/jpeg", 0.92);
    const imgBytes = new Uint8Array(await blob.arrayBuffer());
    const embedded = isPng ? await out.embedPng(imgBytes) : await out.embedJpg(imgBytes);

    // Map pixels to points at 96 dpi so pages print at natural size.
    const w = (canvas.width * 72) / 96;
    const h = (canvas.height * 72) / 96;
    const page = out.addPage([w, h]);
    page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });

    done += 1;
    onProgress?.(done, files.length);
  }
  return out.save();
}
