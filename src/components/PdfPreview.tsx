import { useEffect, useRef, useState } from "react";
import { loadPdf, renderPageToCanvas, type PDFDocumentProxy } from "@/lib/pdf/pdfjs";
import { cn } from "@/lib/utils";

/** Load a pdf.js document from raw bytes, destroying it on cleanup. */
export function usePdfDocument(bytes: ArrayBuffer | null) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bytes) {
      setDoc(null);
      return;
    }
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setError(null);
    loadPdf(bytes)
      .then((d) => {
        if (cancelled) return void d.destroy();
        loaded = d;
        setDoc(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not read this PDF");
          setDoc(null);
        }
      });
    return () => {
      cancelled = true;
      setDoc(null);
      void loaded?.destroy();
    };
  }, [bytes]);

  return { doc, error };
}

interface PdfPageCanvasProps {
  doc: PDFDocumentProxy;
  /** 1-based page number. */
  pageNumber: number;
  /** Target CSS width in px; render scale derives from it. */
  width: number;
  /** Extra rotation to preview, degrees clockwise. */
  rotation?: number;
  className?: string;
  onRendered?: (info: { width: number; height: number }) => void;
}

/** Renders one PDF page into a canvas at roughly the given display width. */
export function PdfPageCanvas({
  doc,
  pageNumber,
  width,
  rotation = 0,
  className,
  onRendered,
}: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1, rotation: page.rotate + rotation });
        const scale = (width / base.width) * (window.devicePixelRatio || 1);
        const canvas = canvasRef.current;
        if (!canvas) return;
        const viewport = page.getViewport({ scale, rotation: page.rotate + rotation });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) {
          onRenderedRef.current?.({ width: canvas.width, height: canvas.height });
        }
        page.cleanup();
      } catch {
        // Rendering may be interrupted when the doc is destroyed mid-flight.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber, width, rotation]);

  return (
    <canvas
      ref={canvasRef}
      className={cn("h-auto w-full", className)}
      role="img"
      aria-label={`Page ${pageNumber}`}
    />
  );
}

/** First-page thumbnail for a file, used in file lists. */
export function FileThumbnail({ bytes, className }: { bytes: ArrayBuffer; className?: string }) {
  const { doc } = usePdfDocument(bytes);
  return (
    <div className={cn("overflow-hidden rounded border bg-white", className)}>
      {doc ? <PdfPageCanvas doc={doc} pageNumber={1} width={96} /> : <div className="aspect-[3/4]" />}
    </div>
  );
}

export { renderPageToCanvas };
