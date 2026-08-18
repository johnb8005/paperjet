// DOM-free image → PDF embedding (used by the MCP server; the web app's
// version in images.ts additionally auto-orients photos via canvas).
import { PDFDocument } from "pdf-lib";

export interface ImageInput {
  bytes: Uint8Array;
  kind: "png" | "jpg";
}

export function kindFromName(name: string): "png" | "jpg" | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg";
  return null;
}

/** Embed each image as one page sized to the image (96 dpi → points). */
export async function embedImagesToPdf(images: ImageInput[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const img of images) {
    const embedded =
      img.kind === "png" ? await out.embedPng(img.bytes) : await out.embedJpg(img.bytes);
    const w = (embedded.width * 72) / 96;
    const h = (embedded.height * 72) / 96;
    const page = out.addPage([w, h]);
    page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
  }
  return out.save();
}
