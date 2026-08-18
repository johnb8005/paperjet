// Base path support for subpath hosting (e.g. GitHub Pages serves the app at
// /<repo>/). __BASE_PATH__ is injected by build.ts via `define`; in dev (and
// root-path builds) it is undefined and the base is "".
declare const __BASE_PATH__: string | undefined;

export const BASE = typeof __BASE_PATH__ !== "undefined" ? __BASE_PATH__ : "";

/** Prefix an absolute app path ("/merge", "/pdf.worker.min.mjs") with the base. */
export function withBase(path: string): string {
  return BASE + path;
}

/** Strip the base from a location pathname, yielding the app-internal path. */
export function stripBase(pathname: string): string {
  if (BASE && pathname.startsWith(BASE)) {
    const rest = pathname.slice(BASE.length);
    return rest === "" || rest === "/" ? "/" : rest;
  }
  return pathname;
}
