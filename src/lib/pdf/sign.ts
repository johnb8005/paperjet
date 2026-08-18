import { PDFDocument } from "pdf-lib";

export interface SignaturePlacement {
  /** 0-based page index. */
  pageIndex: number;
  /** Signature center, as a fraction of page width/height from the top-left. */
  xFrac: number;
  yFrac: number;
  /** Signature width as a fraction of page width. */
  widthFrac: number;
}

/**
 * Stamp a PNG signature onto a page. Coordinates arrive as top-left-origin
 * fractions (matching the on-screen preview) and are converted to PDF's
 * bottom-left-origin point space here.
 */
export async function applySignature(
  bytes: ArrayBuffer | Uint8Array,
  signaturePng: Uint8Array,
  placement: SignaturePlacement,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const page = doc.getPage(placement.pageIndex);
  const png = await doc.embedPng(signaturePng);

  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const width = placement.widthFrac * pageWidth;
  const height = width * (png.height / png.width);
  const cx = placement.xFrac * pageWidth;
  const cyFromTop = placement.yFrac * pageHeight;

  page.drawImage(png, {
    x: cx - width / 2,
    y: pageHeight - cyFromTop - height / 2,
    width,
    height,
  });
  return doc.save();
}

const SIGNATURE_KEY = "paperjet.signature";

/** Signatures are stored locally in the browser only — never uploaded. */
export function saveSignature(dataUrl: string) {
  try {
    localStorage.setItem(SIGNATURE_KEY, dataUrl);
  } catch {
    // Storage full or unavailable — reuse is a convenience, not a requirement.
  }
}

export function loadSavedSignature(): string | null {
  try {
    return localStorage.getItem(SIGNATURE_KEY);
  } catch {
    return null;
  }
}

export function clearSavedSignature() {
  try {
    localStorage.removeItem(SIGNATURE_KEY);
  } catch {
    // ignore
  }
}
