import { useState } from "react";
import { FileText, ShieldCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/Dropzone";
import { Processing } from "@/components/Processing";
import { ResultPanel, type ResultFile } from "@/components/ResultPanel";
import { ToolShell } from "@/components/ToolShell";
import { baseName, formatBytes } from "@/lib/files";
import { MAX_TOTAL_BYTES } from "@/lib/limits";
import { docxToPdf } from "@/lib/pdf/docx";
import { toolById } from "@/lib/tools";

const tool = toolById("word-to-pdf")!;

export function WordToPdfPage() {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultFile | null>(null);

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
      // Give React a frame to paint the progress state before the CPU-heavy
      // conversion runs on the main thread.
      await new Promise((resolve) => setTimeout(resolve, 30));
      const bytes = await docxToPdf(await file.arrayBuffer());
      setResult({
        blob: new Blob([bytes.slice().buffer], { type: "application/pdf" }),
        name: `${baseName(file.name)}.pdf`,
      });
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
          {!file ? (
            <Dropzone
              accept={tool.accept}
              onFiles={accept}
              title="Drop a Word document (.docx) here"
              hint="Converted right here in your browser"
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
              <Button size="lg" onClick={convert}>
                Convert to PDF
              </Button>
            </div>
          )}
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <Alert>
            <span className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
              <span>
                Your document <strong>never leaves your device</strong> — the conversion runs
                entirely in your browser.
              </span>
            </span>
          </Alert>
          <p className="text-xs text-muted-foreground">
            Supports text formatting, styles, lists, tables, images, links and page setup.
            Headers/footers, footnotes, text boxes and non-Latin scripts aren’t rendered yet,
            and fonts are substituted with the PDF standard fonts.
          </p>
        </div>
      )}
    </ToolShell>
  );
}
