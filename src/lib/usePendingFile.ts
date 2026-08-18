import { useEffect, useRef } from "react";
import { takePendingFile } from "./chain";

/**
 * Tool pages call this to pick up a file chained from another tool's result
 * page. The callback fires at most once, on mount.
 */
export function usePendingFile(onFile: (file: File) => void) {
  const consumed = useRef(false);
  const cb = useRef(onFile);
  cb.current = onFile;

  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;
    const file = takePendingFile();
    if (file) cb.current(file);
  }, []);
}
