import { describe, expect, it } from "vitest";
import {
  buildSheet,
  findEmailColumn,
  MAX_SHEET_ROWS,
  outputFileName,
  parseSheet,
  sheetFormatOf,
  SheetError,
} from "./sheet";

const csv = (text: string) => Buffer.from(text, "utf-8");

describe("sheetFormatOf", () => {
  it.each([
    ["contacts.csv", "csv"],
    ["Contacts.XLSX", "xlsx"],
    ["a.b.list.csv", "csv"],
  ])("accepts %s", (name, expected) => {
    expect(sheetFormatOf(name)).toBe(expected);
  });

  it.each(["contacts.ods", "contacts.xls", "contacts", "contacts.pdf"])(
    "rejects %s",
    (name) => {
      // .xls and .ods are refused rather than silently mis-parsed: exceljs
      // reads neither, and pretending otherwise produces an empty sheet.
      expect(sheetFormatOf(name)).toBeNull();
    },
  );
});

describe("findEmailColumn", () => {
  it("prefers an exactly-named header", () => {
    expect(findEmailColumn(["Name", "Email", "Notes"], [["a", "a@b.com", "x"]])).toBe(1);
  });

  it("matches common header aliases", () => {
    expect(findEmailColumn(["Full Name", "E-Mail Address"], [["a", "a@b.com"]])).toBe(1);
  });

  it("falls back to the column that actually holds addresses", () => {
    const headers = ["Col1", "Col2"];
    const rows = [
      ["Amaan", "amaan@icubeswire.com"],
      ["Riya", "riya@icubeswire.com"],
    ];
    expect(findEmailColumn(headers, rows)).toBe(1);
  });

  it("ignores a column with only a stray address", () => {
    const headers = ["Notes", "Person"];
    const rows = [
      ["ping me at a@b.com", "Amaan"],
      ["no address here", "Riya"],
      ["none", "Sana"],
    ];
    // One hit out of three populated cells is not a majority.
    expect(findEmailColumn(headers, rows)).toBe(-1);
  });

  it("returns -1 when nothing looks like an email", () => {
    expect(findEmailColumn(["A", "B"], [["1", "2"]])).toBe(-1);
  });
});

describe("parseSheet — CSV", () => {
  it("keeps every column and the original order", async () => {
    const sheet = await parseSheet(
      csv("Name,Email,Company,Phone\nAmaan,a@x.com,ICubesWire,999\n"),
      "c.csv",
    );
    expect(sheet.headers).toEqual(["Name", "Email", "Company", "Phone"]);
    expect(sheet.rows).toEqual([["Amaan", "a@x.com", "ICubesWire", "999"]]);
    expect(sheet.emailIndex).toBe(1);
  });

  it("preserves duplicate header names as separate columns", async () => {
    // Keying rows by header would collapse these two into one.
    const sheet = await parseSheet(csv("Email,Notes,Notes\na@x.com,one,two\n"), "c.csv");
    expect(sheet.headers).toEqual(["Email", "Notes", "Notes"]);
    expect(sheet.rows[0]).toEqual(["a@x.com", "one", "two"]);
  });

  it("pads short rows to the header width", async () => {
    const sheet = await parseSheet(csv("Name,Email,Company\nAmaan,a@x.com\n"), "c.csv");
    expect(sheet.rows[0]).toEqual(["Amaan", "a@x.com", ""]);
  });

  it("drops fully blank rows", async () => {
    const sheet = await parseSheet(csv("Name,Email\nAmaan,a@x.com\n,\n,\n"), "c.csv");
    expect(sheet.rows).toHaveLength(1);
  });

  it("keeps values containing commas and quotes intact", async () => {
    const sheet = await parseSheet(
      csv('Name,Email,Company\n"Doe, John",a@x.com,"Acme ""Inc"""\n'),
      "c.csv",
    );
    expect(sheet.rows[0]).toEqual(["Doe, John", "a@x.com", 'Acme "Inc"']);
  });

  it("rejects a sheet with no data rows", async () => {
    await expect(parseSheet(csv("Name,Email\n"), "c.csv")).rejects.toThrow(SheetError);
  });

  it("rejects a sheet with no email column", async () => {
    await expect(parseSheet(csv("Name,Phone\nAmaan,999\n"), "c.csv")).rejects.toThrow(
      /No email column/,
    );
  });

  it("rejects an unsupported extension", async () => {
    await expect(parseSheet(csv("Name,Email\na,b@c.com\n"), "c.ods")).rejects.toThrow(
      /\.csv or \.xlsx/,
    );
  });

  it(`accepts exactly ${MAX_SHEET_ROWS} rows`, async () => {
    const body = Array.from({ length: MAX_SHEET_ROWS }, (_, i) => `p${i},p${i}@x.com`).join("\n");
    const sheet = await parseSheet(csv(`Name,Email\n${body}\n`), "c.csv");
    expect(sheet.rows).toHaveLength(MAX_SHEET_ROWS);
  });

  it(`rejects ${MAX_SHEET_ROWS + 1} rows and says how many it found`, async () => {
    const body = Array.from({ length: MAX_SHEET_ROWS + 1 }, (_, i) => `p${i},p${i}@x.com`).join("\n");
    await expect(parseSheet(csv(`Name,Email\n${body}\n`), "c.csv")).rejects.toThrow(
      new RegExp(`${MAX_SHEET_ROWS + 1}`),
    );
  });
});

describe("round trip", () => {
  it("survives xlsx write then read with all columns intact", async () => {
    const headers = ["Name", "Email", "Company", "Website", "Notes"];
    const rows = [
      ["Amaan", "amaan@icubeswire.com", "ICubesWire", "icubeswire.com", "hi, there"],
      ["Riya", "riya@example.org", "Example", "", ""],
    ];
    const buf = await buildSheet(headers, rows, "xlsx");
    const back = await parseSheet(buf, "out.xlsx");
    expect(back.headers).toEqual(headers);
    expect(back.rows).toEqual(rows);
    expect(back.emailIndex).toBe(1);
  });

  it("survives csv write then read", async () => {
    const headers = ["Email", "Company"];
    const rows = [["a@x.com", 'Acme, "Inc"']];
    const buf = await buildSheet(headers, rows, "csv");
    const back = await parseSheet(buf, "out.csv");
    expect(back.rows).toEqual(rows);
  });

  it("writes a header row even when there are no data rows", async () => {
    const buf = await buildSheet(["Name", "Email"], [], "csv");
    expect(buf.toString("utf-8").trim()).toBe("Name,Email");
  });
});

describe("outputFileName", () => {
  it.each([
    ["contacts.xlsx", "clean", "xlsx", "contacts - clean.xlsx"],
    ["contacts.csv", "risky", "csv", "contacts - risky.csv"],
    ["my.list.v2.xlsx", "clean", "xlsx", "my.list.v2 - clean.xlsx"],
    ["noext", "clean", "csv", "noext - clean.csv"],
  ])("%s -> %s", (original, suffix, format, expected) => {
    expect(outputFileName(original, suffix, format as "csv" | "xlsx")).toBe(expected);
  });
});
