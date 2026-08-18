import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface ProcessingProps {
  label: string;
  done: number;
  total: number;
}

/** Progress feedback for any operation that can take more than ~2 seconds. */
export function Processing({ label, done, total }: ProcessingProps) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
          {label}
        </div>
        <Progress value={pct} label={label} />
        <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
          {total > 0 ? `${done} of ${total}` : "Working…"}
        </p>
      </CardContent>
    </Card>
  );
}
