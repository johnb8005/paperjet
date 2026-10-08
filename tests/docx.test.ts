import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { docxToPdf } from "../src/lib/pdf/docx";

const fixture = (name: string) =>
  Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).arrayBuffer();

/** Extract page texts with pdf.js (legacy build runs without a DOM). */
async function pageTexts(pdf: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const standardFontDataUrl = new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname;
  const doc = await pdfjs.getDocument({
    data: pdf.slice(),
    useWorkerFetch: false,
    isEvalSupported: false,
    standardFontDataUrl,
  }).promise;
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    texts.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " "),
    );
  }
  return texts;
}

/** Build a bare-bones .docx in memory (no styles/numbering parts). */
function minimalDocx(bodyXml: string, extra: Record<string, string> = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ),
    "word/document.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`,
    ),
  };
  for (const [path, xml] of Object.entries(extra)) files[path] = strToU8(xml);
  return zipSync(files);
}

describe("docxToPdf", () => {
  test("converts a Word-authored document with lists, tables, images and page breaks", async () => {
    const pdf = await docxToPdf(await fixture("sample.docx"));
    const doc = await PDFDocument.load(pdf);
    // US Letter page size from the document's section properties.
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(612);
    expect(Math.round(height)).toBe(792);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);

    const pages = await pageTexts(pdf);
    const all = pages.join("\n");
    expect(pages[0]).toContain("Paperjet sample document");
    expect(pages[0]).toContain("bold , italic , underlined and colored text");
    // Word spacing survives pdf-lib's kerning-aware measurement.
    expect(all).toContain("Text after the image, then a page break.");
    // Numbered list labels come from numbering.xml.
    expect(pages[0]).toMatch(/1\. Step one 2\. Step two 3\. Step three/);
    // Table cells are laid out in order.
    expect(pages[0]).toMatch(/Header 0 Header 1 Header 2/);
    // The explicit page break starts a fresh page.
    const secondPage = pages.findIndex((p) => p.includes("Second page"));
    expect(secondPage).toBeGreaterThan(0);
    expect(pages[secondPage]!.startsWith("Second page")).toBe(true);
    // Superscript/subscript text is still present.
    expect(pages[secondPage]).toContain("Superscript H");
    // The image is embedded as a real image object.
    expect(pdf.length).toBeGreaterThan(20_000);
  });

  test("converts a pandoc-authored document and numbers nested lists correctly", async () => {
    const pdf = await docxToPdf(await fixture("pandoc.docx"));
    const [page] = await pageTexts(pdf);
    expect(page).toContain("Pandoc generated document");
    expect(page).toMatch(/1\. First item 1\. Nested a 2\. Nested b 2\. Second item/);
    expect(page).toMatch(/3\. Third item/);
    expect(page).toContain("hello world");
    expect(page).toMatch(/Left Center Right/);
    // Accented Latin letters degrade to base letters instead of vanishing.
    expect(page).toContain("Zazólc gesla jazn");
    expect(page).toContain("naïve café");
  });

  test("handles a minimal document with no styles or numbering parts", async () => {
    const docx = minimalDocx(
      `<w:p><w:r><w:t xml:space="preserve">Hello </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>world</w:t></w:r><w:r><w:t>&#x2013; &amp; done</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Centered</w:t></w:r></w:p>` +
        `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
    );
    const pdf = await docxToPdf(docx);
    const doc = await PDFDocument.load(pdf);
    // A4 from sectPr.
    expect(Math.round(doc.getPage(0).getSize().width)).toBe(595);
    const [page] = await pageTexts(pdf);
    expect(page).toContain("Hello world – & done");
    expect(page).toContain("Centered");
    expect(page).toContain("A B");
  });

  test("paginates long documents and honours page breaks", async () => {
    const paras = Array.from(
      { length: 120 },
      (_, i) => `<w:p><w:r><w:t>Paragraph ${i} with enough words to make it wrap at least once on an A4 page at the default size.</w:t></w:r></w:p>`,
    ).join("");
    const pdf = await docxToPdf(minimalDocx(paras + `<w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>Last</w:t></w:r></w:p>`));
    const pages = await pageTexts(pdf);
    expect(pages.length).toBeGreaterThan(2);
    expect(pages[pages.length - 1]!.trim()).toBe("Last");
  });

  test("drops characters the standard fonts can't draw without failing", async () => {
    const pdf = await docxToPdf(minimalDocx(`<w:p><w:r><w:t>Emoji 🚀 and Cyrillic Привет end</w:t></w:r></w:p>`));
    const [page] = await pageTexts(pdf);
    expect(page).toContain("Emoji");
    expect(page).toContain("end");
  });

  test("rejects files that aren't Word documents", async () => {
    await expect(docxToPdf(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/Word document/);
    const zipWithoutDocument = zipSync({ "hello.txt": strToU8("hi") });
    await expect(docxToPdf(zipWithoutDocument)).rejects.toThrow(/Word document/);
  });
});
