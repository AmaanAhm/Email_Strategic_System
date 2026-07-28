/**
 * Verification worker.
 *
 * Takes a run's PENDING rows, screens what can be judged offline, then probes
 * the rest one domain at a time. Every row's verdict is written as soon as its
 * domain finishes, which is what makes a run resumable: a worker restart picks
 * up exactly the rows that never got an answer, and re-running a domain that
 * was already answered is impossible.
 */

import type { Job } from "bullmq";
import type { Prisma, VerifyVerdict } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { VerifyJobData } from "@/lib/types";
import {
  correctTypo,
  domainOf,
  normalizeEmail,
  screenOffline,
  type Classification,
} from "@/lib/email-verify";
import { probeDomain } from "@/lib/smtp-probe";

/**
 * Domains probed at once. Deliberately low: each one is a live SMTP
 * conversation with somebody else's mail server, and a burst of parallel
 * connections from one IP is exactly the pattern that gets an IP blocklisted.
 */
const DOMAIN_CONCURRENCY = 3;

type RowRecord = {
  id: string;
  position: number;
  email: string;
  contactId: string | null;
};

export async function verifyProcessor(job: Job<VerifyJobData>): Promise<void> {
  const { runId } = job.data;

  const run = await prisma.verificationRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true, source: true, groupId: true },
  });
  if (!run) {
    console.warn(`[verify] run ${runId} no longer exists, dropping job`);
    return;
  }
  if (run.status === "CANCELLED" || run.status === "COMPLETED") return;

  await prisma.verificationRun.update({
    where: { id: runId },
    data: { status: "RUNNING", startedAt: new Date(), error: null },
  });

  try {
    await processRun(runId);
    // A cancel that landed mid-run must not be overwritten with COMPLETED.
    const final = await prisma.verificationRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    if (final?.status !== "CANCELLED") {
      await prisma.verificationRun.update({
        where: { id: runId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }
  } catch (err) {
    console.error(`[verify] run ${runId} failed:`, err);
    await prisma.verificationRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        error: err instanceof Error ? err.message.slice(0, 500) : "Verification failed",
      },
    });
    throw err;
  }
}

async function processRun(runId: string): Promise<void> {
  const pending = await prisma.verificationRow.findMany({
    where: { runId, verdict: "PENDING" },
    select: { id: true, position: true, email: true, contactId: true },
    orderBy: { position: "asc" },
  });
  if (pending.length === 0) return;

  // Addresses already judged in an earlier pass of this same run still count
  // for duplicate detection, so a resumed run does not re-admit a duplicate.
  const alreadyJudged = await prisma.verificationRow.findMany({
    where: { runId, verdict: { not: "PENDING" } },
    select: { email: true },
  });
  const seen = new Set(alreadyJudged.map((r) => normalizeEmail(r.email)));

  const toProbe = new Map<string, RowRecord[]>(); // domain -> rows
  const probeAddress = new Map<string, string>(); // row id -> corrected address

  for (const row of pending) {
    const normalized = normalizeEmail(row.email);

    if (normalized && seen.has(normalized)) {
      await writeVerdicts([
        [row, { verdict: "UNDELIVERABLE", reason: "DUPLICATE_ROW", detail: "This address appears earlier in the sheet" }],
      ]);
      continue;
    }
    if (normalized) seen.add(normalized);

    const offline = screenOffline(normalized);
    if (offline) {
      await writeVerdicts([[row, offline]]);
      continue;
    }

    // Typo repair happens after screening so the corrected address is what
    // gets probed. It is recorded on the row because the verdict belongs to
    // the corrected address, and that is what the output sheet must carry.
    const { email: probed, corrected } = correctTypo(normalized);
    if (corrected) {
      await prisma.verificationRow.update({
        where: { id: row.id },
        data: { probedEmail: probed },
      });
    }
    probeAddress.set(row.id, probed);
    const domain = domainOf(probed);
    const bucket = toProbe.get(domain);
    if (bucket) bucket.push(row);
    else toProbe.set(domain, [row]);
  }

  await refreshProcessed(runId);

  const domains = [...toProbe.keys()];
  let cursor = 0;
  let cancelled = false;

  const runOne = async (): Promise<void> => {
    for (;;) {
      if (cancelled) return;
      const index = cursor++;
      if (index >= domains.length) return;

      // Checked per domain rather than per row so a cancel takes effect
      // promptly without abandoning a conversation mid-flight.
      if (await isCancelled(runId)) {
        cancelled = true;
        return;
      }

      const domain = domains[index];
      const rows = toProbe.get(domain)!;
      const addresses = rows.map((r) => probeAddress.get(r.id)!);

      let results: Map<string, Classification>;
      try {
        ({ results } = await probeDomain(domain, [...new Set(addresses)]));
      } catch (err) {
        // probeDomain resolves failures into verdicts; this is belt and braces.
        results = new Map();
        console.error(`[verify] probe of ${domain} threw:`, err);
      }

      await writeVerdicts(
        rows.map((row) => {
          const address = probeAddress.get(row.id)!;
          const result = results.get(address) ?? {
            verdict: "RISKY" as const,
            reason: "CONNECTION_FAILED" as const,
            detail: "No answer from the mail server",
          };
          return [row, result] as const;
        }),
      );
      await refreshProcessed(runId);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(DOMAIN_CONCURRENCY, domains.length) }, runOne),
  );
}

async function isCancelled(runId: string): Promise<boolean> {
  const run = await prisma.verificationRun.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  return run?.status === "CANCELLED";
}

/**
 * Persists verdicts and mirrors them onto the contacts they came from.
 *
 * The mirror is advisory: it marks a contact so the UI can offer to remove it.
 * Nothing here deletes a contact — that needs an explicit confirmation from
 * the user, because a RISKY or IP-blocked verdict says nothing definitive.
 */
async function writeVerdicts(
  entries: ReadonlyArray<readonly [RowRecord, Classification]>,
): Promise<void> {
  if (entries.length === 0) return;

  const writes: Prisma.PrismaPromise<unknown>[] = [];
  for (const [row, result] of entries) {
    writes.push(
      prisma.verificationRow.update({
        where: { id: row.id },
        data: {
          verdict: result.verdict as VerifyVerdict,
          reason: result.reason,
          detail: result.detail ?? null,
        },
      }),
    );
    if (row.contactId) {
      writes.push(
        prisma.contact.updateMany({
          where: { id: row.contactId },
          data: {
            verifyVerdict: result.verdict as VerifyVerdict,
            verifyReason: result.reason,
            verifiedAt: new Date(),
          },
        }),
      );
    }
  }
  await prisma.$transaction(writes);
}

/** Recomputed rather than incremented, so it is always right after a resume. */
async function refreshProcessed(runId: string): Promise<void> {
  const processed = await prisma.verificationRow.count({
    where: { runId, verdict: { not: "PENDING" } },
  });
  await prisma.verificationRun.update({
    where: { id: runId },
    data: { processed },
  });
}
