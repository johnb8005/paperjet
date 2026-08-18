import { useRef, useState } from "react";
import { Check, Download, PenLine, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dropzone } from "@/components/Dropzone";
import { PdfPageCanvas, usePdfDocument } from "@/components/PdfPreview";
import { ResultPanel, type ResultFile } from "@/components/ResultPanel";
import { SignaturePad } from "@/components/SignaturePad";
import { ToolShell } from "@/components/ToolShell";
import { baseName } from "@/lib/files";
import {
  applySignature,
  clearSavedSignature,
  loadSavedSignature,
  saveSignature,
} from "@/lib/pdf/sign";
import { toolById } from "@/lib/tools";
import { usePendingFile } from "@/lib/usePendingFile";

const tool = toolById("sign")!;

interface Placement {
  xFrac: number;
  yFrac: number;
  widthFrac: number;
}

export function SignPage() {
  const [file, setFile] = useState<File | null>(null);
  const [workingBytes, setWorkingBytes] = useState<ArrayBuffer | null>(null);
  const [signature, setSignature] = useState<string | null>(() => loadSavedSignature());
  const [pageNumber, setPageNumber] = useState(1);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [stamped, setStamped] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultFile | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const { doc, error: loadError } = usePdfDocument(workingBytes);

  const accept = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setWorkingBytes(await f.arrayBuffer());
    setPageNumber(1);
    setPlacement(null);
    setStamped(0);
    setResult(null);
    setError(null);
  };

  usePendingFile((f) => void accept([f]));

  const setSig = (dataUrl: string) => {
    setSignature(dataUrl);
    saveSignature(dataUrl);
  };

  const placeAt = (clientX: number, clientY: number) => {
    const box = previewRef.current?.getBoundingClientRect();
    if (!box) return;
    const xFrac = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    const yFrac = Math.min(1, Math.max(0, (clientY - box.top) / box.height));
    setPlacement((prev) => ({ xFrac, yFrac, widthFrac: prev?.widthFrac ?? 0.3 }));
  };

  const stamp = async () => {
    if (!workingBytes || !signature || !placement) return;
    setBusy(true);
    setError(null);
    try {
      const png = new Uint8Array(await (await fetch(signature)).arrayBuffer());
      const out = await applySignature(workingBytes, png, {
        pageIndex: pageNumber - 1,
        ...placement,
      });
      const copy = out.slice();
      setWorkingBytes(copy.buffer as ArrayBuffer);
      setPlacement(null);
      setStamped((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place the signature");
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    if (!workingBytes || !file) return;
    setResult({
      blob: new Blob([workingBytes], { type: "application/pdf" }),
      name: `${baseName(file.name)}-signed.pdf`,
    });
  };

  const reset = () => {
    setFile(null);
    setWorkingBytes(null);
    setPlacement(null);
    setStamped(0);
    setResult(null);
    setError(null);
  };

  return (
    <ToolShell tool={tool}>
      {result ? (
        <ResultPanel results={[result]} currentToolId={tool.id} onStartOver={reset} />
      ) : !workingBytes ? (
        <div className="space-y-4">
          <Dropzone accept={tool.accept} onFiles={accept} title="Drop a PDF here to sign" />
          <Alert>
            Your signature is stored only in this browser and is never uploaded. This is a
            fill-&amp;-sign tool — it does not produce a certified legal e-signature with an
            audit trail.
          </Alert>
        </div>
      ) : (
        <div className="space-y-4">
          {!signature ? (
            <>
              <h2 className="font-semibold">First, create your signature</h2>
              <SignaturePad onDone={setSig} />
            </>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Label htmlFor="page-select">Page</Label>
                  <Select
                    id="page-select"
                    className="w-32"
                    value={String(pageNumber)}
                    onChange={(e) => {
                      setPageNumber(Number(e.target.value));
                      setPlacement(null);
                    }}
                  >
                    {Array.from({ length: doc?.numPages ?? 1 }, (_, i) => (
                      <option key={i} value={i + 1}>
                        Page {i + 1}
                      </option>
                    ))}
                  </Select>
                </div>
                <div
                  ref={previewRef}
                  className="relative cursor-crosshair touch-none overflow-hidden rounded-lg border bg-white shadow-sm"
                  onPointerDown={(e) => {
                    dragging.current = true;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    placeAt(e.clientX, e.clientY);
                  }}
                  onPointerMove={(e) => {
                    if (dragging.current) placeAt(e.clientX, e.clientY);
                  }}
                  onPointerUp={() => (dragging.current = false)}
                  aria-label="Page preview — click or drag to position your signature"
                >
                  {doc ? <PdfPageCanvas doc={doc} pageNumber={pageNumber} width={700} /> : null}
                  {placement ? (
                    <img
                      src={signature}
                      alt="Signature placement preview"
                      className="pointer-events-none absolute drop-shadow"
                      style={{
                        left: `${placement.xFrac * 100}%`,
                        top: `${placement.yFrac * 100}%`,
                        width: `${placement.widthFrac * 100}%`,
                        transform: "translate(-50%, -50%)",
                      }}
                    />
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Click (or drag) on the page where the signature should go.
                </p>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border bg-card p-3">
                  <p className="mb-2 text-sm font-medium">Your signature</p>
                  <img
                    src={signature}
                    alt="Your saved signature"
                    className="max-h-20 w-full rounded border bg-white object-contain p-2"
                  />
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        clearSavedSignature();
                        setSignature(null);
                        setPlacement(null);
                      }}
                    >
                      <Trash2 aria-hidden /> Replace
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Saved in this browser only — never uploaded.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sig-size">
                    Size ({Math.round((placement?.widthFrac ?? 0.3) * 100)}% of page width)
                  </Label>
                  <input
                    id="sig-size"
                    type="range"
                    min={10}
                    max={60}
                    value={Math.round((placement?.widthFrac ?? 0.3) * 100)}
                    onChange={(e) =>
                      setPlacement((prev) =>
                        prev ? { ...prev, widthFrac: Number(e.target.value) / 100 } : prev,
                      )
                    }
                    disabled={!placement}
                    className="w-full accent-[var(--primary)]"
                  />
                </div>

                <Button className="w-full" disabled={!placement || busy} onClick={stamp}>
                  <PenLine aria-hidden /> {busy ? "Placing…" : "Place signature"}
                </Button>
                <Button
                  className="w-full"
                  variant={stamped > 0 ? "default" : "outline"}
                  disabled={stamped === 0}
                  onClick={finish}
                >
                  {stamped > 0 ? <Check aria-hidden /> : <Download aria-hidden />}
                  Finish ({stamped} placed)
                </Button>
              </div>
            </div>
          )}
          {loadError ? <Alert variant="destructive">{loadError}</Alert> : null}
          {error ? <Alert variant="destructive">{error}</Alert> : null}
        </div>
      )}
    </ToolShell>
  );
}
