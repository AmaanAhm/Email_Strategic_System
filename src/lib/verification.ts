/**
 * Verification runs: creating them, reading their results, and turning those
 * results back into a spreadsheet.
 *
 * Shared by the upload route, the download route, the server actions and the
 * results page so that the definition of "clean" lives in exactly one place.
 */

import type { VerifyVerdict } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getVerifyQueue } from "@/lib/queues";
import { normalizeEmail, REASON_LABELS, type ReasonCode } from "@/lib/email-verify";
import { buildSheet, outputFileName, type ParsedSheet, type SheetFormat } from "@/lib/sheet";

/** Which download a request is asking for. */
export type Bucket = "clean" | "risky";

/**
 * Verdicts that belong in each download.
 *
 * `clean` is exactly DELIVERABLE — a mail server said yes. Nothing else gets
 * in, which is the whole point of the feature.
 */
const BUCKET_VERDICTS: Record<Bucket, VerifyVerdict[]> = {
  clean: ["DELIVERABLE"],
  risky: ["RISKY"],
};

export const BUCKET_LABELS: Record<Bucket, string> = {
  clean: "clean",
  risky: "risky",
};

/** Headers used for runs over an existing contact group, which have no sheet. */
export const GROUP_HEADERS = ["Name", "Company", "Email", "Website", "Industry"] as const;

export function reasonLabel(reason: string | null): string {
  if (!reason) return "";
  return REASON_LABELS[reason as ReasonCode] ?? reason;
}

/** Creates a run from an uploaded sheet and queues it. */
export async function createFileRun(
  userId: string,
  fileName: string,
  sheet: ParsedSheet,
): Promise<string> {
  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.verificationRun.create({
      data: {
        userId,
        source: "FILE",
        fileName,
        headers: sheet.headers,
        emailIndex: sheet.emailIndex,
        total: sheet.rows.length,
      },
      select: { id: true },
    });
    await tx.verificationRow.createMany({
      data: sheet.rows.map((cells, index) => ({
        runId: created.id,
        position: index,
        email: normalizeEmail(cells[sheet.emailIndex] ?? ""),
        cells,
      })),
    });
    return created;
  });

  await enqueue(run.id);
  return run.id;
}

/** Creates a run over an existing contact group and queues it. */
export async function createGroupRun(userId: string, groupId: string): Promise<string> {
  const contacts = await prisma.contact.findMany({
    where: { groupId, userId },
    select: { id: true, name: true, company: true, email: true, website: true, industry: true },
    orderBy: { createdAt: "asc" },
  });
  if (contacts.length === 0) throw new Error("This group has no contacts to check.");

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.verificationRun.create({
      data: {
        userId,
        source: "CONTACT_GROUP",
        groupId,
        headers: [...GROUP_HEADERS],
        emailIndex: GROUP_HEADERS.indexOf("Email"),
        total: contacts.length,
      },
      select: { id: true },
    });
    await tx.verificationRow.createMany({
      data: contacts.map((c, index) => ({
        runId: created.id,
        position: index,
        email: normalizeEmail(c.email),
        contactId: c.id,
        cells: [c.name, c.company, c.email, c.website ?? "", c.industry ?? ""],
      })),
    });
    return created;
  });

  await enqueue(run.id);
  return run.id;
}

/**
 * Deterministic job id so a double-submit or a retry cannot start the same run
 * twice. BullMQ drops an add() for an id it already knows.
 */
async function enqueue(runId: string): Promise<void> {
  await getVerifyQueue().add(
    "verify",
    { runId },
    { jobId: `verify-${runId}`, attempts: 1, removeOnComplete: 50, removeOnFail: 50 },
  );
}

export interface VerdictCounts {
  deliverable: number;
  undeliverable: number;
  risky: number;
  pending: number;
}

export async function countVerdicts(runId: string): Promise<VerdictCounts> {
  const grouped = await prisma.verificationRow.groupBy({
    by: ["verdict"],
    _count: { _all: true },
    where: { runId },
  });
  const of = (verdict: VerifyVerdict) =>
    grouped.find((g) => g.verdict === verdict)?._count._all ?? 0;
  return {
    deliverable: of("DELIVERABLE"),
    undeliverable: of("UNDELIVERABLE"),
    risky: of("RISKY"),
    pending: of("PENDING"),
  };
}

export interface BucketSheet {
  buffer: Buffer;
  fileName: string;
  rowCount: number;
}

/**
 * Rebuilds one bucket as a spreadsheet.
 *
 * Original columns, original order, no verdict column bolted on — the output
 * is the input minus the rows that did not qualify. Reasons live on screen,
 * so the file stays usable as a direct import somewhere else.
 */
export async function buildBucketSheet(
  runId: string,
  bucket: Bucket,
): Promise<BucketSheet | null> {
  const run = await prisma.verificationRun.findUnique({
    where: { id: runId },
    select: { headers: true, fileName: true, source: true, emailIndex: true },
  });
  if (!run) return null;

  const rows = await prisma.verificationRow.findMany({
    where: { runId, verdict: { in: BUCKET_VERDICTS[bucket] } },
    select: { cells: true, probedEmail: true },
    orderBy: { position: "asc" },
  });

  const headers = (run.headers as unknown as string[]) ?? [];
  const cells = rows.map((r) => {
    const row = [...((r.cells as unknown as string[]) ?? [])];
    // A repaired typo is written back into the email cell. The verdict was
    // earned by the corrected address, so shipping the misspelling would put
    // a known-bouncing address into the clean file.
    if (r.probedEmail && run.emailIndex >= 0 && run.emailIndex < row.length) {
      row[run.emailIndex] = r.probedEmail;
    }
    return row;
  });

  // A group run has no uploaded file, so it downloads as .xlsx by default.
  const sourceName = run.fileName ?? "contacts.xlsx";
  const format: SheetFormat = sourceName.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";

  return {
    buffer: await buildSheet(headers, cells, format),
    fileName: outputFileName(sourceName, BUCKET_LABELS[bucket], format),
    rowCount: cells.length,
  };
}
