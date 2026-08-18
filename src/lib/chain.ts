// In-memory hand-off so the output of one tool can be opened in another
// ("chaining"), without the file ever leaving the page session.

let pendingFile: File | null = null;

export function setPendingFile(file: File) {
  pendingFile = file;
}

export function takePendingFile(): File | null {
  const f = pendingFile;
  pendingFile = null;
  return f;
}
