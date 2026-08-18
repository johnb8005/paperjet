import { Lock, Zap } from "lucide-react";
import { Link } from "@/lib/router";
import { TOOLS } from "@/lib/tools";
import { cn } from "@/lib/utils";

/**
 * Homepage = tool grid. One click from landing to any tool, no marketing
 * scroll before the tools (PRD §5).
 */
export function HomePage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Every PDF tool you need. <span className="text-primary">Nothing you don’t.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
          The fastest way to get a PDF task done and get on with your day. No account, no
          uploads for most tools — your files are processed right here in your browser.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-4 text-emerald-600" aria-hidden /> Private by design
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Zap className="size-4 text-amber-500" aria-hidden /> No account required
          </span>
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <li key={tool.id}>
              <Link
                to={tool.path}
                className="group flex h-full flex-col gap-3 rounded-xl border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
              >
                <div
                  className={cn(
                    "flex size-11 items-center justify-center rounded-lg",
                    tool.accent,
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                </div>
                <div>
                  <h2 className="font-semibold group-hover:text-primary">{tool.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{tool.tagline}</p>
                </div>
                {!tool.clientSide ? (
                  <p className="mt-auto text-xs text-muted-foreground">
                    Server-side · files deleted within 1 hour
                  </p>
                ) : (
                  <p className="mt-auto text-xs text-emerald-700">
                    100% in your browser
                  </p>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
