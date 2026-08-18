import { useEffect, useRef, useState, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface DropzoneProps {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  title?: string;
  hint?: ReactNode;
  className?: string;
  compact?: boolean;
}

function matchesAccept(file: File, accept: string): boolean {
  const rules = accept.split(",").map((r) => r.trim().toLowerCase());
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith(".")) return name.endsWith(rule);
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

/**
 * File intake supporting drag-and-drop, click-to-browse, and paste
 * (Ctrl/Cmd+V anywhere on the page while mounted).
 */
export function Dropzone({
  accept,
  multiple = false,
  onFiles,
  title,
  hint,
  className,
  compact = false,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  const acceptRef = useRef(accept);
  acceptRef.current = accept;
  const multipleRef = useRef(multiple);
  multipleRef.current = multiple;

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        matchesAccept(f, acceptRef.current),
      );
      if (files.length > 0) {
        e.preventDefault();
        onFilesRef.current(multipleRef.current ? files : files.slice(0, 1));
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const handleFiles = (list: FileList | File[]) => {
    const files = Array.from(list).filter((f) => matchesAccept(f, accept));
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={title ?? "Choose files"}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={cn(
        "flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed text-center transition-colors",
        compact ? "p-4" : "p-10 sm:p-16",
        dragOver
          ? "border-primary bg-accent"
          : "border-border bg-card hover:border-primary/50 hover:bg-accent/50",
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Upload className="size-6" aria-hidden />
      </div>
      <div>
        <p className="font-medium">{title ?? "Drop files here or click to browse"}</p>
        {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
        <p className="mt-1 text-xs text-muted-foreground">
          Drag &amp; drop, browse, or paste from your clipboard
        </p>
      </div>
    </div>
  );
}
