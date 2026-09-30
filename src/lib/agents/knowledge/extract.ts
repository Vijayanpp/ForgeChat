import { MAX_UPLOAD_BYTES } from "./limits";

export type KnowledgeFileFormat = "pdf" | "docx" | "text" | "markdown" | "csv";

export class KnowledgeFileError extends Error {}

export interface ExtractedKnowledge {
  format: KnowledgeFileFormat;
  text: string;
  pages?: number;
}

export function formatFromName(name: string): KnowledgeFileFormat | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "txt") return "text";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "csv") return "csv";
  return null;
}

/** Normalise extracted text so paragraphs survive as retrieval chunks. */
export function cleanExtractedText(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** One blank-line-separated block per row ("Header: value" lines), e.g. FAQ sheets. */
export function csvToKnowledge(text: string): string {
  const [header, ...rows] = parseCsv(text);
  if (!header) return "";
  const labels = header.map((h, i) => h.trim() || `Column ${i + 1}`);
  return rows
    .map((r) =>
      r
        .map((cell, i) => (cell.trim() ? `${labels[i] ?? `Column ${i + 1}`}: ${cell.trim()}` : ""))
        .filter(Boolean)
        .join("\n"),
    )
    .filter(Boolean)
    .join("\n\n");
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

async function extractPdf(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  if (decodeText(bytes.subarray(0, 5)) !== "%PDF-") throw new KnowledgeFileError("This file is not a valid PDF.");
  const { extractText, getDocumentProxy } = await import("unpdf");
  try {
    const pdf = await getDocumentProxy(bytes);
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    return { text: text.map((page) => page.trim()).filter(Boolean).join("\n\n"), pages: totalPages };
  } catch {
    throw new KnowledgeFileError("Could not read this PDF. It may be encrypted or damaged.");
  }
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new KnowledgeFileError("This file is not a valid .docx document.");
  const mammoth = await import("mammoth");
  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return value;
  } catch {
    throw new KnowledgeFileError("Could not read this Word document.");
  }
}

export async function extractKnowledgeFile(name: string, bytes: Uint8Array): Promise<ExtractedKnowledge> {
  const format = formatFromName(name);
  if (!format) throw new KnowledgeFileError("Unsupported file type. Upload PDF, DOCX, TXT, MD or CSV.");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new KnowledgeFileError("File is larger than 8 MB.");

  let text: string;
  let pages: number | undefined;
  if (format === "pdf") ({ text, pages } = await extractPdf(bytes));
  else if (format === "docx") text = await extractDocx(bytes);
  else if (format === "csv") text = csvToKnowledge(decodeText(bytes));
  else text = decodeText(bytes);

  const cleaned = cleanExtractedText(text);
  if (!cleaned) {
    throw new KnowledgeFileError(
      format === "pdf"
        ? "No text found in this PDF. Scanned/image-only PDFs are not supported yet."
        : "No text found in this file.",
    );
  }
  return { format, text: cleaned, ...(pages ? { pages } : {}) };
}
