import { useState } from "react";
import { FileDown } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dropzone } from "@/components/Dropzone";
import { Processing } from "@/components/Processing";
import { ResultPanel, type ResultFile } from "@/components/ResultPanel";
import { ToolShell } from "@/components/ToolShell";
import { baseName } from "@/lib/files";
import { markdownToPdf } from "@/lib/pdf/markdown";
import { toolById } from "@/lib/tools";

const tool = toolById("markdown-to-pdf")!;

const PLACEHOLDER = `# My document

Write or paste **Markdown** here — headings, lists, \`code\`, tables,
blockquotes and links are all supported.

- Fast
- Private: converted right here in your browser
`;

export function MarkdownToPdfPage() {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultFile | null>(null);

  const acceptFile = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setText(await f.text());
    setFileName(f.name);
    setResult(null);
    setError(null);
  };

  const convert = async () => {
    setBusy(true);
    setError(null);
    try {
      const bytes = await markdownToPdf(text);
      setResult({
        blob: new Blob([bytes.slice().buffer], { type: "application/pdf" }),
        name: `${fileName ? baseName(fileName) : "document"}.pdf`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setText("");
    setFileName(null);
    setResult(null);
    setError(null);
  };

  return (
    <ToolShell tool={tool}>
      {result ? (
        <ResultPanel results={[result]} currentToolId={tool.id} onStartOver={reset} />
      ) : busy ? (
        <Processing label="Rendering Markdown…" done={0} total={0} />
      ) : (
        <div className="space-y-4">
          <Dropzone
            accept={tool.accept}
            onFiles={acceptFile}
            compact
            title={fileName ? `Loaded ${fileName} — drop another to replace` : "Drop a .md file here"}
          />
          <div className="space-y-2">
            <Label htmlFor="md-input">…or write Markdown directly</Label>
            <textarea
              id="md-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={PLACEHOLDER}
              spellCheck={false}
              className="h-72 w-full resize-y rounded-md border border-input bg-card p-3 font-mono text-sm shadow-sm placeholder:text-muted-foreground"
            />
          </div>
          <Button size="lg" onClick={convert} disabled={!text.trim()}>
            <FileDown aria-hidden /> Convert to PDF
          </Button>
          <p className="text-xs text-muted-foreground">
            Headings, bold/italic, lists, code blocks, tables, blockquotes and links are
            supported. Emoji and non-Latin scripts aren’t available in the built-in PDF fonts
            yet and will be omitted.
          </p>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
        </div>
      )}
    </ToolShell>
  );
}
