import { useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/Dropzone";
import { FileThumbnail } from "@/components/PdfPreview";
import { Processing } from "@/components/Processing";
import { ResultPanel, type ResultFile } from "@/components/ResultPanel";
import { ToolShell } from "@/components/ToolShell";
import { formatBytes } from "@/lib/files";
import { checkLimits, MAX_FILES } from "@/lib/limits";
import { mergePdfs } from "@/lib/pdf/merge";
import { toolById } from "@/lib/tools";
import { usePendingFile } from "@/lib/usePendingFile";
import { cn } from "@/lib/utils";

const tool = toolById("merge")!;

interface Item {
  file: File;
  bytes: ArrayBuffer;
  id: number;
}

let nextId = 1;

export function MergePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ResultFile | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const addFiles = async (files: File[]) => {
    setError(null);
    const limitError = checkLimits(
      items.map((i) => i.file),
      files,
    );
    if (limitError) return setError(limitError);
    const loaded: Item[] = [];
    for (const file of files) {
      loaded.push({ file, bytes: await file.arrayBuffer(), id: nextId++ });
    }
    setItems((prev) => [...prev, ...loaded]);
  };

  usePendingFile((file) => void addFiles([file]));

  const move = (from: number, to: number) => {
    setItems((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  };

  const merge = async () => {
    setError(null);
    setProgress({ done: 0, total: items.length });
    try {
      const bytes = await mergePdfs(
        items.map((i) => i.bytes),
        (done, total) => setProgress({ done, total }),
      );
      setResult({
        blob: new Blob([bytes.slice().buffer], { type: "application/pdf" }),
        name: "merged.pdf",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merging failed — is every file a valid PDF?");
    } finally {
      setProgress(null);
    }
  };

  const reset = () => {
    setItems([]);
    setResult(null);
    setError(null);
  };

  return (
    <ToolShell tool={tool}>
      {result ? (
        <ResultPanel results={[result]} currentToolId={tool.id} onStartOver={reset} />
      ) : progress ? (
        <Processing label="Merging PDFs…" done={progress.done} total={progress.total} />
      ) : (
        <div className="space-y-4">
          {items.length === 0 ? (
            <Dropzone
              accept={tool.accept}
              multiple
              onFiles={addFiles}
              title="Drop PDFs here to merge"
              hint={`Up to ${MAX_FILES} files, 100 MB total`}
            />
          ) : (
            <>
              <ol className="space-y-2" aria-label="Files to merge, in order">
                {items.map((item, index) => (
                  <li
                    key={item.id}
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragEnd={() => setDragIndex(null)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dragIndex !== null && dragIndex !== index) {
                        move(dragIndex, index);
                        setDragIndex(index);
                      }
                    }}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border bg-card p-3",
                      dragIndex === index && "opacity-60 ring-2 ring-primary",
                    )}
                  >
                    <GripVertical
                      className="size-4 shrink-0 cursor-grab text-muted-foreground"
                      aria-hidden
                    />
                    <FileThumbnail bytes={item.bytes} className="w-12 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(item.file.size)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Move ${item.file.name} up`}
                        disabled={index === 0}
                        onClick={() => move(index, index - 1)}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Move ${item.file.name} down`}
                        disabled={index === items.length - 1}
                        onClick={() => move(index, index + 1)}
                      >
                        ↓
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${item.file.name}`}
                        onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                      >
                        <Trash2 className="text-muted-foreground" aria-hidden />
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap items-center gap-2">
                <Dropzone
                  accept={tool.accept}
                  multiple
                  compact
                  onFiles={addFiles}
                  title="Add more PDFs"
                  className="max-w-xs"
                />
                <div className="flex-1" />
                <Button size="lg" disabled={items.length < 2} onClick={merge}>
                  <Plus aria-hidden /> Merge {items.length} PDF{items.length === 1 ? "" : "s"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Drag files (or use the arrows) to set the order they’ll appear in the merged PDF.
              </p>
            </>
          )}
          {error ? <Alert variant="destructive">{error}</Alert> : null}
        </div>
      )}
    </ToolShell>
  );
}
