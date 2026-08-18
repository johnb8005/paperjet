import { useState } from "react";
import { RotateCcw, RotateCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/Dropzone";
import { PdfPageCanvas, usePdfDocument } from "@/components/PdfPreview";
import { Processing } from "@/components/Processing";
import { ResultPanel, type ResultFile } from "@/components/ResultPanel";
import { ToolShell } from "@/components/ToolShell";
import { baseName } from "@/lib/files";
import { rotatePdf } from "@/lib/pdf/rotate";
import { toolById } from "@/lib/tools";
import { usePendingFile } from "@/lib/usePendingFile";

const tool = toolById("rotate")!;

export function RotatePage() {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [deltas, setDeltas] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultFile | null>(null);

  const { doc, error: loadError } = usePdfDocument(bytes);

  const accept = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setBytes(await f.arrayBuffer());
    setDeltas([]);
    setResult(null);
    setError(null);
  };

  usePendingFile((f) => void accept([f]));

  const rotatePage = (index: number, by: number) => {
    setDeltas((prev) => {
      const next = [...prev];
      while (next.length <= index) next.push(0);
      next[index] = ((next[index]! + by) % 360 + 360) % 360;
      return next;
    });
  };

  const rotateAll = (by: number) => {
    if (!doc) return;
    setDeltas((prev) => {
      const next = Array.from({ length: doc.numPages }, (_, i) => prev[i] ?? 0);
      return next.map((d) => ((d + by) % 360 + 360) % 360);
    });
  };

  const hasChanges = deltas.some((d) => d % 360 !== 0);

  const apply = async () => {
    if (!bytes || !file) return;
    setBusy(true);
    setError(null);
    try {
      const out = await rotatePdf(bytes, deltas);
      setResult({
        blob: new Blob([out.slice().buffer], { type: "application/pdf" }),
        name: `${baseName(file.name)}-rotated.pdf`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rotation failed");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null);
    setBytes(null);
    setDeltas([]);
    setResult(null);
    setError(null);
  };

  return (
    <ToolShell tool={tool}>
      {result ? (
        <ResultPanel results={[result]} currentToolId={tool.id} onStartOver={reset} />
      ) : busy ? (
        <Processing label="Applying rotation…" done={0} total={0} />
      ) : !bytes ? (
        <Dropzone accept={tool.accept} onFiles={accept} title="Drop a PDF here to rotate" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => rotateAll(90)}>
              <RotateCw aria-hidden /> Rotate all right
            </Button>
            <Button variant="outline" onClick={() => rotateAll(-90)}>
              <RotateCcw aria-hidden /> Rotate all left
            </Button>
            <div className="flex-1" />
            <Button size="lg" onClick={apply} disabled={!hasChanges}>
              Apply &amp; finish
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Click the buttons under a page to rotate just that page. Previews update live.
          </p>

          {loadError ? <Alert variant="destructive">{loadError}</Alert> : null}
          {error ? <Alert variant="destructive">{error}</Alert> : null}

          {doc ? (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {Array.from({ length: doc.numPages }, (_, i) => (
                <li key={i} className="overflow-hidden rounded-lg border bg-card">
                  <div className="flex min-h-32 items-center justify-center bg-white p-2">
                    <PdfPageCanvas doc={doc} pageNumber={i + 1} width={160} rotation={deltas[i] ?? 0} />
                  </div>
                  <div className="flex items-center justify-between border-t px-2 py-1.5">
                    <span className="text-xs text-muted-foreground">Page {i + 1}</span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label={`Rotate page ${i + 1} left`}
                        onClick={() => rotatePage(i, -90)}
                      >
                        <RotateCcw aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label={`Rotate page ${i + 1} right`}
                        onClick={() => rotatePage(i, 90)}
                      >
                        <RotateCw aria-hidden />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </ToolShell>
  );
}
