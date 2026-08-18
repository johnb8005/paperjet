import { Send } from "lucide-react";
import { Link, Router, useRouter } from "@/lib/router";
import { TOOLS } from "@/lib/tools";
import { HomePage } from "@/pages/Home";
import { MergePage } from "@/pages/Merge";
import { SplitPage } from "@/pages/Split";
import { CompressPage } from "@/pages/Compress";
import { PdfToImagePage } from "@/pages/PdfToImage";
import { ImageToPdfPage } from "@/pages/ImageToPdf";
import { RotatePage } from "@/pages/Rotate";
import { WordToPdfPage } from "@/pages/WordToPdf";
import { SignPage } from "@/pages/Sign";

const PAGES: Record<string, () => React.JSX.Element> = {
  "/": HomePage,
  "/merge": MergePage,
  "/split": SplitPage,
  "/compress": CompressPage,
  "/pdf-to-image": PdfToImagePage,
  "/image-to-pdf": ImageToPdfPage,
  "/rotate": RotatePage,
  "/word-to-pdf": WordToPdfPage,
  "/sign": SignPage,
};

function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-muted-foreground">
        That page doesn’t exist.{" "}
        <Link to="/" className="text-primary underline underline-offset-4">
          Back to all tools
        </Link>
      </p>
    </div>
  );
}

function Routes() {
  const { path } = useRouter();
  const Page = PAGES[path] ?? NotFound;
  return <Page />;
}

export function App() {
  return (
    <Router>
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
            <Link to="/" className="flex items-center gap-2 font-bold tracking-tight">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Send className="size-4" aria-hidden />
              </span>
              Paperjet
            </Link>
            <nav aria-label="Tools" className="hidden items-center gap-1 md:flex">
              {TOOLS.slice(0, 4).map((tool) => (
                <Link
                  key={tool.id}
                  to={tool.path}
                  className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {tool.name}
                </Link>
              ))}
              <Link
                to="/"
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                All tools
              </Link>
            </nav>
          </div>
        </header>

        <main className="flex-1">
          <Routes />
        </main>

        <footer className="border-t py-8">
          <div className="mx-auto w-full max-w-5xl px-4 text-sm text-muted-foreground">
            <p>
              <strong className="text-foreground">Your files stay yours.</strong> Client-side
            tools never upload anything — processing happens in your browser. Server-side
              tools (Word to PDF) delete files within 1 hour, and no human ever sees them.
            </p>
            <p className="mt-2">
              Paperjet · Free for everyone · No ads · {new Date().getFullYear()}
            </p>
          </div>
        </footer>
      </div>
    </Router>
  );
}
