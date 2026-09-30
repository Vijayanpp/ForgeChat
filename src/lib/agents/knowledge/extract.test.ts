import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { appendKnowledge, sourceTitle } from "./append";
import { cleanExtractedText, csvToKnowledge, extractKnowledgeFile, KnowledgeFileError, parseCsv } from "./extract";

const bytes = (s: string) => new TextEncoder().encode(s);

/** Minimal single-font PDF with one text line per page and a valid xref table. */
function makePdf(pages: string[]): Uint8Array {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((text, i) => {
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objects[pageIds[i]] =
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> " +
      `/Contents ${pageIds[i] + 1} 0 R >>`;
    objects[pageIds[i] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return bytes(out);
}

async function makeDocx(paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
      .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
      .join("")}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

describe("knowledge file extraction", () => {
  it("reads PDFs page by page", async () => {
    const result = await extractKnowledgeFile(
      "policy.pdf",
      makePdf(["Returns accepted within 7 days.", "We deliver to Pune."]),
    );
    expect(result.format).toBe("pdf");
    expect(result.pages).toBe(2);
    expect(result.text).toContain("Returns accepted within 7 days.");
    expect(result.text).toContain("We deliver to Pune.");
  });

  it("reads Word documents", async () => {
    const result = await extractKnowledgeFile("faq.docx", await makeDocx(["Shipping", "Orders ship in 2 days."]));
    expect(result.format).toBe("docx");
    expect(result.text).toContain("Orders ship in 2 days.");
  });

  it("turns FAQ spreadsheets into one block per row", async () => {
    const csv = 'Question,Answer\n"Do you ship to Pune?","Yes, in 3 days"\nRefunds?,"Within 7 days, ""no questions"""\n';
    const result = await extractKnowledgeFile("faq.csv", bytes(csv));
    expect(result.text).toBe(
      'Question: Do you ship to Pune?\nAnswer: Yes, in 3 days\n\nQuestion: Refunds?\nAnswer: Within 7 days, "no questions"',
    );
  });

  it("rejects unsupported, disguised and empty files", async () => {
    await expect(extractKnowledgeFile("photo.png", bytes("x"))).rejects.toBeInstanceOf(KnowledgeFileError);
    await expect(extractKnowledgeFile("fake.pdf", bytes("hello"))).rejects.toThrow(/not a valid PDF/);
    await expect(extractKnowledgeFile("fake.docx", bytes("hello"))).rejects.toThrow(/not a valid .docx/);
    await expect(extractKnowledgeFile("blank.txt", bytes("  \n\n "))).rejects.toThrow(/No text/);
  });

  it("normalises whitespace and control characters", () => {
    expect(cleanExtractedText("\uFEFFa  \r\n\r\n\r\n\r\nb\u0000")).toBe("a\n\nb");
    expect(parseCsv('a,"b\nc"\r\n1,2')).toEqual([
      ["a", "b\nc"],
      ["1", "2"],
    ]);
    expect(csvToKnowledge("")).toBe("");
  });
});

describe("appendKnowledge", () => {
  it("adds each file as its own section", () => {
    expect(sourceTitle("refund_policy-v2.pdf")).toBe("refund policy v2");
    const { value, truncated } = appendKnowledge("## Hours\nOpen 9-5", "refund_policy.pdf", "7 day returns", 1000);
    expect(value).toBe("## Hours\nOpen 9-5\n\n## refund policy\n\n7 day returns");
    expect(truncated).toBe(false);
  });

  it("truncates at a paragraph break when the limit is reached", () => {
    const text = ["First paragraph.", "Second paragraph.", "Third paragraph that will not fit."].join("\n\n");
    const result = appendKnowledge("", "doc.txt", text, 45);
    expect(result.truncated).toBe(true);
    expect(result.value).toBe("## doc\n\nFirst paragraph.\n\nSecond paragraph.");
    expect(appendKnowledge("x".repeat(10), "doc.txt", "more", 10)).toMatchObject({ added: 0, truncated: true });
  });
});
