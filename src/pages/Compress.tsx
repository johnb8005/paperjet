import { useState } from "react";
import { ArrowDown, Minimize2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dropzone } from "@/components/Dropzone";
import { Processing } from "@/components/Processing";
import { ResultPanel, type ResultFile } from "@/components/ResultPanel";
import { ToolShell } from "@/components/ToolShell";
import { baseName, formatBytes } from "@/lib/files";
import { compressPdf, PRESETS, type CompressPreset } from "@/lib/pdf/compress";
import { toolById } from "@/lib/tools";
import { usePendingFile } from "@/lib/usePendingFile";
import { cn } from "@/lib/utils";

const tool = toolById("compress")!;

export function CompressPage() {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [preset, setPreset] = useState<CompressPreset>("balanced");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ResultFile | null>(null);
  const [savings, setSavings] = useState<{ before: number; after: number } | null>(null);

  const accept = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setBytes(await f.arrayBuffer());
    setResult(null);
    setSavings(null);
    setError(null);
  };

  usePendingFile((f) => void accept([f]));

  const run = async () => {
    if (!bytes || !file) return;
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      const def = PRESETS.find((p) => p.id === preset)!;
      const out = await compressPdf(bytes, def, (done, total) =>
        setProgress({ done, total }),
      );
      const blob = new Blob([out.slice().buffer], { type: "application/pdf" });
      setSavings({ before: file.size, after: blob.size });
      setResult({ blob, name: `${baseName(file.name)}-compressed.pdf` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compression failed");
    } finally {
      setProgress(null);
    }
  };

  const reset = () => {
    setFile(null);
    setBytes(null);
    setResult(null);
    setSavings(null);
    setError(null);
  };

  const pct =
    savings && savings.before > 0
      ? Math.round((1 - savings.after / savings.before) * 100)
      : 0;

  return (
    <ToolShell tool={tool}>
      {result && savings ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-6 p-6">
              <div>
                <p className="text-xs text-muted-foreground">Before</p>
                <p className="text-xl font-semibold">{formatBytes(savings.before)}</p>
              </div>
              <ArrowDown
                className={cn("size-5", pct > 0 ? "text-emerald-600" : "text-amber-500")}
                aria-hidden
              />
              <div>
                <p className="text-xs text-muted-foreground">After</p>
                <p className="text-xl font-semibold">{formatBytes(savings.after)}</p>
              </div>
              <div
                className={cn(
                  "ml-auto rounded-full px-3 py-1 text-sm font-semibold",
                  pct > 0 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800",
                )}
              >
                {pct > 0 ? `${pct}% smaller` : "No savings on this file"}
              </div>
            </CardContent>
          </Card>
          {pct <= 0 ? (
            <Alert>
              This PDF is already well optimized — the re-encoded version isn’t smaller. Your
              original file is unchanged; try the Extreme preset, or keep the original.
            </Alert>
          ) : null}
          <ResultPanel
            results={[result]}
            currentToolId={tool.id}
            onStartOver={reset}
            note="Text is rasterized at the chosen quality."
          />
        </div>
      ) : progress ? (
        <Processing label="Compressing pages…" done={progress.done} total={progress.total} />
      ) : !bytes ? (
        <Dropzone accept={tool.accept} onFiles={accept} title="Drop a PDF here to compress" />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {file?.name} · {formatBytes(file?.size ?? 0)}
          </p>
          <div
            className="grid gap-3 sm:grid-cols-3"
            role="radiogroup"
            aria-label="Compression preset"
          >
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={preset === p.id}
                onClick={() => setPreset(p.id)}
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors",
                  preset === p.id
                    ? "border-primary bg-accent ring-2 ring-primary"
                    : "bg-card hover:bg-accent/50",
                )}
              >
                <p className="font-semibold">{p.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
              </button>
            ))}
          </div>
          <Button size="lg" onClick={run}>
            <Minimize2 aria-hidden /> Compress PDF
          </Button>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
        </div>
      )}
    </ToolShell>
  );
}
