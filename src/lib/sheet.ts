/**
 * Generic spreadsheet read/write for email verification.
 *
 * Deliberately *not* `import-contacts.ts`. That parser maps a sheet onto the
 * fixed ContactRow shape and discards everything else, which is exactly wrong
 * here: the promise of this feature is that the file you download has every
 * column the file you uploaded had. So rows are carried as positional arrays
 * aligned to the header row and never keyed by header name — duplicate or
 * blank headers would silently collapse into one another otherwise.
 */

import Papa from "papaparse";
import * as ExcelJS from "exceljs";

/**
 * Hard cap on rows per run, enforced here and stated in the UI.
 *
 * Verification is done by probing mail servers from this machine, one SMTP
 * conversation per domain, which lands somewhere around 300-600 rows an hour.
 * Above 500 rows a run stops being something you wait for, and the probing
 * volume starts to look like abuse to the servers on the receiving end.
 */
export const MAX_SHEET_ROWS = 500;

export const SHEET_EXTENSIONS = ["csv", "xlsx"] as const;
export const SHEET_ACCEPT = ".csv,.xlsx";
export const MAX_SHEET_BYTES = 5 * 1024 * 1024; // 5MB

export type SheetFormat = (typeof SHEET_EXTENSIONS)[number];

export interface ParsedSheet {
  /** Header labels in original order. */
  headers: string[];
  /** Data rows, each padded/truncated to headers.length. */
  rows: string[][];
  /** Index into `headers` of the detected email column. */
  emailIndex: number;
}

export class SheetError extends Error {}

/** Header names that identify the email column, checked before any heuristic. */
const EMAIL_HEADERS = new Set([
  "email", "e-mail", "email address", "e-mail address", "emailaddress",
  "email id", "emailid", "email_id", "mail", "mail id", "primary email",
  "work email", "business email", "contact email", "email1",
]);

export function sheetFormatOf(fileName: string): SheetFormat | null {
  const dot = fileName.lastIndexOf(".");
  const ext = dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
  return (SHEET_EXTENSIONS as readonly string[]).includes(ext)
    ? (ext as SheetFormat)
    : null;
}

/**
 * Finds the email column.
 *
 * A named header wins outright. Failing that, the column whose values most
 * often look like addresses is chosen — that handles the export that labels
 * the column "Contact" or leaves it blank, without guessing at a column that
 * merely happens to contain one stray @.
 */
export function findEmailColumn(headers: string[], rows: string[][]): number {
  const named = headers.findIndex((h) => EMAIL_HEADERS.has(h.trim().toLowerCase()));
  if (named !== -1) return named;

  const loose = headers.findIndex((h) => /\be-?mail\b/i.test(h));
  if (loose !== -1) return loose;

  let best = -1;
  let bestHits = 0;
  for (let col = 0; col < headers.length; col++) {
    let hits = 0;
    let filled = 0;
    for (const row of rows) {
      const value = (row[col] ?? "").trim();
      if (!value) continue;
      filled++;
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) hits++;
    }
    // Majority of the populated cells must parse as addresses.
    if (filled > 0 && hits * 2 > filled && hits > bestHits) {
      best = col;
      bestHits = hits;
    }
  }
  return best;
}

function normalizeRows(raw: string[][], width: number): string[][] {
  const rows: string[][] = [];
  for (const row of raw) {
    const padded: string[] = new Array(width);
    for (let i = 0; i < width; i++) padded[i] = (row[i] ?? "").toString();
    // Drop rows that are entirely blank — trailing empties are endemic in
    // exported spreadsheets and would otherwise become "missing email" rows.
    if (padded.some((cell) => cell.trim() !== "")) rows.push(padded);
  }
  return rows;
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    // Hyperlinked email cells arrive as { text, hyperlink } — the visible text
    // is the address; the hyperlink is a mailto: duplicate of it.
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) {
      const result = value.result;
      if (result === null || result === undefined) return "";
      if (result instanceof Date) return result.toISOString();
      if (typeof result === "object") return ""; // CellErrorValue
      return String(result);
    }
  }
  return "";
}

function parseCsv(buf: Buffer): { headers: string[]; rows: string[][] } {
  // header:false keeps the raw grid, so duplicate and blank headers survive.
  const parsed = Papa.parse<string[]>(buf.toString("utf-8"), {
    header: false,
    skipEmptyLines: "greedy",
  });
  const grid = parsed.data.filter(Array.isArray);
  if (grid.length === 0) return { headers: [], rows: [] };
  const headers = grid[0].map((h) => (h ?? "").toString().trim());
  return { headers, rows: normalizeRows(grid.slice(1), headers.length) };
}

async function parseXlsx(buf: Buffer): Promise<{ headers: string[]; rows: string[][] }> {
  const workbook = new ExcelJS.Workbook();
  // exceljs declares its own Buffer type; a Node Buffer works at runtime.
  await workbook.xlsx.load(buf as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const headerRow = sheet.getRow(1);
  const width = Math.max(sheet.columnCount, headerRow.cellCount);
  const headers: string[] = [];
  for (let col = 1; col <= width; col++) {
    headers.push(cellToString(headerRow.getCell(col).value).trim());
  }
  // Trim trailing unnamed columns, which exceljs reports for styled-but-empty
  // cells and which would otherwise show up as blank columns in the output.
  while (headers.length > 0 && headers[headers.length - 1] === "") headers.pop();

  const raw: string[][] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    for (let col = 1; col <= headers.length; col++) {
      cells.push(cellToString(row.getCell(col).value));
    }
    raw.push(cells);
  }
  return { headers, rows: normalizeRows(raw, headers.length) };
}

/**
 * Reads an uploaded sheet.
 *
 * Throws SheetError with a message meant for the user — every failure here is
 * something they can fix by changing the file.
 */
export async function parseSheet(buf: Buffer, fileName: string): Promise<ParsedSheet> {
  const format = sheetFormatOf(fileName);
  if (!format) {
    throw new SheetError("Upload a .csv or .xlsx file.");
  }

  let parsed: { headers: string[]; rows: string[][] };
  try {
    parsed = format === "csv" ? parseCsv(buf) : await parseXlsx(buf);
  } catch {
    throw new SheetError("That file could not be read. Re-save it as .csv or .xlsx and try again.");
  }

  const { headers, rows } = parsed;
  if (headers.length === 0) {
    throw new SheetError("The sheet is empty.");
  }
  if (rows.length === 0) {
    throw new SheetError("The sheet has a header row but no data rows.");
  }
  if (rows.length > MAX_SHEET_ROWS) {
    throw new SheetError(
      `That sheet has ${rows.length.toLocaleString()} rows. A run can check at most ${MAX_SHEET_ROWS} — split the file and run it in parts.`,
    );
  }

  const emailIndex = findEmailColumn(headers, rows);
  if (emailIndex === -1) {
    throw new SheetError(
      'No email column found. Name one column "Email", or make sure a column holds the addresses.',
    );
  }

  return { headers, rows, emailIndex };
}

/** Serializes rows back out in the requested format, headers first. */
export async function buildSheet(
  headers: string[],
  rows: string[][],
  format: SheetFormat,
): Promise<Buffer> {
  if (format === "csv") {
    return Buffer.from(Papa.unparse([headers, ...rows], { newline: "\r\n" }), "utf-8");
  }
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row);
  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** "contacts.xlsx" + "clean" -> "contacts - clean.xlsx" */
export function outputFileName(original: string, suffix: string, format: SheetFormat): string {
  const dot = original.lastIndexOf(".");
  const base = (dot === -1 ? original : original.slice(0, dot)).trim() || "sheet";
  return `${base} - ${suffix}.${format}`;
}
