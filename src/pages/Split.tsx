import { useState } from "react";
import { Scissors } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dropzone } from "@/components/Dropzone";
import { PdfPageCanvas, usePdfDocument } from "@/components/PdfPreview";
import { Processing } from "@/components/Processing";
import { ResultPanel, type ResultFile } from "@/components/ResultPanel";
import { ToolShell } from "@/components/ToolShell";
import { zipSync } from "fflate";
import { baseName } from "@/lib/files";
import { burstPages, extractRanges, parseRanges } from "@/lib/pdf/split";
import { toolById } from "@/lib/tools";
import { usePendingFile } from "@/lib/usePendingFile";
import { cn } from "@/lib/utils";

const tool = toolById("split")!;

type Mode = "ranges" | "burst";

export function SplitPage() {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [mode, setMode] = useState<Mode>("ranges");
  const [rangeInput, setRangeInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<ResultFile[] | null>(null);
  const [bundle, setBundle] = useState<ResultFile | undefined>(undefined);

  const { doc, error: loadError } = usePdfDocument(bytes);

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
    if (!bytes || !doc || !file) return;
    setError(null);
    try {
      let outputs: Uint8Array[];
      let names: string[];
      const base = baseName(file.name);
      if (mode === "burst") {
        setProgress({ done: 0, total: doc.numPages });
        outputs = await burstPages(bytes, (done, total) => setProgress({ done, total }));
        const pad = String(doc.numPages).length;
        names = outputs.map((_, i) => `${base}-page-${String(i + 1).padStart(pad, "0")}.pdf`);
      } else {
        const groups = parseRanges(rangeInput, doc.numPages);
        setProgress({ done: 0, total: groups.length });
        outputs = await extractRanges(bytes, groups, (done, total) =>
          setProgress({ done, total }),
        );
        names = groups.map((g, i) =>
          groups.length === 1
            ? `${base}-pages-${g[0]! + 1}-${g[g.length - 1]! + 1}.pdf`
            : `${base}-part-${i + 1}.pdf`,
        );
      }
      const files: ResultFile[] = outputs.map((out, i) => ({
        blob: new Blob([out.slice().buffer], { type: "application/pdf" }),
        name: names[i]!,
      }));
      setResults(files);
      if (files.length > 1) {
        const entries: Record<string, Uint8Array> = {};
        outputs.forEach((out, i) => (entries[names[i]!] = out));
        const zipped = zipSync(entries, { level: 0 });
        setBundle({
          blob: new Blob([zipped.slice().buffer], { type: "application/zip" }),
          name: `${base}-split.zip`,
        });
      } else {
        setBundle(undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Splitting failed");
    } finally {
      setProgress(null);
    }
  };

  const reset = () => {
    setFile(null);
    setBytes(null);
    setResults(null);
    setBundle(undefined);
    setRangeInput("");
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
        <Processing label="Splitting PDF…" done={progress.done} total={progress.total} />
      ) : !bytes ? (
        <Dropzone accept={tool.accept} onFiles={accept} title="Drop a PDF here to split" />
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex gap-2" role="tablist" aria-label="Split mode">
                <Button
                  role="tab"
                  aria-selected={mode === "ranges"}
                  variant={mode === "ranges" ? "default" : "outline"}
                  onClick={() => setMode("ranges")}
                >
                  Extract ranges
                </Button>
                <Button
                  role="tab"
                  aria-selected={mode === "burst"}
                  variant={mode === "burst" ? "default" : "outline"}
                  onClick={() => setMode("burst")}
                >
                  Every page separately
                </Button>
              </div>

              {mode === "ranges" ? (
                <div className="space-y-2">
                  <Label htmlFor="ranges">
                    Pages to extract{doc ? ` (document has ${doc.numPages} pages)` : ""}
                  </Label>
                  <Input
                    id="ranges"
                    placeholder="e.g. 1-3, 5, 8-10 — each range becomes its own PDF"
                    value={rangeInput}
                    onChange={(e) => setRangeInput(e.target.value)}
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Every page becomes its own single-page PDF
                  {doc ? ` — you’ll get ${doc.numPages} files, plus a zip.` : "."}
                </p>
              )}

              <Button
                size="lg"
                onClick={run}
                disabled={!doc || (mode === "ranges" && !rangeInput.trim())}
              >
                <Scissors aria-hidden /> Split PDF
              </Button>
            </CardContent>
          </Card>

          {loadError ? <Alert variant="destructive">{loadError}</Alert> : null}
          {error ? <Alert variant="destructive">{error}</Alert> : null}

          {doc ? (
            <div>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                {file?.name} · {doc.numPages} pages
              </h2>
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                {Array.from({ length: Math.min(doc.numPages, 24) }, (_, i) => (
                  <li key={i} className={cn("overflow-hidden rounded border bg-white")}>
                    <PdfPageCanvas doc={doc} pageNumber={i + 1} width={140} />
                    <p className="border-t bg-muted px-1 py-0.5 text-center text-xs">{i + 1}</p>
                  </li>
                ))}
              </ul>
              {doc.numPages > 24 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Showing the first 24 pages of {doc.numPages}.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </ToolShell>
  );
}
