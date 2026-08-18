import { useEffect, useState } from "react";
import { FileText, ShieldCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/Dropzone";
import { Processing } from "@/components/Processing";
import { ResultPanel, type ResultFile } from "@/components/ResultPanel";
import { ToolShell } from "@/components/ToolShell";
import { baseName, formatBytes } from "@/lib/files";
import { MAX_TOTAL_BYTES } from "@/lib/limits";
import { toolById } from "@/lib/tools";

const tool = toolById("word-to-pdf")!;

export function WordToPdfPage() {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultFile | null>(null);
  const [serviceUp, setServiceUp] = useState<boolean | null>(null);

  // This is the one tool that needs a server. Probe it so a static-only
  // deployment shows an honest notice instead of failing on submit.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("down"))))
      .then((body: { convert?: boolean }) => {
        if (!cancelled) setServiceUp(body.convert === true);
      })
      .catch(() => {
        if (!cancelled) setServiceUp(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const accept = (files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (f.size > MAX_TOTAL_BYTES) {
      setError(`File is larger than the ${formatBytes(MAX_TOTAL_BYTES)} limit.`);
      return;
    }
    setFile(f);
    setResult(null);
    setError(null);
  };

  const convert = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/convert/docx", { method: "POST", body: form });
      if (!res.ok) {
        let message = "Conversion failed — please try again.";
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // Non-JSON error body; keep the generic message.
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      setResult({ blob, name: `${baseName(file.name)}.pdf` });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Conversion failed — please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
  };

  return (
    <ToolShell tool={tool}>
      {result ? (
        <ResultPanel results={[result]} currentToolId={tool.id} onStartOver={reset} />
      ) : busy ? (
        <Processing label="Converting document…" done={0} total={0} />
      ) : (
        <div className="space-y-4">
          {serviceUp === false ? (
            <Alert variant="destructive">
              The conversion service isn’t available right now. All other Paperjet tools keep
              working — they run entirely in your browser.
            </Alert>
          ) : null}
          {!file ? (
            <Dropzone
              accept={tool.accept}
              onFiles={accept}
              title="Drop a Word document (.docx) here"
              hint="Converted on our servers, then deleted"
            />
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
              <FileText className="size-8 shrink-0 text-indigo-600" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
              </div>
              <Button variant="ghost" onClick={reset}>
                Remove
              </Button>
              <Button size="lg" onClick={convert} disabled={serviceUp === false}>
                Convert to PDF
              </Button>
            </div>
          )}
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <Alert>
            <span className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
              <span>
                This tool uploads your document over an encrypted connection for conversion.
                Files are <strong>deleted from our servers immediately after conversion</strong>{" "}
                (always within 1 hour), are never read by a human, and are never used for
                training.
              </span>
            </span>
          </Alert>
        </div>
      )}
    </ToolShell>
  );
}
