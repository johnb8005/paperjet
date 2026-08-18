import { ArrowRight, Check, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { downloadBlob, formatBytes } from "@/lib/files";
import { setPendingFile } from "@/lib/chain";
import { TOOLS, type ToolDef } from "@/lib/tools";
import { useRouter } from "@/lib/router";
import { cn } from "@/lib/utils";

export interface ResultFile {
  blob: Blob;
  name: string;
}

interface ResultPanelProps {
  results: ResultFile[];
  /** Extra download offered when there are many results (e.g. a zip). */
  bundle?: ResultFile;
  currentToolId: string;
  onStartOver: () => void;
  note?: string;
}

/**
 * The post-processing screen: download, chain the output into another tool,
 * or start over — per the PRD's result-page requirements.
 */
export function ResultPanel({ results, bundle, currentToolId, onStartOver, note }: ResultPanelProps) {
  const { navigate } = useRouter();
  const single = results.length === 1 ? results[0] : undefined;
  const chainable =
    single && single.blob.type === "application/pdf"
      ? TOOLS.filter((t) => t.acceptsPdf && t.id !== currentToolId)
      : [];

  const chainTo = (tool: ToolDef) => {
    if (!single) return;
    setPendingFile(new File([single.blob], single.name, { type: single.blob.type }));
    navigate(tool.path);
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <Check className="size-5" aria-hidden />
          </div>
          <div>
            <h2 className="font-semibold">Done!</h2>
            <p className="text-sm text-muted-foreground">
              {results.length === 1
                ? "Your file is ready."
                : `${results.length} files are ready.`}
              {note ? ` ${note}` : ""}
            </p>
          </div>
        </div>

        <ul className="mb-4 divide-y rounded-lg border">
          {results.map((r, i) => (
            <li key={i} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(r.blob.size)}</p>
              </div>
              <Button size="sm" onClick={() => downloadBlob(r.blob, r.name)}>
                <Download aria-hidden /> Download
              </Button>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          {bundle ? (
            <Button variant="outline" onClick={() => downloadBlob(bundle.blob, bundle.name)}>
              <Download aria-hidden /> Download all ({bundle.name})
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onStartOver}>
            <RefreshCw aria-hidden /> Start over
          </Button>
        </div>

        {chainable.length > 0 ? (
          <div className="mt-6 border-t pt-4">
            <p className="mb-3 text-sm font-medium text-muted-foreground">
              Continue with this file in another tool
            </p>
            <div className="flex flex-wrap gap-2">
              {chainable.map((tool) => {
                const Icon = tool.icon;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => chainTo(tool)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-accent",
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                    {tool.name}
                    <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
