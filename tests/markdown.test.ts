import { describe, expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { markdownToPdf } from "../src/lib/pdf/markdown";

const SAMPLE = `# Title

Some **bold** and *italic* text with \`inline code\` and a [link](https://example.com).

## Section

- bullet one
- bullet two
  - nested bullet

1. first
2. second

> A blockquote spanning
> two lines.

\`\`\`ts
const x = 42;
console.log(x);
\`\`\`

| Col A | Col B |
|-------|-------|
| 1     | 2     |

---

Final paragraph with emoji 🚀 and curly “quotes”.
`;

describe("markdownToPdf", () => {
  test("renders a full document to a valid PDF", async () => {
    const bytes = await markdownToPdf(SAMPLE);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  test("paginates long documents", async () => {
    const long = Array.from({ length: 200 }, (_, i) => `Paragraph ${i} with some wrapping text that goes on for a while to fill space.`).join("\n\n");
    const bytes = await markdownToPdf(long);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  test("handles empty input", async () => {
    const bytes = await markdownToPdf("");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});
