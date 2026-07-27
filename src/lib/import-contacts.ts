import Papa from "papaparse";
import * as ExcelJS from "exceljs";
import type { ContactRow } from "@/lib/types";

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type ContactField = keyof ContactRow;

const HEADER_ALIASES: Record<string, ContactField> = {
  // name
  name: "name",
  "full name": "name",
  "contact name": "name",
  contact: "name",
  // company
  company: "company",
  organization: "company",
  organisation: "company",
  "company name": "company",
  // email
  email: "email",
  "email address": "email",
  "e-mail": "email",
  // website
  website: "website",
  url: "website",
  site: "website",
  web: "website",
  // industry
  industry: "industry",
  sector: "industry",
  category: "industry",
};

type RawRow = Partial<Record<ContactField, string>>;

function canonicalField(header: string): ContactField | undefined {
  return HEADER_ALIASES[header.toLowerCase().trim()];
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("text" in value && typeof value.text === "string") {
      return value.text;
    }
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

function validateRows(raws: RawRow[]): {
  rows: ContactRow[];
  errors: { row: number; message: string }[];
} {
  const rows: ContactRow[] = [];
  const errors: { row: number; message: string }[] = [];
  const seenEmails = new Set<string>();

  raws.forEach((raw, index) => {
    const rowNumber = index + 1; // 1-based; row 1 = first data row
    const name = (raw.name ?? "").trim();
    const company = (raw.company ?? "").trim();
    const email = (raw.email ?? "").trim().toLowerCase();
    const website = (raw.website ?? "").trim();
    const industry = (raw.industry ?? "").trim();

    const missing: string[] = [];
    if (!name) missing.push("name");
    if (!company) missing.push("company");
    if (!email) missing.push("email");
    if (missing.length > 0) {
      errors.push({
        row: rowNumber,
        message: `Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
      });
      return;
    }

    if (!EMAIL_REGEX.test(email)) {
      errors.push({ row: rowNumber, message: `Invalid email address: ${email}` });
      return;
    }

    if (seenEmails.has(email)) {
      errors.push({ row: rowNumber, message: "Duplicate email in file" });
      return;
    }
    seenEmails.add(email);

    const contact: ContactRow = { name, company, email };
    if (website) contact.website = website;
    if (industry) contact.industry = industry;
    rows.push(contact);
  });

  return { rows, errors };
}

function parseCsv(buf: Buffer): RawRow[] {
  const parsed = Papa.parse<Record<string, string>>(buf.toString("utf-8"), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.toLowerCase().trim(),
  });

  return parsed.data.map((record) => {
    const raw: RawRow = {};
    for (const [key, value] of Object.entries(record)) {
      const field = canonicalField(key);
      if (field && raw[field] === undefined && typeof value === "string") {
        raw[field] = value;
      }
    }
    return raw;
  });
}

async function parseExcel(buf: Buffer): Promise<RawRow[]> {
  const workbook = new ExcelJS.Workbook();
  // exceljs typings declare their own `Buffer extends ArrayBuffer`; a Node
  // Buffer works at runtime but needs a cast to satisfy the declared type.
  await workbook.xlsx.load(buf as unknown as ArrayBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  // Row 1 = headers
  const columnFields = new Map<number, ContactField>();
  const usedFields = new Set<ContactField>();
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const field = canonicalField(cellToString(cell.value));
    if (field && !usedFields.has(field)) {
      usedFields.add(field);
      columnFields.set(colNumber, field);
    }
  });

  const raws: RawRow[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const raw: RawRow = {};
    let hasValue = false;
    for (const [colNumber, field] of columnFields) {
      const text = cellToString(row.getCell(colNumber).value);
      raw[field] = text;
      if (text.trim() !== "") hasValue = true;
    }
    if (hasValue) raws.push(raw); // skip fully-empty rows (mirrors skipEmptyLines)
  }
  return raws;
}

export async function parseContactsFile(
  buf: Buffer,
  filename: string
): Promise<{ rows: ContactRow[]; errors: { row: number; message: string }[] }> {
  const extension = filename.includes(".")
    ? (filename.split(".").pop() ?? "").toLowerCase()
    : "";

  let raws: RawRow[];
  if (extension === "csv") {
    raws = parseCsv(buf);
  } else if (extension === "xlsx" || extension === "xls") {
    raws = await parseExcel(buf);
  } else {
    throw new Error("Unsupported file type");
  }

  return validateRows(raws);
}
