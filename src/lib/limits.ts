// Free-tier limits from the PRD: up to 20 files, 100 MB total per task.
export const MAX_FILES = 20;
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

import { formatBytes } from "./files";

/** Returns an error message if the selection breaks free-tier limits, else null. */
export function checkLimits(existing: File[], incoming: File[]): string | null {
  const all = [...existing, ...incoming];
  if (all.length > MAX_FILES) {
    return `Too many files — the limit is ${MAX_FILES} files per task.`;
  }
  const total = all.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    return `Files exceed the ${formatBytes(MAX_TOTAL_BYTES)} total limit (selected ${formatBytes(total)}).`;
  }
  return null;
}
