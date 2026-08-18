import type { ReactNode } from "react";
import { ArrowLeft, Lock, Server } from "lucide-react";
import { Link } from "@/lib/router";
import { Badge } from "@/components/ui/badge";
import type { ToolDef } from "@/lib/tools";
import { cn } from "@/lib/utils";

interface ToolShellProps {
  tool: ToolDef;
  children: ReactNode;
}

export function ToolShell({ tool, children }: ToolShellProps) {
  const Icon = tool.icon;
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> All tools
      </Link>
      <header className="mb-8">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-xl",
              tool.accent,
            )}
          >
            <Icon className="size-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{tool.name}</h1>
            <p className="mt-1 text-muted-foreground">{tool.tagline}</p>
            <div className="mt-2">
              {tool.clientSide ? (
                <Badge variant="success">
                  <Lock className="size-3" aria-hidden />
                  Processed in your browser — files never leave your device
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <Server className="size-3" aria-hidden />
                  Processed on our servers — deleted within 1 hour
                </Badge>
              )}
            </div>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
