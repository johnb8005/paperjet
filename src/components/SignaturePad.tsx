import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Mode = "draw" | "type" | "upload";

const FONTS = [
  { id: "script", label: "Script", css: '"Brush Script MT", "Segoe Script", cursive' },
  { id: "elegant", label: "Elegant", css: '"Snell Roundhand", "Apple Chancery", cursive' },
  { id: "plain", label: "Plain", css: 'Georgia, "Times New Roman", serif' },
];

interface SignaturePadProps {
  onDone: (pngDataUrl: string) => void;
  className?: string;
}

/**
 * Create a signature by drawing, typing, or uploading an image.
 * Produces a transparent PNG data URL. Nothing here touches the network —
 * signatures only ever live in the browser.
 */
export function SignaturePad({ onDone, className }: SignaturePadProps) {
  const [mode, setMode] = useState<Mode>("draw");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [text, setText] = useState("");
  const [font, setFont] = useState(FONTS[0]!);
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || mode !== "draw") return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = 180 * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1a2340";
    }
  }, [mode]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  };

  const finishDraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onDone(canvas.toDataURL("image/png"));
  };

  const finishType = () => {
    if (!text.trim()) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const fontSize = 64;
    ctx.font = `${fontSize}px ${font.css}`;
    const metrics = ctx.measureText(text);
    canvas.width = Math.ceil(metrics.width + 40);
    canvas.height = fontSize * 2;
    const ctx2 = canvas.getContext("2d");
    if (!ctx2) return;
    ctx2.font = `${fontSize}px ${font.css}`;
    ctx2.fillStyle = "#1a2340";
    ctx2.textBaseline = "middle";
    ctx2.fillText(text, 20, canvas.height / 2);
    onDone(canvas.toDataURL("image/png"));
  };

  const finishUpload = () => {
    if (!uploadUrl) return;
    const img = new Image();
    img.onload = () => {
      const maxW = 800;
      const scale = Math.min(1, maxW / img.naturalWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      onDone(canvas.toDataURL("image/png"));
    };
    img.src = uploadUrl;
  };

  return (
    <div className={cn("rounded-xl border bg-card p-4", className)}>
      <div className="mb-4 flex gap-2" role="tablist" aria-label="Signature style">
        {(
          [
            ["draw", "Draw"],
            ["type", "Type"],
            ["upload", "Upload"],
          ] as const
        ).map(([m, label]) => (
          <Button
            key={m}
            role="tab"
            aria-selected={mode === m}
            variant={mode === m ? "default" : "outline"}
            size="sm"
            onClick={() => setMode(m)}
          >
            {label}
          </Button>
        ))}
      </div>

      {mode === "draw" ? (
        <div className="space-y-3">
          <canvas
            ref={canvasRef}
            className="h-[180px] w-full touch-none rounded-lg border bg-white"
            aria-label="Signature drawing area"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drawing.current = true;
              const ctx = e.currentTarget.getContext("2d");
              const { x, y } = pos(e);
              ctx?.beginPath();
              ctx?.moveTo(x, y);
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const ctx = e.currentTarget.getContext("2d");
              const { x, y } = pos(e);
              ctx?.lineTo(x, y);
              ctx?.stroke();
              setHasInk(true);
            }}
            onPointerUp={() => (drawing.current = false)}
          />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={clearCanvas}>
              <Eraser aria-hidden /> Clear
            </Button>
            <Button size="sm" disabled={!hasInk} onClick={finishDraw}>
              Use this signature
            </Button>
          </div>
        </div>
      ) : mode === "type" ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="sig-text">Your name</Label>
            <Input
              id="sig-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Jane Doe"
            />
          </div>
          <div className="flex gap-2" role="radiogroup" aria-label="Signature font">
            {FONTS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={font.id === f.id}
                onClick={() => setFont(f)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-xl",
                  font.id === f.id ? "border-primary ring-2 ring-primary" : "hover:bg-accent",
                )}
                style={{ fontFamily: f.css }}
              >
                {text.trim() || f.label}
              </button>
            ))}
          </div>
          <Button size="sm" disabled={!text.trim()} onClick={finishType}>
            Use this signature
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Label htmlFor="sig-upload">Upload a signature image (PNG with transparency works best)</Label>
          <Input
            id="sig-upload"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setUploadUrl(URL.createObjectURL(f));
            }}
          />
          {uploadUrl ? (
            <img
              src={uploadUrl}
              alt="Uploaded signature preview"
              className="max-h-28 rounded border bg-white p-2"
            />
          ) : null}
          <Button size="sm" disabled={!uploadUrl} onClick={finishUpload}>
            Use this signature
          </Button>
        </div>
      )}
    </div>
  );
}
