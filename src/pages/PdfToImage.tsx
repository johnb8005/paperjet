import { useState } from "react";
import { FileImage } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dropzone } from "@/components/Dropzone";
import { Processing } from "@/components/Processing";
import { ResultPanel, type ResultFile } from "@/components/ResultPanel";
import { ToolShell } from "@/components/ToolShell";
import { baseName, formatBytes } from "@/lib/files";
import { pdfToImages, zipImages } from "@/lib/pdf/images";
import { toolById } from "@/lib/tools";
import { usePendingFile } from "@/lib/usePendingFile";

const tool = toolById("pdf-to-image")!;

export function PdfToImagePage() {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [scale, setScale] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<ResultFile[] | null>(null);
  const [bundle, setBundle] = useState<ResultFile | undefined>(undefined);

  const accept = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setBytes(await f.arrayBuffer());
    setResults(null);
    setError(null);
  };

  usePendingFile((f) => void accept([f]));

  const run = async () => {
    if (!bytes || !file) return;
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      const base = baseName(file.name);
      const images = await pdfToImages(
        bytes,
        base,
        { format, quality: 0.92, scale },
        (done, total) => setProgress({ done, total }),
      );
      setResults(images.map((img) => ({ blob: img.blob, name: img.name })));
      if (images.length > 1) {
        setBundle({ blob: await zipImages(images), name: `${base}-images.zip` });
      } else {
        setBundle(undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setProgress(null);
    }
  };

  const reset = () => {
    setFile(null);
    setBytes(null);
    setResults(null);
    setBundle(undefined);
    setError(null);
  };

  return (
    <ToolShell tool={tool}>
      {results ? (
        <ResultPanel
          results={results}
          bundle={bundle}
          currentToolId={tool.id}
          onStartOver={reset}
        />
      ) : progress ? (
        <Processing label="Rendering pages…" done={progress.done} total={progress.total} />
      ) : !bytes ? (
        <Dropzone accept={tool.accept} onFiles={accept} title="Drop a PDF here to export images" />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {file?.name} · {formatBytes(file?.size ?? 0)}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="format">Image format</Label>
              <Select
                id="format"
                value={format}
                onChange={(e) => setFormat(e.target.value as "png" | "jpeg")}
              >
                <option value="png">PNG (lossless)</option>
                <option value="jpeg">JPG (smaller files)</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="scale">Resolution</Label>
              <Select
                id="scale"
                value={String(scale)}
                onChange={(e) => setScale(Number(e.target.value))}
              >
                <option value="1">Standard (72 dpi)</option>
                <option value="2">High (144 dpi)</option>
                <option value="3">Very high (216 dpi)</option>
              </Select>
            </div>
          </div>
          <Button size="lg" onClick={run}>
            <FileImage aria-hidden /> Export images
          </Button>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
        </div>
      )}
    </ToolShell>
  );
}
