// Markdown → PDF, DOM-free: runs in the browser AND in Bun (MCP server).
// Uses marked for parsing and pdf-lib with standard fonts for layout, so no
// canvas or network is involved — files never leave the device.
import { marked, type Token, type Tokens } from "marked";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const MARGIN = 64;
const CONTENT_W = PAGE_W - MARGIN * 2;

const TEXT_SIZE = 11;
const CODE_SIZE = 9.5;
const LINE_GAP = 1.45;

const INK = rgb(0.13, 0.15, 0.2);
const MUTED = rgb(0.42, 0.45, 0.5);
const CODE_BG = rgb(0.955, 0.96, 0.97);
const RULE = rgb(0.85, 0.86, 0.88);
const LINK = rgb(0.23, 0.35, 0.8);

interface Style {
  bold: boolean;
  italic: boolean;
  code: boolean;
  link: boolean;
}

interface Word {
  text: string;
  style: Style;
}

const PLAIN: Style = { bold: false, italic: false, code: false, link: false };

/** Map characters pdf-lib's WinAnsi fonts can't encode to safe equivalents. */
function sanitize(text: string): string {
  return (
    text
      .replace(/[‘’‚]/g, "'")
      .replace(/[“”„]/g, '"')
      .replace(/[–]/g, "-")
      .replace(/[—]/g, "--")
      .replace(/…/g, "...")
      .replace(/ /g, " ")
      .replace(/[•●▪]/g, "·")
      // Anything else outside WinAnsi's Latin-1 range is dropped (e.g. emoji).
      .replace(/[^\x20-\x7E\xA0-\xFF\n\t]/g, "")
  );
}

/** Flatten marked inline tokens into styled words. */
function inlineWords(tokens: Token[] | undefined, base: Style, fallback: string): Word[] {
  if (!tokens || tokens.length === 0) {
    return splitWords(fallback, base);
  }
  const words: Word[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "strong":
        words.push(...inlineWords((t as Tokens.Strong).tokens, { ...base, bold: true }, t.raw));
        break;
      case "em":
        words.push(...inlineWords((t as Tokens.Em).tokens, { ...base, italic: true }, t.raw));
        break;
      case "del":
        words.push(...inlineWords((t as Tokens.Del).tokens, base, t.raw));
        break;
      case "codespan":
        words.push(...splitWords((t as Tokens.Codespan).text, { ...base, code: true }));
        break;
      case "link": {
        const link = t as Tokens.Link;
        words.push(...inlineWords(link.tokens, { ...base, link: true }, link.text));
        break;
      }
      case "image":
        words.push(...splitWords(`[image: ${(t as Tokens.Image).text || "untitled"}]`, { ...base, italic: true }));
        break;
      case "br":
        words.push({ text: "\n", style: base });
        break;
      case "escape":
      case "text": {
        const inner = (t as Tokens.Text).tokens;
        if (inner && inner.length > 0) {
          words.push(...inlineWords(inner, base, t.raw));
        } else {
          words.push(...splitWords((t as Tokens.Text).text, base));
        }
        break;
      }
      default:
        words.push(...splitWords(t.raw ?? "", base));
    }
  }
  return words;
}

function splitWords(text: string, style: Style): Word[] {
  // marked leaves HTML entities in `text` for some tokens; decode common ones.
  const decoded = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return sanitize(decoded)
    .split(/[ \t]+/)
    .filter((w) => w.length > 0)
    .map((w) => ({ text: w, style }));
}

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  fonts: {
    regular: PDFFont;
    bold: PDFFont;
    italic: PDFFont;
    boldItalic: PDFFont;
    mono: PDFFont;
  };
}

function fontFor(ctx: Ctx, style: Style): PDFFont {
  if (style.code) return ctx.fonts.mono;
  if (style.bold && style.italic) return ctx.fonts.boldItalic;
  if (style.bold) return ctx.fonts.bold;
  if (style.italic) return ctx.fonts.italic;
  return ctx.fonts.regular;
}

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.y = PAGE_H - MARGIN;
}

function ensureRoom(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN) newPage(ctx);
}

function safeWidth(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.55;
  }
}

function drawText(ctx: Ctx, text: string, x: number, size: number, font: PDFFont, color = INK) {
  try {
    ctx.page.drawText(text, { x, y: ctx.y, size, font, color });
  } catch {
    // A character slipped past sanitize(); drop the word rather than the doc.
  }
}

/** Word-wrap styled words into the given width and draw them. */
function drawWords(ctx: Ctx, words: Word[], size: number, indent: number, color = INK) {
  const lineHeight = size * LINE_GAP;
  const maxWidth = CONTENT_W - indent;
  let line: Word[] = [];
  let lineWidth = 0;
  const spaceW = safeWidth(ctx.fonts.regular, " ", size);

  const flush = () => {
    if (line.length === 0) return;
    ensureRoom(ctx, lineHeight);
    ctx.y -= lineHeight;
    let x = MARGIN + indent;
    for (const w of line) {
      const font = fontFor(ctx, w.style);
      drawText(ctx, w.text, x, size, font, w.style.link ? LINK : color);
      x += safeWidth(font, w.text, size) + spaceW;
    }
    line = [];
    lineWidth = 0;
  };

  for (const word of words) {
    if (word.text === "\n") {
      flush();
      continue;
    }
    const w = safeWidth(fontFor(ctx, word.style), word.text, size);
    if (line.length > 0 && lineWidth + spaceW + w > maxWidth) flush();
    line.push(word);
    lineWidth += (line.length > 1 ? spaceW : 0) + w;
  }
  flush();
}

function heading(ctx: Ctx, depth: number, words: Word[]) {
  const sizes: Record<number, number> = { 1: 24, 2: 18, 3: 14.5, 4: 12.5, 5: 11.5, 6: 11 };
  const size = sizes[depth] ?? 11;
  ensureRoom(ctx, size * 2.2);
  ctx.y -= size * 0.8;
  drawWords(
    ctx,
    words.map((w) => ({ ...w, style: { ...w.style, bold: true } })),
    size,
    0,
  );
  if (depth <= 2) {
    ctx.y -= 6;
    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y },
      end: { x: PAGE_W - MARGIN, y: ctx.y },
      thickness: 0.75,
      color: RULE,
    });
  }
  ctx.y -= 6;
}

function codeBlock(ctx: Ctx, raw: string) {
  const lines = sanitize(raw).split("\n");
  const lineHeight = CODE_SIZE * 1.5;
  const pad = 8;
  let i = 0;
  while (i < lines.length) {
    ensureRoom(ctx, lineHeight + pad * 2);
    // How many lines fit on this page?
    const fit = Math.max(1, Math.floor((ctx.y - MARGIN - pad * 2) / lineHeight));
    const chunk = lines.slice(i, i + fit);
    const boxH = chunk.length * lineHeight + pad * 2;
    ctx.page.drawRectangle({
      x: MARGIN,
      y: ctx.y - boxH,
      width: CONTENT_W,
      height: boxH,
      color: CODE_BG,
    });
    ctx.y -= pad;
    for (const line of chunk) {
      ctx.y -= lineHeight;
      drawText(ctx, line.slice(0, 110), MARGIN + pad, CODE_SIZE, ctx.fonts.mono);
    }
    ctx.y -= pad;
    i += fit;
  }
  ctx.y -= 8;
}

function listBlock(ctx: Ctx, list: Tokens.List, level = 0) {
  const indent = 18 + level * 18;
  let n = typeof list.start === "number" && list.ordered ? list.start : 1;
  for (const item of list.items) {
    const marker = list.ordered ? `${n}.` : "·";
    n += 1;
    // Draw marker, then the item body indented past it.
    const lineHeight = TEXT_SIZE * LINE_GAP;
    ensureRoom(ctx, lineHeight);
    const markerY = ctx.y;
    const body: Word[] = [];
    const nested: Tokens.List[] = [];
    for (const t of item.tokens) {
      if (t.type === "list") nested.push(t as Tokens.List);
      else if (t.type === "text") body.push(...inlineWords((t as Tokens.Text).tokens, PLAIN, (t as Tokens.Text).text));
      else if (t.type === "paragraph") body.push(...inlineWords((t as Tokens.Paragraph).tokens, PLAIN, (t as Tokens.Paragraph).text));
      else if (t.type === "code") body.push(...splitWords((t as Tokens.Code).text, { ...PLAIN, code: true }));
    }
    drawWords(ctx, body, TEXT_SIZE, indent);
    // Place the marker aligned with the first line the body produced.
    ctx.page.drawText(marker, {
      x: MARGIN + indent - 14,
      y: markerY - lineHeight,
      size: TEXT_SIZE,
      font: ctx.fonts.regular,
      color: MUTED,
    });
    for (const sub of nested) listBlock(ctx, sub, level + 1);
    ctx.y -= 3;
  }
  ctx.y -= 5;
}

function blockquote(ctx: Ctx, quote: Tokens.Blockquote) {
  const startY = ctx.y;
  for (const t of quote.tokens) {
    if (t.type === "paragraph") {
      drawWords(ctx, inlineWords((t as Tokens.Paragraph).tokens, PLAIN, (t as Tokens.Paragraph).text), TEXT_SIZE, 16, MUTED);
      ctx.y -= 4;
    }
  }
  ctx.page.drawRectangle({
    x: MARGIN + 2,
    y: ctx.y,
    width: 3,
    height: Math.max(0, startY - ctx.y),
    color: RULE,
  });
  ctx.y -= 6;
}

function table(ctx: Ctx, tok: Tokens.Table) {
  // Simple monospace rendering — dependable across arbitrary column counts.
  const rows: string[][] = [
    tok.header.map((c) => c.text),
    ...tok.rows.map((r) => r.map((c) => c.text)),
  ];
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  const lines = rows.map((row) =>
    row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  "),
  );
  lines.splice(1, 0, widths.map((w) => "-".repeat(w)).join("  "));
  codeBlock(ctx, lines.join("\n"));
}

/** Convert Markdown text to PDF bytes. */
export async function markdownToPdf(markdown: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const ctx: Ctx = {
    doc,
    page: undefined as unknown as PDFPage,
    y: 0,
    fonts: {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
      italic: await doc.embedFont(StandardFonts.HelveticaOblique),
      boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
      mono: await doc.embedFont(StandardFonts.Courier),
    },
  };
  newPage(ctx);

  const tokens = marked.lexer(markdown);
  for (const token of tokens) {
    switch (token.type) {
      case "heading":
        heading(ctx, (token as Tokens.Heading).depth, inlineWords((token as Tokens.Heading).tokens, PLAIN, (token as Tokens.Heading).text));
        break;
      case "paragraph":
        drawWords(ctx, inlineWords((token as Tokens.Paragraph).tokens, PLAIN, (token as Tokens.Paragraph).text), TEXT_SIZE, 0);
        ctx.y -= 8;
        break;
      case "code":
        codeBlock(ctx, (token as Tokens.Code).text);
        break;
      case "list":
        listBlock(ctx, token as Tokens.List);
        break;
      case "blockquote":
        blockquote(ctx, token as Tokens.Blockquote);
        break;
      case "table":
        table(ctx, token as Tokens.Table);
        break;
      case "hr":
        ensureRoom(ctx, 20);
        ctx.y -= 12;
        ctx.page.drawLine({
          start: { x: MARGIN, y: ctx.y },
          end: { x: PAGE_W - MARGIN, y: ctx.y },
          thickness: 0.75,
          color: RULE,
        });
        ctx.y -= 8;
        break;
      case "space":
        break;
      default:
        if ("text" in token && typeof token.text === "string") {
          drawWords(ctx, splitWords(token.text, PLAIN), TEXT_SIZE, 0);
          ctx.y -= 8;
        }
    }
  }

  return doc.save();
}
