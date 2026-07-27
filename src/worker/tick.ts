import type { JobsOptions } from "bullmq";
import { prisma } from "@/lib/db";
import { getEmailQueue } from "@/lib/queues";
import type { SendEmailJobData } from "@/lib/types";

const SEND_JOB_OPTS: Omit<JobsOptions, "jobId"> = {
  attempts: 4,
  backoff: { type: "exponential", delay: 60_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: 5000,
};

/** States in which a job is still going to run on its own. */
const LIVE_JOB_STATES = new Set(["waiting", "delayed", "active", "paused"]);

/**
 * add() with an existing jobId is a silent no-op and finished jobs keep their
 * key for a while, so a retained job would block a recipient from ever being
 * re-enqueued. Duplicate sends are prevented by the atomic QUEUED -> SENDING
 * claim in the send processor, not by the jobId, so a finished job's id is
 * safe to recycle.
 */
async function enqueueSend(recipientId: string): Promise<void> {
  const jobId = `send-${recipientId}`;
  const queue = getEmailQueue();
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (LIVE_JOB_STATES.has(state)) return;
    await existing.remove();
  }
  const data: SendEmailJobData = { recipientId };
  await queue.add("send", data, { jobId, ...SEND_JOB_OPTS });
}

export async function tickProcessor(): Promise<void> {
  const now = new Date();

  // (a) Flip campaigns whose start time has arrived.
  await prisma.campaign.updateMany({
    where: { status: "SCHEDULED", startAt: { lte: now } },
    data: { status: "RUNNING" },
  });

  // (b) Claim due recipients and enqueue send jobs.
  const due = await prisma.campaignRecipient.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { lte: now },
      campaign: { status: "RUNNING" },
    },
    select: { id: true },
    take: 200,
  });
  for (const { id } of due) {
    const claimed = await prisma.campaignRecipient.updateMany({
      where: { id, status: "SCHEDULED" },
      data: { status: "QUEUED" },
    });
    if (claimed.count === 1) {
      await enqueueSend(id);
    }
  }

  // (c) Crash recovery: re-enqueue QUEUED recipients that have been stuck
  // for over 10 minutes. enqueueSend leaves a still-live job alone.
  const staleCutoff = new Date(Date.now() - 10 * 60_000);
  const stale = await prisma.campaignRecipient.findMany({
    where: {
      status: "QUEUED",
      updatedAt: { lt: staleCutoff },
      campaign: { status: "RUNNING" },
    },
    select: { id: true },
    take: 200,
  });
  for (const { id } of stale) {
    await enqueueSend(id);
  }

  // (d) Complete campaigns with no remaining non-terminal recipients.
  const running = await prisma.campaign.findMany({
    where: { status: "RUNNING" },
    select: { id: true },
  });
  if (running.length > 0) {
    const openCounts = await prisma.campaignRecipient.groupBy({
      by: ["campaignId"],
      where: {
        campaignId: { in: running.map((c) => c.id) },
        status: { in: ["PENDING", "SCHEDULED", "QUEUED", "SENDING"] },
      },
      _count: { _all: true },
    });
    const stillOpen = new Set(openCounts.map((g) => g.campaignId));
    const completedIds = running
      .filter((c) => !stillOpen.has(c.id))
      .map((c) => c.id);
    if (completedIds.length > 0) {
      await prisma.campaign.updateMany({
        where: { id: { in: completedIds }, status: "RUNNING" },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }
  }
}
