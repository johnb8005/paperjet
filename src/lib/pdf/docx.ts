// Word (.docx) → PDF, DOM-free: runs in the browser AND in Bun (MCP server).
// The document is unzipped with fflate, its WordprocessingML parsed with
// fast-xml-parser, and laid out with pdf-lib's standard fonts — no server, no
// LibreOffice, no network. Files never leave the device.
//
// Supported: paragraphs with alignment/indent/spacing, run formatting (bold,
// italic, underline, strike, size, color, highlight, super/subscript, caps),
// paragraph and character styles (with basedOn chains and docDefaults),
// numbered and bulleted lists (numbering.xml, multi-level), tables (grid
// widths, spans, borders, shading, nested tables), inline PNG/JPEG images,
// hyperlinks, tabs, line/page/section breaks, page size and margins.
// Simplified or skipped: headers/footers, footnotes, text boxes/shapes,
// floating images (rendered inline), non-Latin scripts (standard PDF fonts
// cover Latin-1 only; accented letters outside it fall back to their base).
import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  /** Only set on "#text" nodes. */
  text: string;
}

const xmlParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

/** fast-xml-parser leaves numeric character references alone; decode them. */
function decodeEntities(s: string): string {
  if (!s.includes("&#")) return s;
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)));
}

function toNodes(raw: unknown[]): XNode[] {
  const out: XNode[] = [];
  for (const item of raw) {
    const rec = item as Record<string, unknown>;
    const name = Object.keys(rec).find((k) => k !== ":@");
    if (!name) continue;
    if (name === "#text") {
      out.push({ name, attrs: {}, children: [], text: decodeEntities(String(rec[name] ?? "")) });
      continue;
    }
    if (name.startsWith("?")) continue; // <?xml ?> and processing instructions
    const attrs = (rec[":@"] as Record<string, string> | undefined) ?? {};
    const kids = Array.isArray(rec[name]) ? (rec[name] as unknown[]) : [];
    out.push({ name, attrs, children: toNodes(kids), text: "" });
  }
  return out;
}

function parseXml(xml: string): XNode | undefined {
  const nodes = toNodes(xmlParser.parse(xml) as unknown[]);
  return nodes.find((n) => n.name !== "#text");
}

function child(node: XNode | undefined, name: string): XNode | undefined {
  return node?.children.find((c) => c.name === name);
}

function children(node: XNode | undefined, name: string): XNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

function attr(node: XNode | undefined, name: string): string | undefined {
  return node?.attrs[name];
}

/** `<w:x w:val="…"/>` → value of w:val on the named child. */
function val(node: XNode | undefined, name: string): string | undefined {
  return attr(child(node, name), "w:val");
}

function num(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Element present and not explicitly switched off (`w:val="0"|"false"|"none"`). */
function flag(node: XNode | undefined, name: string): boolean | undefined {
  const el = child(node, name);
  if (!el) return undefined;
  const v = el.attrs["w:val"];
  return !(v === "0" || v === "false" || v === "none" || v === "off");
}

function* descendants(node: XNode): Generator<XNode> {
  for (const c of node.children) {
    yield c;
    yield* descendants(c);
  }
}

// ---------------------------------------------------------------------------
// Units & colors
// ---------------------------------------------------------------------------

const TWIP = 1 / 20; // twentieths of a point \u2192 points
const EMU = 1 / 12700; // English metric units \u2192 points

const INK = rgb(0, 0, 0);
const LINK = rgb(0.03, 0.33, 0.68);
const BORDER = rgb(0, 0, 0);
const PLACEHOLDER = rgb(0.5, 0.5, 0.5);

function hexColor(hex: string | undefined): RGB | undefined {
  if (!hex || hex === "auto" || !/^[0-9a-f]{6}$/i.test(hex)) return undefined;
  const n = parseInt(hex, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const HIGHLIGHTS: Record<string, string> = {
  yellow: "FFFF00",
  green: "00FF00",
  cyan: "00FFFF",
  magenta: "FF00FF",
  blue: "0000FF",
  red: "FF0000",
  darkBlue: "000080",
  darkCyan: "008080",
  darkGreen: "008000",
  darkMagenta: "800080",
  darkRed: "800000",
  darkYellow: "808000",
  darkGray: "808080",
  lightGray: "C0C0C0",
  black: "000000",
};

// ---------------------------------------------------------------------------
// Formatting model
// ---------------------------------------------------------------------------

type Family = "sans" | "serif" | "mono";

interface RunStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  size: number; // points
  color: RGB | undefined;
  highlight: RGB | undefined;
  family: Family;
  script: "normal" | "super" | "sub";
  caps: boolean;
  hidden: boolean;
  link: boolean;
}

interface ParaProps {
  styleId: string | undefined;
  align: "left" | "center" | "right" | "both";
  left: number;
  right: number;
  firstLine: number;
  hanging: number;
  before: number;
  after: number;
  /** Line spacing multiple (1 = single). */
  line: number;
  /** Fixed line height in points when lineRule is exact/atLeast. */
  lineExact: number | undefined;
  lineRule: "auto" | "exact" | "atLeast";
  numId: string | undefined;
  ilvl: number;
  pageBreakBefore: boolean;
  keepNext: boolean;
  contextualSpacing: boolean;
  borderBottom: { width: number; color: RGB } | undefined;
  borderTop: { width: number; color: RGB } | undefined;
  shading: RGB | undefined;
  tabs: number[]; // absolute tab stops in points from the left margin
}

function defaultRun(): RunStyle {
  return {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    size: 11,
    color: undefined,
    highlight: undefined,
    family: "sans",
    script: "normal",
    caps: false,
    hidden: false,
    link: false,
  };
}

function defaultPara(): ParaProps {
  return {
    styleId: undefined,
    align: "left",
    left: 0,
    right: 0,
    firstLine: 0,
    hanging: 0,
    before: 0,
    after: 0,
    line: 1,
    lineExact: undefined,
    lineRule: "auto",
    numId: undefined,
    ilvl: 0,
    pageBreakBefore: false,
    keepNext: false,
    contextualSpacing: false,
    borderBottom: undefined,
    borderTop: undefined,
    shading: undefined,
    tabs: [],
  };
}

function familyFor(name: string | undefined, fallback: Family): Family {
  if (!name) return fallback;
  if (/courier|consolas|mono|menlo|monaco|lucida console|fixed/i.test(name)) return "mono";
  if (/times|georgia|garamond|cambria|palatino|book antiqua|baskerville|century|bookman|minion|serif/i.test(name) && !/sans/i.test(name)) {
    return "serif";
  }
  return fallback === "mono" ? "sans" : "sans";
}

function applyRPr(s: RunStyle, rPr: XNode | undefined): void {
  if (!rPr) return;
  const b = flag(rPr, "w:b");
  if (b !== undefined) s.bold = b;
  const i = flag(rPr, "w:i");
  if (i !== undefined) s.italic = i;
  const u = child(rPr, "w:u");
  if (u) s.underline = !(u.attrs["w:val"] === "none" || u.attrs["w:val"] === "0");
  const strike = flag(rPr, "w:strike") ?? flag(rPr, "w:dstrike");
  if (strike !== undefined) s.strike = strike;
  const sz = num(val(rPr, "w:sz"));
  if (sz !== undefined && sz > 0) s.size = sz / 2;
  const color = child(rPr, "w:color");
  if (color) s.color = hexColor(color.attrs["w:val"]);
  const highlight = val(rPr, "w:highlight");
  if (highlight) s.highlight = highlight === "none" ? undefined : hexColor(HIGHLIGHTS[highlight]);
  const shd = child(rPr, "w:shd");
  if (shd && !s.highlight) s.highlight = hexColor(shd.attrs["w:fill"]);
  const fonts = child(rPr, "w:rFonts");
  if (fonts) {
    const name = fonts.attrs["w:ascii"] ?? fonts.attrs["w:hAnsi"] ?? fonts.attrs["w:cs"];
    if (name) s.family = familyFor(name, s.family);
    else if (fonts.attrs["w:asciiTheme"]) s.family = "sans";
  }
  const vert = val(rPr, "w:vertAlign");
  if (vert) s.script = vert === "superscript" ? "super" : vert === "subscript" ? "sub" : "normal";
  const caps = flag(rPr, "w:caps") ?? flag(rPr, "w:smallCaps");
  if (caps !== undefined) s.caps = caps;
  const vanish = flag(rPr, "w:vanish");
  if (vanish !== undefined) s.hidden = vanish;
}

function borderOf(node: XNode | undefined): { width: number; color: RGB } | undefined {
  if (!node) return undefined;
  const v = node.attrs["w:val"];
  if (!v || v === "nil" || v === "none") return undefined;
  const sz = num(node.attrs["w:sz"]) ?? 4; // eighths of a point
  return { width: Math.max(0.5, sz / 8), color: hexColor(node.attrs["w:color"]) ?? BORDER };
}

function applyPPr(p: ParaProps, pPr: XNode | undefined): void {
  if (!pPr) return;
  const jc = val(pPr, "w:jc");
  if (jc) {
    p.align =
      jc === "center" ? "center"
      : jc === "right" || jc === "end" ? "right"
      : jc === "both" || jc === "distribute" ? "both"
      : "left";
  }
  const ind = child(pPr, "w:ind");
  if (ind) {
    const left = num(ind.attrs["w:left"] ?? ind.attrs["w:start"]);
    if (left !== undefined) p.left = left * TWIP;
    const right = num(ind.attrs["w:right"] ?? ind.attrs["w:end"]);
    if (right !== undefined) p.right = right * TWIP;
    const first = num(ind.attrs["w:firstLine"]);
    const hanging = num(ind.attrs["w:hanging"]);
    if (hanging !== undefined) {
      p.hanging = hanging * TWIP;
      p.firstLine = 0;
    } else if (first !== undefined) {
      p.firstLine = first * TWIP;
      p.hanging = 0;
    }
  }
  const spacing = child(pPr, "w:spacing");
  if (spacing) {
    const before = num(spacing.attrs["w:before"]);
    if (before !== undefined) p.before = before * TWIP;
    const after = num(spacing.attrs["w:after"]);
    if (after !== undefined) p.after = after * TWIP;
    const line = num(spacing.attrs["w:line"]);
    const rule = spacing.attrs["w:lineRule"] ?? "auto";
    if (line !== undefined) {
      if (rule === "exact" || rule === "atLeast") {
        p.lineRule = rule;
        p.lineExact = line * TWIP;
      } else {
        p.lineRule = "auto";
        p.lineExact = undefined;
        p.line = line / 240;
      }
    }
  }
  const numPr = child(pPr, "w:numPr");
  if (numPr) {
    const id = val(numPr, "w:numId");
    if (id !== undefined) p.numId = id === "0" ? undefined : id;
    const ilvl = num(val(numPr, "w:ilvl"));
    if (ilvl !== undefined) p.ilvl = ilvl;
  }
  const pbb = flag(pPr, "w:pageBreakBefore");
  if (pbb !== undefined) p.pageBreakBefore = pbb;
  const keep = flag(pPr, "w:keepNext");
  if (keep !== undefined) p.keepNext = keep;
  const ctx = flag(pPr, "w:contextualSpacing");
  if (ctx !== undefined) p.contextualSpacing = ctx;
  const bdr = child(pPr, "w:pBdr");
  if (bdr) {
    p.borderBottom = borderOf(child(bdr, "w:bottom"));
    p.borderTop = borderOf(child(bdr, "w:top"));
  }
  const shd = child(pPr, "w:shd");
  if (shd) p.shading = hexColor(shd.attrs["w:fill"]);
  const tabs = child(pPr, "w:tabs");
  if (tabs) {
    for (const t of children(tabs, "w:tab")) {
      const pos = num(t.attrs["w:pos"]);
      if (pos === undefined) continue;
      if (t.attrs["w:val"] === "clear") p.tabs = p.tabs.filter((x) => Math.abs(x - pos * TWIP) > 0.5);
      else p.tabs.push(pos * TWIP);
    }
    p.tabs.sort((a, b) => a - b);
  }
}

// ---------------------------------------------------------------------------
// styles.xml
// ---------------------------------------------------------------------------

interface StyleDef {
  id: string;
  type: string;
  basedOn: string | undefined;
  pPr: XNode | undefined;
  rPr: XNode | undefined;
  tblPr: XNode | undefined;
}

class Styles {
  private byId = new Map<string, StyleDef>();
  private defaults = new Map<string, string>(); // type \u2192 styleId
  docPPr: XNode | undefined;
  docRPr: XNode | undefined;

  constructor(root: XNode | undefined) {
    if (!root) return;
    const dd = child(root, "w:docDefaults");
    this.docPPr = child(child(dd, "w:pPrDefault"), "w:pPr");
    this.docRPr = child(child(dd, "w:rPrDefault"), "w:rPr");
    for (const s of children(root, "w:style")) {
      const id = s.attrs["w:styleId"];
      if (!id) continue;
      const type = s.attrs["w:type"] ?? "paragraph";
      this.byId.set(id, {
        id,
        type,
        basedOn: val(s, "w:basedOn"),
        pPr: child(s, "w:pPr"),
        rPr: child(s, "w:rPr"),
        tblPr: child(s, "w:tblPr"),
      });
      if (s.attrs["w:default"] === "1" || s.attrs["w:default"] === "true") this.defaults.set(type, id);
    }
  }

  /** Style chain root-first (basedOn ancestors before the style itself). */
  chain(id: string | undefined): StyleDef[] {
    const out: StyleDef[] = [];
    const seen = new Set<string>();
    let cur = id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const def = this.byId.get(cur);
      if (!def) break;
      out.unshift(def);
      cur = def.basedOn;
    }
    return out;
  }

  defaultFor(type: string): string | undefined {
    return this.defaults.get(type);
  }

  /** Base paragraph properties: docDefaults + default paragraph style + the given style. */
  paraProps(styleId: string | undefined): ParaProps {
    const p = defaultPara();
    applyPPr(p, this.docPPr);
    const chain = this.chain(styleId ?? this.defaultFor("paragraph"));
    if (styleId && !chain.some((s) => s.id === this.defaultFor("paragraph"))) {
      for (const s of this.chain(this.defaultFor("paragraph"))) applyPPr(p, s.pPr);
    }
    for (const s of chain) applyPPr(p, s.pPr);
    p.styleId = styleId;
    return p;
  }

  /** Base run style for a paragraph style (docDefaults + style chain rPr). */
  runStyle(paraStyleId: string | undefined): RunStyle {
    const s = defaultRun();
    applyRPr(s, this.docRPr);
    const chain = this.chain(paraStyleId ?? this.defaultFor("paragraph"));
    if (paraStyleId && !chain.some((x) => x.id === this.defaultFor("paragraph"))) {
      for (const x of this.chain(this.defaultFor("paragraph"))) applyRPr(s, x.rPr);
    }
    for (const x of chain) applyRPr(s, x.rPr);
    return s;
  }

  applyCharStyle(s: RunStyle, styleId: string | undefined): void {
    for (const x of this.chain(styleId)) applyRPr(s, x.rPr);
  }

  tableBorders(styleId: string | undefined): XNode | undefined {
    let found: XNode | undefined;
    for (const s of this.chain(styleId)) {
      const b = child(s.tblPr, "w:tblBorders");
      if (b) found = b;
    }
    return found;
  }
}

// ---------------------------------------------------------------------------
// numbering.xml
// ---------------------------------------------------------------------------

interface Level {
  fmt: string;
  text: string;
  start: number;
  pPr: XNode | undefined;
  rPr: XNode | undefined;
}

class Numbering {
  private abstracts = new Map<string, Map<number, Level>>();
  private nums = new Map<string, { abstractId: string; overrides: Map<number, { start: number | undefined; level: Level | undefined }> }>();
  private counters = new Map<string, number[]>();
  private started = new Set<string>();

  constructor(root: XNode | undefined) {
    if (!root) return;
    for (const abs of children(root, "w:abstractNum")) {
      const id = abs.attrs["w:abstractNumId"];
      if (id === undefined) continue;
      const levels = new Map<number, Level>();
      for (const lvl of children(abs, "w:lvl")) {
        const ilvl = num(lvl.attrs["w:ilvl"]);
        if (ilvl === undefined) continue;
        levels.set(ilvl, Numbering.level(lvl));
      }
      this.abstracts.set(id, levels);
    }
    for (const n of children(root, "w:num")) {
      const id = n.attrs["w:numId"];
      const abstractId = val(n, "w:abstractNumId");
      if (id === undefined || abstractId === undefined) continue;
      const overrides = new Map<number, { start: number | undefined; level: Level | undefined }>();
      for (const o of children(n, "w:lvlOverride")) {
        const ilvl = num(o.attrs["w:ilvl"]);
        if (ilvl === undefined) continue;
        const lvl = child(o, "w:lvl");
        overrides.set(ilvl, { start: num(val(o, "w:startOverride")), level: lvl ? Numbering.level(lvl) : undefined });
      }
      this.nums.set(id, { abstractId, overrides });
    }
  }

  private static level(lvl: XNode): Level {
    return {
      fmt: val(lvl, "w:numFmt") ?? "decimal",
      text: val(lvl, "w:lvlText") ?? "",
      start: num(val(lvl, "w:start")) ?? 1,
      pPr: child(lvl, "w:pPr"),
      rPr: child(lvl, "w:rPr"),
    };
  }

  level(numId: string, ilvl: number): Level | undefined {
    const n = this.nums.get(numId);
    if (!n) return undefined;
    return n.overrides.get(ilvl)?.level ?? this.abstracts.get(n.abstractId)?.get(ilvl);
  }

  /** Advance the counter for (numId, ilvl) and return the rendered label. */
  label(numId: string, ilvl: number): string | undefined {
    const n = this.nums.get(numId);
    const level = this.level(numId, ilvl);
    if (!n || !level) return undefined;
    // Lists sharing an abstract definition continue numbering (that's how
    // Word behaves); a num with startOverride restarts a level the first
    // time that num is used at that level.
    let counters = this.counters.get(n.abstractId);
    if (!counters) {
      counters = [];
      this.counters.set(n.abstractId, counters);
    }
    const key = `${numId}:${ilvl}`;
    if (!this.started.has(key)) {
      this.started.add(key);
      const start = n.overrides.get(ilvl)?.start;
      if (start !== undefined) counters[ilvl] = start - 1;
    }
    for (let i = 0; i <= ilvl; i++) {
      if (counters[i] === undefined) counters[i] = (this.level(numId, i)?.start ?? 1) - 1;
    }
    counters[ilvl] = (counters[ilvl] ?? 0) + 1;
    counters.length = ilvl + 1; // deeper levels restart
    if (level.fmt === "none") return "";
    if (level.fmt === "bullet") return bulletChar(level.text, ilvl);
    return level.text.replace(/%(\d)/g, (_, d: string) => {
      const lvl = parseInt(d, 10) - 1;
      const value = counters[lvl] ?? this.level(numId, lvl)?.start ?? 1;
      return formatNumber(value, this.level(numId, lvl)?.fmt ?? "decimal");
    });
  }
}

function bulletChar(text: string, ilvl: number): string {
  const code = text.codePointAt(0);
  // Symbol/Wingdings bullets live in the private-use area; map them to
  // glyphs the standard fonts have.
  if (!text || code === undefined || (code >= 0xe000 && code <= 0xf8ff) || code > 0xff) {
    return ["\u2022", "\u2013", "\u00b7"][ilvl % 3]!;
  }
  return text;
}

function toRoman(n: number): string {
  const table: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [v, s] of table) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

function toLetters(n: number): string {
  let out = "";
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case "lowerLetter":
      return toLetters(n);
    case "upperLetter":
      return toLetters(n).toUpperCase();
    case "lowerRoman":
      return toRoman(n).toLowerCase();
    case "upperRoman":
      return toRoman(n);
    case "decimalZero":
      return n < 10 ? `0${n}` : String(n);
    default:
      return String(n);
  }
}

// ---------------------------------------------------------------------------
// Document model
// ---------------------------------------------------------------------------

interface ImageRef {
  data: Uint8Array;
  kind: "png" | "jpg";
}

type Inline =
  | { kind: "text"; text: string; style: RunStyle }
  | { kind: "image"; image: ImageRef; width: number; height: number }
  | { kind: "placeholder"; style: RunStyle }
  | { kind: "tab" }
  | { kind: "break" }
  | { kind: "pageBreak" };

interface Para {
  kind: "para";
  props: ParaProps;
  /** Style of the paragraph mark: used for empty lines and list labels. */
  mark: RunStyle;
  label: string | undefined;
  inlines: Inline[];
}

interface Cell {
  blocks: Block[];
  span: number;
  vMerge: "restart" | "continue" | undefined;
  shading: RGB | undefined;
}

interface Row {
  cells: Cell[];
  minHeight: number;
}

interface Table {
  kind: "table";
  rows: Row[];
  colWidths: number[];
  borders: boolean;
  indent: number;
}

type Block = Para | Table | { kind: "pageBreak" };

interface Section {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface Parsed {
  blocks: Block[];
  section: Section;
}

class DocxReader {
  private styles: Styles;
  private numbering: Numbering;
  private rels = new Map<string, string>();
  private files: Record<string, Uint8Array>;

  constructor(files: Record<string, Uint8Array>) {
    this.files = files;
    this.styles = new Styles(this.xml("word/styles.xml"));
    this.numbering = new Numbering(this.xml("word/numbering.xml"));
    const rels = this.xml("word/_rels/document.xml.rels");
    for (const r of children(rels, "Relationship")) {
      if (r.attrs.Id && r.attrs.Target) this.rels.set(r.attrs.Id, r.attrs.Target);
    }
  }

  private xml(path: string): XNode | undefined {
    const bytes = this.files[path];
    if (!bytes) return undefined;
    try {
      return parseXml(strFromU8(bytes));
    } catch {
      return undefined;
    }
  }

  parse(): Parsed {
    const document = this.xml("word/document.xml");
    const body = child(document, "w:body");
    if (!document || !body) throw new Error("This file doesn't look like a Word document.");
    const blocks = this.blocks(body);
    return { blocks, section: this.section(child(body, "w:sectPr")) };
  }

  private section(sectPr: XNode | undefined): Section {
    const pgSz = child(sectPr, "w:pgSz");
    const pgMar = child(sectPr, "w:pgMar");
    let width = (num(pgSz?.attrs["w:w"]) ?? 12240) * TWIP;
    let height = (num(pgSz?.attrs["w:h"]) ?? 15840) * TWIP;
    if (pgSz?.attrs["w:orient"] === "landscape" && height > width) [width, height] = [height, width];
    const margin = (name: string, fallback: number) => {
      const v = num(pgMar?.attrs[name]);
      return v === undefined ? fallback : Math.max(0, v * TWIP);
    };
    return {
      width,
      height,
      top: margin("w:top", 72),
      right: margin("w:right", 72),
      bottom: margin("w:bottom", 72),
      left: margin("w:left", 72),
    };
  }

  private blocks(container: XNode): Block[] {
    const out: Block[] = [];
    for (const node of container.children) {
      switch (node.name) {
        case "w:p":
          out.push(this.paragraph(node));
          if (child(child(node, "w:pPr"), "w:sectPr")) {
            const type = val(child(child(node, "w:pPr"), "w:sectPr"), "w:type");
            if (type !== "continuous") out.push({ kind: "pageBreak" });
          }
          break;
        case "w:tbl":
          out.push(this.table(node));
          break;
        case "w:sdt":
          out.push(...this.blocks(child(node, "w:sdtContent") ?? node));
          break;
        case "w:ins":
        case "w:smartTag":
        case "w:customXml":
          out.push(...this.blocks(node));
          break;
        default:
          break;
      }
    }
    return out;
  }

  private paragraph(p: XNode): Para {
    const pPr = child(p, "w:pPr");
    const styleId = val(pPr, "w:pStyle");
    const props = this.styles.paraProps(styleId);
    // Numbering-level indents sit between the style and direct formatting.
    const numId = val(child(pPr, "w:numPr"), "w:numId") ?? props.numId;
    const ilvl = num(val(child(pPr, "w:numPr"), "w:ilvl")) ?? props.ilvl;
    const level = numId && numId !== "0" ? this.numbering.level(numId, ilvl) : undefined;
    applyPPr(props, level?.pPr);
    applyPPr(props, pPr);

    const base = this.styles.runStyle(styleId);
    const mark = { ...base };
    applyRPr(mark, child(pPr, "w:rPr"));

    let label: string | undefined;
    if (props.numId && level) {
      label = this.numbering.label(props.numId, props.ilvl);
      applyRPr(mark, level.rPr);
    }

    const inlines: Inline[] = [];
    this.collect(p, base, inlines, { field: [] });
    return { kind: "para", props, mark, label, inlines };
  }

  private collect(node: XNode, base: RunStyle, out: Inline[], state: { field: ("instr" | "result")[] }): void {
    for (const c of node.children) {
      switch (c.name) {
        case "w:r":
          this.run(c, base, out, state);
          break;
        case "w:hyperlink": {
          const linked = { ...base, link: true };
          this.collect(c, linked, out, state);
          break;
        }
        case "w:ins":
        case "w:smartTag":
        case "w:customXml":
        case "w:fldSimple":
        case "w:dir":
        case "w:bdo":
          this.collect(c, base, out, state);
          break;
        case "w:sdt":
          this.collect(child(c, "w:sdtContent") ?? c, base, out, state);
          break;
        default:
          break;
      }
    }
  }

  private run(r: XNode, base: RunStyle, out: Inline[], state: { field: ("instr" | "result")[] }): void {
    const style = { ...base };
    const rPr = child(r, "w:rPr");
    this.styles.applyCharStyle(style, val(rPr, "w:rStyle"));
    applyRPr(style, rPr);
    if (style.hidden) return;
    for (const c of r.children) {
      switch (c.name) {
        case "w:fldChar": {
          const type = c.attrs["w:fldCharType"];
          if (type === "begin") state.field.push("instr");
          else if (type === "separate" && state.field.length) state.field[state.field.length - 1] = "result";
          else if (type === "end") state.field.pop();
          break;
        }
        case "w:t":
        case "w:delText": {
          if (c.name === "w:delText") break;
          if (state.field[state.field.length - 1] === "instr") break;
          const text = c.children.map((t) => t.text).join("");
          if (text) out.push({ kind: "text", text, style });
          break;
        }
        case "w:tab":
        case "w:ptab":
          out.push({ kind: "tab" });
          break;
        case "w:br":
          out.push(c.attrs["w:type"] === "page" ? { kind: "pageBreak" } : { kind: "break" });
          break;
        case "w:cr":
          out.push({ kind: "break" });
          break;
        case "w:noBreakHyphen":
          out.push({ kind: "text", text: "-", style });
          break;
        case "w:sym":
          out.push({ kind: "text", text: "\u2022", style });
          break;
        case "w:drawing":
          this.drawing(c, style, out);
          break;
        case "w:pict":
        case "w:object":
          this.vml(c, style, out);
          break;
        case "mc:AlternateContent": {
          // Text boxes and shapes: salvage their text rather than drop it.
          const choice = child(c, "mc:Choice");
          const box = choice ? [...descendants(choice)].find((d) => d.name === "w:txbxContent") : undefined;
          if (box) {
            for (const p of children(box, "w:p")) {
              const para = this.paragraph(p);
              if (out.length) out.push({ kind: "break" });
              out.push(...para.inlines);
            }
          } else if (choice) {
            // A plain inline picture wrapped in AlternateContent.
            const drawing = [...descendants(choice)].find((d) => d.name === "w:drawing");
            if (drawing) this.drawing(drawing, style, out);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  private image(relId: string | undefined): ImageRef | undefined {
    if (!relId) return undefined;
    const target = this.rels.get(relId);
    if (!target) return undefined;
    const path = target.startsWith("/") ? target.slice(1) : `word/${target.replace(/^(\.\.\/)+/, "")}`;
    const data = this.files[path];
    if (!data || data.length < 4) return undefined;
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return { data, kind: "png" };
    if (data[0] === 0xff && data[1] === 0xd8) return { data, kind: "jpg" };
    return undefined;
  }

  private drawing(node: XNode, style: RunStyle, out: Inline[]): void {
    const all = [...descendants(node)];
    const extent = all.find((d) => d.name === "wp:extent");
    const blip = all.find((d) => d.name === "a:blip");
    const image = this.image(blip?.attrs["r:embed"] ?? blip?.attrs["r:link"]);
    const width = (num(extent?.attrs.cx) ?? 0) * EMU;
    const height = (num(extent?.attrs.cy) ?? 0) * EMU;
    if (image && width > 0 && height > 0) out.push({ kind: "image", image, width, height });
    else if (blip || all.some((d) => d.name === "pic:pic" || d.name === "wps:wsp")) out.push({ kind: "placeholder", style });
  }

  private vml(node: XNode, style: RunStyle, out: Inline[]): void {
    const all = [...descendants(node)];
    const data = all.find((d) => d.name === "v:imagedata");
    const shape = all.find((d) => d.name === "v:shape");
    const image = this.image(data?.attrs["r:id"] ?? data?.attrs["o:relid"]);
    const css = shape?.attrs.style ?? "";
    const dim = (name: string) => {
      const m = new RegExp(`${name}:\\s*([\\d.]+)(pt|px|in|cm|mm)?`).exec(css);
      if (!m) return 0;
      const v = parseFloat(m[1]!);
      switch (m[2]) {
        case "px": return v * 0.75;
        case "in": return v * 72;
        case "cm": return v * 28.35;
        case "mm": return v * 2.835;
        default: return v;
      }
    };
    const width = dim("width");
    const height = dim("height");
    if (image && width > 0 && height > 0) out.push({ kind: "image", image, width, height });
    else if (data) out.push({ kind: "placeholder", style });
  }

  private table(tbl: XNode): Table {
    const tblPr = child(tbl, "w:tblPr");
    const styleId = val(tblPr, "w:tblStyle");
    const borders = child(tblPr, "w:tblBorders") ?? this.styles.tableBorders(styleId);
    const hasBorders = borders
      ? borders.children.some((b) => b.attrs["w:val"] && b.attrs["w:val"] !== "nil" && b.attrs["w:val"] !== "none")
      : false;
    const indent = (num(attr(child(tblPr, "w:tblInd"), "w:w")) ?? 0) * TWIP;

    const colWidths = children(child(tbl, "w:tblGrid"), "w:gridCol")
      .map((g) => (num(g.attrs["w:w"]) ?? 0) * TWIP);

    const rows: Row[] = [];
    for (const tr of tbl.children) {
      if (tr.name !== "w:tr") continue;
      const trPr = child(tr, "w:trPr");
      const cells: Cell[] = [];
      for (const tc of tr.children) {
        if (tc.name !== "w:tc") continue;
        const tcPr = child(tc, "w:tcPr");
        const vMergeEl = child(tcPr, "w:vMerge");
        cells.push({
          blocks: this.blocks(tc),
          span: Math.max(1, num(val(tcPr, "w:gridSpan")) ?? 1),
          vMerge: vMergeEl ? (vMergeEl.attrs["w:val"] === "restart" ? "restart" : "continue") : undefined,
          shading: hexColor(attr(child(tcPr, "w:shd"), "w:fill")),
        });
      }
      const minHeight = (num(attr(child(trPr, "w:trHeight"), "w:val")) ?? 0) * TWIP;
      rows.push({ cells, minHeight });
    }

    // No usable grid: fall back to cell widths of the widest row, else equal columns.
    const cols = Math.max(colWidths.length, ...rows.map((r) => r.cells.reduce((n, c) => n + c.span, 0)));
    if (colWidths.length < cols || colWidths.some((w) => w <= 0)) {
      const widths: number[] = [];
      for (const tr of children(tbl, "w:tr")) {
        let i = 0;
        for (const tc of children(tr, "w:tc")) {
          const tcPr = child(tc, "w:tcPr");
          const tcW = child(tcPr, "w:tcW");
          const span = Math.max(1, num(val(tcPr, "w:gridSpan")) ?? 1);
          const w = tcW?.attrs["w:type"] === "dxa" ? (num(tcW.attrs["w:w"]) ?? 0) * TWIP : 0;
          for (let k = 0; k < span; k++) widths[i + k] = Math.max(widths[i + k] ?? 0, w / span);
          i += span;
        }
      }
      for (let i = 0; i < cols; i++) {
        if (!(widths[i]! > 0)) widths[i] = 0;
        colWidths[i] = widths[i]!;
      }
      if (colWidths.every((w) => w <= 0)) colWidths.fill(-1); // resolved at layout time
    }
    return { kind: "table", rows, colWidths, borders: hasBorders, indent };
  }
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const LINE_FACTOR = 1.2; // single spacing relative to font size

/** Characters outside the standard fonts' encoding with an obvious stand-in. */
const FALLBACK_CHARS: Record<string, string> = {
  "\u00a0": " ", "\u2002": " ", "\u2003": " ", "\u2004": " ", "\u2005": " ", "\u2006": " ",
  "\u2007": " ", "\u2008": " ", "\u2009": " ", "\u200a": " ", "\u202f": " ", "\u3000": " ",
  "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2015": "\u2014", "\u2212": "-",
  "\u2032": "'", "\u2033": '"', "\u2035": "'", "\u201a": "'", "\u201e": '"',
  "\u2190": "<-", "\u2192": "->", "\u2194": "<->", "\u21d2": "=>", "\u2264": "<=", "\u2265": ">=", "\u2260": "!=",
  "\u2713": "v", "\u2714": "v", "\u2717": "x", "\u2718": "x", "\u25cf": "\u2022", "\u25aa": "\u2022", "\u25a0": "\u2022",
  "\u25e6": "\u00b7", "\u2219": "\u00b7", "\u2027": "\u00b7", "\u2023": "\u2022", "\u2043": "-",
  "\u0141": "L", "\u0142": "l", "\u0110": "D", "\u0111": "d", "\u0126": "H", "\u0127": "h", "\u0131": "i",
  "\u0166": "T", "\u0167": "t", "\u0138": "k", "\u013f": "L", "\u0140": "l", "\u0149": "'n", "\u014a": "N", "\u014b": "n",
  "\u0152": "OE", "\u0153": "oe", "\u0170": "U", "\u0171": "u", "\u0150": "O", "\u0151": "o",
  "\u2122": "TM", "\u2026": "...", "\u20ac": "EUR",
};
const DESCENT = 0.25; // part of the line box below the baseline
const DEFAULT_TAB = 36; // Word's default tab stop: half an inch
const CELL_PAD_X = 5.4;
const CELL_PAD_Y = 1.5;

interface Piece {
  kind: "text";
  text: string;
  style: RunStyle;
  font: PDFFont;
  size: number; // drawn size (super/subscript shrink)
  rise: number; // baseline offset
  width: number;
}

interface ImagePiece {
  kind: "image";
  image: PDFImage;
  width: number;
  height: number;
}

interface Gap {
  kind: "space" | "tab";
  width: number;
  style: RunStyle | undefined;
}

type LineItem = Piece | ImagePiece | Gap;

interface Line {
  items: LineItem[];
  width: number;
  height: number;
  baseline: number; // distance from line top to baseline
  pageBreakAfter: boolean;
  last: boolean;
}

type Unit =
  | { kind: "word"; pieces: (Piece | ImagePiece)[]; width: number }
  | { kind: "space"; style: RunStyle }
  | { kind: "tab" }
  | { kind: "break" }
  | { kind: "pageBreak" };

class Renderer {
  private doc!: PDFDocument;
  private page!: PDFPage;
  private y = 0;
  private section!: Section;
  private fonts = new Map<string, PDFFont>();
  private encodable = new Map<PDFFont, Map<string, boolean>>();
  private glyphWidths = new Map<PDFFont, Map<string, number>>();
  private images = new Map<Uint8Array, Promise<PDFImage | undefined>>();
  private prevPara: Para | undefined;

  async render(parsed: Parsed): Promise<Uint8Array> {
    this.doc = await PDFDocument.create();
    this.section = parsed.section;
    await this.preloadFonts(parsed.blocks);
    this.newPage();
    await this.flow(parsed.blocks);
    return this.doc.save();
  }

  // -- fonts -----------------------------------------------------------------

  private async preloadFonts(blocks: Block[]): Promise<void> {
    const keys = new Set<string>();
    const visit = (bs: Block[]) => {
      for (const b of bs) {
        if (b.kind === "para") {
          keys.add(this.fontKey(b.mark));
          for (const i of b.inlines) if (i.kind === "text" || i.kind === "placeholder") keys.add(this.fontKey(i.style));
        } else if (b.kind === "table") {
          for (const r of b.rows) for (const c of r.cells) visit(c.blocks);
        }
      }
    };
    visit(blocks);
    keys.add("sans::");
    for (const key of keys) await this.loadFont(key);
  }

  private fontKey(s: RunStyle): string {
    return `${s.family}:${s.bold ? "b" : ""}:${s.italic ? "i" : ""}`;
  }

  private async loadFont(key: string): Promise<PDFFont> {
    const cached = this.fonts.get(key);
    if (cached) return cached;
    const [family, b, i] = key.split(":") as [Family, string, string];
    const bold = b === "b";
    const italic = i === "i";
    let name: StandardFonts;
    if (family === "serif") {
      name = bold && italic ? StandardFonts.TimesRomanBoldItalic
        : bold ? StandardFonts.TimesRomanBold
        : italic ? StandardFonts.TimesRomanItalic
        : StandardFonts.TimesRoman;
    } else if (family === "mono") {
      name = bold && italic ? StandardFonts.CourierBoldOblique
        : bold ? StandardFonts.CourierBold
        : italic ? StandardFonts.CourierOblique
        : StandardFonts.Courier;
    } else {
      name = bold && italic ? StandardFonts.HelveticaBoldOblique
        : bold ? StandardFonts.HelveticaBold
        : italic ? StandardFonts.HelveticaOblique
        : StandardFonts.Helvetica;
    }
    const font = await this.doc.embedFont(name);
    this.fonts.set(key, font);
    return font;
  }

  private font(s: RunStyle): PDFFont {
    return this.fonts.get(this.fontKey(s)) ?? this.fonts.get("sans::")!;
  }

  private canEncode(font: PDFFont, ch: string): boolean {
    let cache = this.encodable.get(font);
    if (!cache) {
      cache = new Map();
      this.encodable.set(font, cache);
    }
    let ok = cache.get(ch);
    if (ok === undefined) {
      try {
        font.encodeText(ch);
        ok = true;
      } catch {
        ok = false;
      }
      cache.set(ch, ok);
    }
    return ok;
  }

  /** Keep only characters the font can draw; accented letters degrade to their base. */
  private clean(font: PDFFont, text: string): string {
    let out = "";
    for (const ch of text) {
      if (ch === "\u00ad" || ch === "\u200b" || ch === "\u200c" || ch === "\u200d" || ch === "\ufeff") continue;
      if (this.canEncode(font, ch)) {
        out += ch;
        continue;
      }
      const mapped = FALLBACK_CHARS[ch];
      if (mapped !== undefined) {
        out += mapped;
        continue;
      }
      const base = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
      if (base && base !== ch && [...base].every((b) => this.canEncode(font, b))) out += base;
    }
    return out;
  }

  /**
   * Text width without kerning. pdf-lib's widthOfTextAtSize applies the
   * font's kerning pairs, but drawText doesn't, so measuring whole strings
   * under-reports what actually gets drawn and words run into each other.
   */
  private width(font: PDFFont, text: string, size: number): number {
    let cache = this.glyphWidths.get(font);
    if (!cache) {
      cache = new Map();
      this.glyphWidths.set(font, cache);
    }
    let total = 0;
    for (const ch of text) {
      let w = cache.get(ch);
      if (w === undefined) {
        try {
          w = font.widthOfTextAtSize(ch, 1000) / 1000;
        } catch {
          w = 0.5;
        }
        cache.set(ch, w);
      }
      total += w * size;
    }
    return total;
  }

  private async image(ref: ImageRef): Promise<PDFImage | undefined> {
    let p = this.images.get(ref.data);
    if (!p) {
      p = (ref.kind === "png" ? this.doc.embedPng(ref.data) : this.doc.embedJpg(ref.data)).catch(() => undefined);
      this.images.set(ref.data, p);
    }
    return p;
  }

  // -- pages -----------------------------------------------------------------

  private newPage(): void {
    this.page = this.doc.addPage([this.section.width, this.section.height]);
    this.y = this.section.height - this.section.top;
    this.prevPara = undefined;
  }

  private get bottom(): number {
    return this.section.bottom;
  }

  private get contentWidth(): number {
    return this.section.width - this.section.left - this.section.right;
  }

  private get atPageTop(): boolean {
    return this.y >= this.section.height - this.section.top - 0.01;
  }

  // -- paragraph measurement -------------------------------------------------

  private piece(text: string, style: RunStyle): Piece | undefined {
    const font = this.font(style);
    const cleaned = this.clean(font, style.caps ? text.toUpperCase() : text);
    if (!cleaned) return undefined;
    const size = style.script === "normal" ? style.size : style.size * 0.65;
    const rise = style.script === "super" ? style.size * 0.35 : style.script === "sub" ? -style.size * 0.15 : 0;
    return { kind: "text", text: cleaned, style, font, size, rise, width: this.width(font, cleaned, size) };
  }

  private async units(para: Para, maxWidth: number, maxHeight: number): Promise<Unit[]> {
    const units: Unit[] = [];
    let word: (Piece | ImagePiece)[] = [];
    const flushWord = () => {
      if (word.length) {
        units.push({ kind: "word", pieces: word, width: word.reduce((w, p) => w + p.width, 0) });
        word = [];
      }
    };
    if (para.label !== undefined) {
      const piece = this.piece(para.label, para.mark);
      if (piece) {
        word.push(piece);
        flushWord();
      }
      units.push({ kind: "tab" });
    }
    for (const inline of para.inlines) {
      switch (inline.kind) {
        case "text": {
          const parts = inline.text.split(/([ \t\n\r]+)/);
          for (const part of parts) {
            if (!part) continue;
            if (/^[ \t\n\r]+$/.test(part)) {
              flushWord();
              for (const ch of part) {
                if (ch === "\t") units.push({ kind: "tab" });
                else if (ch === "\n") units.push({ kind: "break" });
                else if (ch === " ") units.push({ kind: "space", style: inline.style });
              }
            } else {
              const piece = this.piece(part, inline.style);
              if (piece) word.push(piece);
            }
          }
          break;
        }
        case "image": {
          const img = await this.image(inline.image);
          if (!img) {
            const piece = this.piece("[image]", { ...para.mark, italic: true, color: PLACEHOLDER });
            if (piece) word.push(piece);
            break;
          }
          let { width, height } = inline;
          const scale = Math.min(1, maxWidth / width, maxHeight / height);
          width *= scale;
          height *= scale;
          flushWord();
          word.push({ kind: "image", image: img, width, height });
          flushWord();
          break;
        }
        case "placeholder": {
          const piece = this.piece("[image]", { ...inline.style, italic: true, color: PLACEHOLDER });
          if (piece) word.push(piece);
          break;
        }
        case "tab":
          flushWord();
          units.push({ kind: "tab" });
          break;
        case "break":
          flushWord();
          units.push({ kind: "break" });
          break;
        case "pageBreak":
          flushWord();
          units.push({ kind: "pageBreak" });
          break;
      }
    }
    flushWord();
    return units;
  }

  private lineHeightFor(para: Para, size: number): number {
    const natural = size * LINE_FACTOR;
    if (para.props.lineRule === "exact" && para.props.lineExact) return para.props.lineExact;
    if (para.props.lineRule === "atLeast" && para.props.lineExact) return Math.max(natural, para.props.lineExact);
    return natural * para.props.line;
  }

  /** Lay a paragraph out into lines for the given width (relative to the paragraph's box). */
  private async layoutParagraph(para: Para, boxWidth: number, maxHeight: number): Promise<Line[]> {
    const p = para.props;
    const left = Math.max(0, p.left);
    const right = Math.max(0, p.right);
    const avail = Math.max(10, boxWidth - left - right);
    const firstOffset = p.hanging > 0 ? -p.hanging : p.firstLine;
    const units = await this.units(para, avail, maxHeight);

    const lines: Line[] = [];
    let items: LineItem[] = [];
    let width = 0;
    let pendingSpaces: Gap[] = [];
    let first = true;

    const lineAvail = () => avail - (first ? firstOffset : 0);
    const lineStart = () => left + (first ? firstOffset : 0);

    const finish = (pageBreakAfter = false) => {
      // Trailing spaces don't count.
      while (items.length && items[items.length - 1]!.kind === "space") {
        width -= (items.pop() as Gap).width;
      }
      let maxSize = 0;
      let maxImage = 0;
      for (const it of items) {
        if (it.kind === "text") maxSize = Math.max(maxSize, it.style.size);
        else if (it.kind === "image") maxImage = Math.max(maxImage, it.height);
        else if (it.style) maxSize = Math.max(maxSize, it.style.size);
      }
      if (maxSize === 0) maxSize = para.mark.size;
      const textHeight = this.lineHeightFor(para, maxSize);
      const descent = maxSize * DESCENT;
      const height = Math.max(textHeight, maxImage + descent);
      lines.push({ items, width, height, baseline: height - descent, pageBreakAfter, last: false });
      items = [];
      width = 0;
      pendingSpaces = [];
      first = false;
    };

    const tabStop = (x: number): number => {
      const abs = lineStart() + x; // position relative to the box's left edge
      const stops = [...p.tabs];
      if (para.label !== undefined && p.hanging > 0) stops.push(left);
      stops.sort((a, b) => a - b);
      for (const s of stops) if (s > abs + 0.5) return s - lineStart();
      const next = (Math.floor(abs / DEFAULT_TAB) + 1) * DEFAULT_TAB;
      return next - lineStart();
    };

    for (const u of units) {
      switch (u.kind) {
        case "space":
          if (items.length) pendingSpaces.push({ kind: "space", width: this.width(this.font(u.style), " ", u.style.size), style: u.style });
          break;
        case "tab": {
          for (const s of pendingSpaces) {
            items.push(s);
            width += s.width;
          }
          pendingSpaces = [];
          const target = tabStop(width);
          if (target > lineAvail()) {
            finish();
          } else {
            items.push({ kind: "tab", width: target - width, style: undefined });
            width = target;
          }
          break;
        }
        case "break":
          finish();
          break;
        case "pageBreak":
          finish(true);
          break;
        case "word": {
          const spaceW = pendingSpaces.reduce((w, s) => w + s.width, 0);
          if (items.length && width + spaceW + u.width > lineAvail()) {
            finish();
          }
          for (const s of items.length ? pendingSpaces : []) {
            items.push(s);
            width += s.width;
          }
          pendingSpaces = [];
          if (u.width > lineAvail() && !items.length) {
            // A single unbreakable unit wider than the line: break by characters.
            for (const piece of u.pieces) {
              if (piece.kind === "image") {
                items.push(piece);
                width += piece.width;
                continue;
              }
              let chunk = "";
              for (const ch of piece.text) {
                const w = this.width(piece.font, chunk + ch, piece.size);
                if (chunk && width + w > lineAvail()) {
                  items.push({ ...piece, text: chunk, width: this.width(piece.font, chunk, piece.size) });
                  finish();
                  chunk = "";
                }
                chunk += ch;
              }
              if (chunk) {
                const w = this.width(piece.font, chunk, piece.size);
                items.push({ ...piece, text: chunk, width: w });
                width += w;
              }
            }
          } else {
            for (const piece of u.pieces) items.push(piece);
            width += u.width;
          }
          break;
        }
      }
    }
    if (items.length || lines.length === 0) finish();
    lines[lines.length - 1]!.last = true;
    return lines;
  }

  // -- drawing ---------------------------------------------------------------

  private drawLine(line: Line, para: Para, boxX: number, boxWidth: number, top: number, isFirst: boolean): void {
    const p = para.props;
    const left = Math.max(0, p.left);
    const right = Math.max(0, p.right);
    const firstOffset = p.hanging > 0 ? -p.hanging : p.firstLine;
    const start = left + (isFirst ? firstOffset : 0);
    const avail = Math.max(10, boxWidth - left - right) - (isFirst ? firstOffset : 0);

    let x = boxX + start;
    let extraPerSpace = 0;
    const slack = avail - line.width;
    if (p.align === "center") x += slack / 2;
    else if (p.align === "right") x += slack;
    else if (p.align === "both" && !line.last && slack > 0) {
      const spaces = line.items.filter((i) => i.kind === "space").length;
      if (spaces > 0) extraPerSpace = slack / spaces;
    }

    const baseline = top - line.baseline;
    if (p.shading) {
      this.page.drawRectangle({ x: boxX + left, y: top - line.height, width: boxWidth - left - right, height: line.height, color: p.shading });
    }
    for (const it of line.items) {
      if (it.kind === "image") {
        this.page.drawImage(it.image, { x, y: baseline, width: it.width, height: it.height });
        x += it.width;
        continue;
      }
      if (it.kind !== "text") {
        x += it.width + (it.kind === "space" ? extraPerSpace : 0);
        continue;
      }
      const y = baseline + it.rise;
      if (it.style.highlight) {
        this.page.drawRectangle({ x, y: y - it.size * DESCENT, width: it.width, height: it.size * LINE_FACTOR, color: it.style.highlight });
      }
      const color = it.style.color ?? (it.style.link ? LINK : INK);
      try {
        this.page.drawText(it.text, { x, y, size: it.size, font: it.font, color });
      } catch {
        // Should not happen after clean(); never let one word kill the document.
      }
      if (it.style.underline || it.style.link) {
        this.page.drawLine({ start: { x, y: y - it.size * 0.12 }, end: { x: x + it.width, y: y - it.size * 0.12 }, thickness: Math.max(0.5, it.size * 0.05), color });
      }
      if (it.style.strike) {
        this.page.drawLine({ start: { x, y: y + it.size * 0.28 }, end: { x: x + it.width, y: y + it.size * 0.28 }, thickness: Math.max(0.5, it.size * 0.05), color });
      }
      x += it.width;
    }
  }

  // -- block flow (page body) ------------------------------------------------

  private async flow(blocks: Block[]): Promise<void> {
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      if (block.kind === "pageBreak") {
        if (!this.atPageTop) this.newPage();
        continue;
      }
      if (block.kind === "table") {
        await this.flowTable(block);
        continue;
      }
      await this.flowParagraph(block, blocks[i + 1]);
    }
  }

  private spacingBefore(para: Para): number {
    const prev = this.prevPara;
    if (prev && prev.props.contextualSpacing && para.props.contextualSpacing && prev.props.styleId === para.props.styleId) return 0;
    return para.props.before;
  }

  private spacingAfter(para: Para, next: Block | undefined): number {
    if (next?.kind === "para" && next.props.contextualSpacing && para.props.contextualSpacing && next.props.styleId === para.props.styleId) return 0;
    return para.props.after;
  }

  private async flowParagraph(para: Para, next: Block | undefined): Promise<void> {
    const pageHeight = this.section.height - this.section.top - this.bottom;
    if (para.props.pageBreakBefore && !this.atPageTop) this.newPage();
    const lines = await this.layoutParagraph(para, this.contentWidth, pageHeight * 0.9);
    const total = lines.reduce((h, l) => h + l.height, 0);

    // Keep headings with the following block: need room for this paragraph
    // and a couple of lines of what follows.
    if (para.props.keepNext && next && next.kind !== "pageBreak" && !this.atPageTop) {
      const needed = this.spacingBefore(para) + total + para.props.after + para.mark.size * LINE_FACTOR * 2;
      if (this.y - needed < this.bottom && total < pageHeight) this.newPage();
    }

    if (!this.atPageTop) this.y -= this.spacingBefore(para);
    if (this.y - (lines[0]?.height ?? 0) < this.bottom && !this.atPageTop) this.newPage();

    const boxX = this.section.left;
    if (para.props.borderTop) {
      const b = para.props.borderTop;
      this.page.drawLine({ start: { x: boxX + para.props.left, y: this.y - 1 }, end: { x: boxX + this.contentWidth - para.props.right, y: this.y - 1 }, thickness: b.width, color: b.color });
      this.y -= b.width + 2;
    }
    lines.forEach((line, idx) => {
      if (this.y - line.height < this.bottom && !this.atPageTop) this.newPage();
      this.drawLine(line, para, boxX, this.contentWidth, this.y, idx === 0);
      this.y -= line.height;
      if (line.pageBreakAfter) this.newPage();
    });
    if (para.props.borderBottom) {
      const b = para.props.borderBottom;
      this.y -= 2;
      this.page.drawLine({ start: { x: boxX + para.props.left, y: this.y }, end: { x: boxX + this.contentWidth - para.props.right, y: this.y }, thickness: b.width, color: b.color });
      this.y -= b.width;
    }
    this.y -= this.spacingAfter(para, next);
    this.prevPara = para;
  }

  // -- tables ----------------------------------------------------------------

  private resolveColumns(table: Table, availWidth: number): number[] {
    const cols = table.colWidths.length;
    let widths = table.colWidths.some((w) => w < 0)
      ? new Array<number>(cols).fill(availWidth / Math.max(1, cols))
      : [...table.colWidths];
    const sum = widths.reduce((a, b) => a + b, 0);
    if (sum > availWidth && sum > 0) widths = widths.map((w) => (w / sum) * availWidth);
    return widths;
  }

  /** Measure a cell's blocks; returns the height and a draw callback. */
  private async measureBlocks(blocks: Block[], width: number, maxHeight: number): Promise<{ height: number; draw: (x: number, top: number) => void }> {
    const parts: { height: number; draw: (x: number, top: number) => void }[] = [];
    let prev: Para | undefined;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      if (block.kind === "pageBreak") continue;
      if (block.kind === "table") {
        const m = await this.measureTable(block, width, maxHeight);
        parts.push(m);
        prev = undefined;
        continue;
      }
      const para = block;
      const lines = await this.layoutParagraph(para, width, maxHeight);
      const next = blocks[i + 1];
      const before = prev && prev.props.contextualSpacing && para.props.contextualSpacing && prev.props.styleId === para.props.styleId ? 0 : para.props.before;
      const after = next?.kind === "para" && next.props.contextualSpacing && para.props.contextualSpacing && next.props.styleId === para.props.styleId ? 0 : para.props.after;
      const height = before + lines.reduce((h, l) => h + l.height, 0) + after;
      parts.push({
        height,
        draw: (x, top) => {
          let y = top - before;
          lines.forEach((line, idx) => {
            this.drawLine(line, para, x, width, y, idx === 0);
            y -= line.height;
          });
        },
      });
      prev = para;
    }
    const height = parts.reduce((h, p) => h + p.height, 0);
    return {
      height,
      draw: (x, top) => {
        let y = top;
        for (const p of parts) {
          p.draw(x, y);
          y -= p.height;
        }
      },
    };
  }

  private async measureTable(table: Table, availWidth: number, maxHeight: number): Promise<{ height: number; draw: (x: number, top: number) => void }> {
    const rows = await this.measureRows(table, availWidth, maxHeight);
    return {
      height: rows.reduce((h, r) => h + r.height, 0),
      draw: (x, top) => {
        let y = top;
        for (const r of rows) {
          r.draw(x + table.indent, y);
          y -= r.height;
        }
      },
    };
  }

  private async measureRows(table: Table, availWidth: number, maxHeight: number) {
    const widths = this.resolveColumns(table, availWidth - table.indent);
    const out: { height: number; draw: (x: number, top: number) => void }[] = [];
    for (let r = 0; r < table.rows.length; r++) {
      const row = table.rows[r]!;
      const cells: { x: number; width: number; cell: Cell; content: { height: number; draw: (x: number, top: number) => void }; mergeDown: boolean }[] = [];
      let col = 0;
      let x = 0;
      for (const cell of row.cells) {
        const width = widths.slice(col, col + cell.span).reduce((a, b) => a + b, 0) || widths[widths.length - 1] || 0;
        const inner = Math.max(10, width - CELL_PAD_X * 2);
        const content = cell.vMerge === "continue"
          ? { height: 0, draw: () => {} }
          : await this.measureBlocks(cell.blocks, inner, maxHeight);
        // Does the cell directly below continue this one vertically?
        const below = table.rows[r + 1];
        let mergeDown = false;
        if (below) {
          let bc = 0;
          for (const c of below.cells) {
            if (bc === col) {
              mergeDown = c.vMerge === "continue";
              break;
            }
            bc += c.span;
          }
        }
        cells.push({ x, width, cell, content, mergeDown });
        x += width;
        col += cell.span;
      }
      const height = Math.max(row.minHeight, ...cells.map((c) => (c.cell.vMerge === "continue" ? 0 : c.content.height + CELL_PAD_Y * 2)));
      out.push({
        height,
        draw: (ox, top) => {
          for (const c of cells) {
            const cx = ox + c.x;
            if (c.cell.shading) {
              this.page.drawRectangle({ x: cx, y: top - height, width: c.width, height, color: c.cell.shading });
            }
            c.content.draw(cx + CELL_PAD_X, top - CELL_PAD_Y);
            if (table.borders) {
              const line = (x1: number, y1: number, x2: number, y2: number) =>
                this.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.5, color: BORDER });
              line(cx, top, cx, top - height);
              line(cx + c.width, top, cx + c.width, top - height);
              if (c.cell.vMerge !== "continue") line(cx, top, cx + c.width, top);
              if (!c.mergeDown) line(cx, top - height, cx + c.width, top - height);
            }
          }
        },
      });
    }
    return out;
  }

  private async flowTable(table: Table): Promise<void> {
    const pageHeight = this.section.height - this.section.top - this.bottom;
    const rows = await this.measureRows(table, this.contentWidth, pageHeight * 0.9);
    for (const row of rows) {
      if (this.y - row.height < this.bottom && !this.atPageTop) this.newPage();
      row.draw(this.section.left + table.indent, this.y);
      this.y -= row.height;
    }
    this.y -= 4;
    this.prevPara = undefined;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Convert a .docx file's bytes to PDF bytes. */
export async function docxToPdf(input: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("This file doesn't look like a Word document (.docx).");
  }
  if (!files["word/document.xml"]) {
    throw new Error("This file doesn't look like a Word document (.docx).");
  }
  const parsed = new DocxReader(files).parse();
  return new Renderer().render(parsed);
}
