export interface ParsedContactCsvRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
}

/**
 * Parse a contacts CSV with a required `phone` column header.
 * Optional columns: name, email, company. Handles quoted fields.
 */
export function parseContactCsv(text: string): ParsedContactCsvRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/["']/g, ""));

  const phoneIdx = headers.indexOf("phone");
  if (phoneIdx === -1) return [];

  const nameIdx = headers.indexOf("name");
  const emailIdx = headers.indexOf("email");
  const companyIdx = headers.indexOf("company");

  const rows: ParsedContactCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const phone = values[phoneIdx]?.replace(/["']/g, "").trim();
    if (!phone) continue;

    rows.push({
      phone,
      name:
        nameIdx >= 0
          ? values[nameIdx]?.replace(/["']/g, "").trim() || undefined
          : undefined,
      email:
        emailIdx >= 0
          ? values[emailIdx]?.replace(/["']/g, "").trim() || undefined
          : undefined,
      company:
        companyIdx >= 0
          ? values[companyIdx]?.replace(/["']/g, "").trim() || undefined
          : undefined,
    });
  }

  return rows;
}
