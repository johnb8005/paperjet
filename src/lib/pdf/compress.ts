import { PDFDocument } from "pdf-lib";
import { canvasToBlob, loadPdf, renderPageToCanvas } from "./pdfjs";
import type { ProgressFn } from "./merge";

export type CompressPreset = "light" | "balanced" | "extreme";

export interface PresetDef {
  id: CompressPreset;
  name: string;
  description: string;
  /** Render scale (1 = page size in points ≈ 72 dpi). */
  scale: number;
  /** JPEG quality 0..1. */
  quality: number;
}

export const PRESETS: PresetDef[] = [
  {
    id: "light",
    name: "Light",
    description: "Best quality, modest savings (~90% quality)",
    scale: 2,
    quality: 0.9,
  },
  {
    id: "balanced",
    name: "Balanced",
    description: "Good quality, strong savings — recommended",
    scale: 1.5,
    quality: 0.7,
  },
  {
    id: "extreme",
    name: "Extreme",
    description: "Smallest size, visibly reduced quality",
    scale: 1,
    quality: 0.45,
  },
];

/**
 * Compress a PDF in the browser by re-rendering each page and re-encoding it
 * as a JPEG at the preset's resolution and quality. Very effective for
 * scanned/image-heavy documents; text stays legible but becomes rasterized.
 */
export async function compressPdf(
  bytes: ArrayBuffer,
  preset: PresetDef,
  onProgress?: ProgressFn,
): Promise<Uint8Array> {
  const src = await loadPdf(bytes);
  try {
    const out = await PDFDocument.create();
    for (let i = 1; i <= src.numPages; i++) {
      const page = await src.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const canvas = await renderPageToCanvas(page, preset.scale);
      const blob = await canvasToBlob(canvas, "image/jpeg", preset.quality);
      const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const newPage = out.addPage([viewport.width, viewport.height]);
      newPage.drawImage(jpg, {
        x: 0,
        y: 0,
        width: viewport.width,
        height: viewport.height,
      });
      page.cleanup();
      onProgress?.(i, src.numPages);
    }
    return out.save();
  } finally {
    await src.destroy();
  }
}
