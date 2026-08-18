import { useEffect, useState } from "react";
import { GripVertical, ImagePlus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/Dropzone";
import { Processing } from "@/components/Processing";
import { ResultPanel, type ResultFile } from "@/components/ResultPanel";
import { ToolShell } from "@/components/ToolShell";
import { formatBytes } from "@/lib/files";
import { checkLimits, MAX_FILES } from "@/lib/limits";
import { imagesToPdf } from "@/lib/pdf/images";
import { toolById } from "@/lib/tools";
import { cn } from "@/lib/utils";

const tool = toolById("image-to-pdf")!;

interface Item {
  file: File;
  url: string;
  id: number;
}

let nextId = 1;

export function ImageToPdfPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ResultFile | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(
    () => () => items.forEach((i) => URL.revokeObjectURL(i.url)),
    // Revoke on unmount only; individual removals revoke inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const addFiles = (files: File[]) => {
    setError(null);
    const limitError = checkLimits(
      items.map((i) => i.file),
      files,
    );
    if (limitError) return setError(limitError);
    setItems((prev) => [
      ...prev,
      ...files.map((file) => ({ file, url: URL.createObjectURL(file), id: nextId++ })),
    ]);
  };

  const remove = (id: number) => {
    setItems((prev) => {
      const item = prev.find((i) => i.id === id);
      if (item) URL.revokeObjectURL(item.url);
      return prev.filter((i) => i.id !== id);
    });
  };

  const move = (from: number, to: number) => {
    setItems((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  };

  const run = async () => {
    setError(null);
    setProgress({ done: 0, total: items.length });
    try {
      const out = await imagesToPdf(
        items.map((i) => i.file),
        (done, total) => setProgress({ done, total }),
      );
      setResult({
        blob: new Blob([out.slice().buffer], { type: "application/pdf" }),
        name: "images.pdf",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed");
    } finally {
      setProgress(null);
    }
  };

  const reset = () => {
    items.forEach((i) => URL.revokeObjectURL(i.url));
    setItems([]);
    setResult(null);
    setError(null);
  };

  return (
    <ToolShell tool={tool}>
      {result ? (
        <ResultPanel results={[result]} currentToolId={tool.id} onStartOver={reset} />
      ) : progress ? (
        <Processing label="Building PDF…" done={progress.done} total={progress.total} />
      ) : (
        <div className="space-y-4">
          {items.length === 0 ? (
            <Dropzone
              accept={tool.accept}
              multiple
              onFiles={addFiles}
              title="Drop images here (JPG, PNG, WebP)"
              hint={`Up to ${MAX_FILES} images. Photos are auto-oriented.`}
            />
          ) : (
            <>
              <ol
                className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
                aria-label="Images, in page order"
              >
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
                      "group relative overflow-hidden rounded-lg border bg-card",
                      dragIndex === index && "opacity-60 ring-2 ring-primary",
                    )}
                  >
                    <img
                      src={item.url}
                      alt={item.file.name}
                      className="aspect-square w-full bg-white object-contain"
                    />
                    <div className="flex items-center gap-1 border-t p-1.5">
                      <GripVertical
                        className="size-3.5 shrink-0 cursor-grab text-muted-foreground"
                        aria-hidden
                      />
                      <p className="min-w-0 flex-1 truncate text-xs">{item.file.name}</p>
                      <button
                        type="button"
                        aria-label={`Remove ${item.file.name}`}
                        onClick={() => remove(item.id)}
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </div>
                    <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white">
                      {index + 1}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap items-center gap-2">
                <Dropzone
                  accept={tool.accept}
                  multiple
                  compact
                  onFiles={addFiles}
                  title="Add more images"
                  className="max-w-xs"
                />
                <div className="flex-1" />
                <Button size="lg" onClick={run}>
                  <ImagePlus aria-hidden /> Create PDF (
                  {formatBytes(items.reduce((s, i) => s + i.file.size, 0))})
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Drag images to reorder pages. Each image becomes one page at its natural size.
              </p>
            </>
          )}
          {error ? <Alert variant="destructive">{error}</Alert> : null}
        </div>
      )}
    </ToolShell>
  );
}
