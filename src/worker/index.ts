import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "@/lib/db";
import {
  getBullConnection,
  getEmailQueue,
  getRedisConnection,
  getTickQueue,
  getVerifyQueue,
} from "@/lib/queues";
import {
  EMAIL_QUEUE,
  TICK_QUEUE,
  VERIFY_QUEUE,
  type SendEmailJobData,
  type VerifyJobData,
} from "@/lib/types";
import { sendProcessor } from "./send-email";
import { tickProcessor } from "./tick";
import { verifyProcessor } from "./verify";

const tickWorker = new Worker(TICK_QUEUE, tickProcessor, {
  connection: getBullConnection(),
  concurrency: 1,
});

const emailWorker = new Worker<SendEmailJobData>(EMAIL_QUEUE, sendProcessor, {
  connection: getBullConnection(),
  concurrency: 2,
});

// One run at a time. A run already probes several domains concurrently, and
// two runs at once would double the connection rate from this IP for no gain.
const verifyWorker = new Worker<VerifyJobData>(VERIFY_QUEUE, verifyProcessor, {
  connection: getBullConnection(),
  concurrency: 1,
  // A run can take hours, but the processor only ever awaits I/O, so bullmq
  // keeps renewing the lock and a long run is never mistaken for a dead one.
  // The window is widened a little for headroom, not disabled — recovery after
  // a crash should be prompt, and re-running a run is harmless because it only
  // ever picks up rows still marked PENDING.
  lockDuration: 60_000,
});

tickWorker.on("failed", (job, err) => {
  console.error(`[tick] job ${job?.id ?? "?"} failed:`, err);
});
tickWorker.on("error", (err) => {
  console.error("[tick] worker error:", err);
});
emailWorker.on("failed", (job, err) => {
  console.error(`[email] job ${job?.id ?? "?"} failed:`, err);
});
emailWorker.on("error", (err) => {
  console.error("[email] worker error:", err);
});
verifyWorker.on("failed", (job, err) => {
  console.error(`[verify] job ${job?.id ?? "?"} failed:`, err);
});
verifyWorker.on("error", (err) => {
  console.error("[verify] worker error:", err);
});

/**
 * Re-queues verification runs that were in flight when the worker last died.
 *
 * A safety net independent of bullmq's stalled-job handling: if the process is
 * killed hard enough, or Redis is flushed, the job can vanish while the run
 * still sits at RUNNING in the database. Re-adding it is free — the deterministic
 * job id makes it a no-op when the job is still there, and the processor only
 * picks up rows that never got a verdict.
 */
async function recoverVerificationRuns(): Promise<void> {
  const stranded = await prisma.verificationRun.findMany({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true },
  });
  if (stranded.length === 0) return;

  for (const run of stranded) {
    await getVerifyQueue().add(
      "verify",
      { runId: run.id },
      { jobId: `verify-${run.id}`, attempts: 1, removeOnComplete: 50, removeOnFail: 50 },
    );
  }
  console.log(`[verify] re-queued ${stranded.length} unfinished run(s)`);
}

async function start(): Promise<void> {
  await getTickQueue().upsertJobScheduler(
    "tick-every-minute",
    { every: 60_000 },
    { name: "tick" },
  );
  await recoverVerificationRuns();

  console.log(`[worker] tick worker started on queue "${TICK_QUEUE}"`);
  console.log(`[worker] email worker started on queue "${EMAIL_QUEUE}"`);
  console.log(`[worker] verify worker started on queue "${VERIFY_QUEUE}"`);
  console.log(
    '[worker] job scheduler "tick-every-minute" registered (every 60s)',
  );
}

start().catch((err) => {
  console.error("[worker] failed to start:", err);
  process.exit(1);
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] received ${signal}, shutting down...`);
  await Promise.all([tickWorker.close(), emailWorker.close(), verifyWorker.close()]);
  await Promise.all([
    getTickQueue().close(),
    getEmailQueue().close(),
    getVerifyQueue().close(),
  ]);
  await getRedisConnection().quit();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
