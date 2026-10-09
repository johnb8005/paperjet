// Font files for the Word → PDF renderer. The TrueType fonts in fonts/ are
// lazy-loaded per face: in the browser they're fetched from the static host
// (build.ts copies them to dist/fonts, src/server.ts serves them in dev); in
// Bun (MCP servers, tests) they're read straight from the repo.
import { withBase } from "../base";

const cache = new Map<string, Promise<Uint8Array | undefined>>();

/** Load a font file by name (e.g. "LiberationSans-Regular.ttf"); undefined if unavailable. */
export function loadFontFile(name: string): Promise<Uint8Array | undefined> {
  let pending = cache.get(name);
  if (!pending) {
    pending = load(name).catch(() => undefined);
    cache.set(name, pending);
  }
  return pending;
}

async function load(name: string): Promise<Uint8Array | undefined> {
  if (typeof Bun !== "undefined" && typeof document === "undefined") {
    const file = Bun.file(new URL(`../../../fonts/${name}`, import.meta.url));
    if (!(await file.exists())) return undefined;
    return new Uint8Array(await file.arrayBuffer());
  }
  const res = await fetch(withBase(`/fonts/${name}`));
  if (!res.ok) return undefined;
  return new Uint8Array(await res.arrayBuffer());
}
