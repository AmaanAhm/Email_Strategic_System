import "dotenv/config";
import { Worker } from "bullmq";
import {
  getBullConnection,
  getEmailQueue,
  getRedisConnection,
  getTickQueue,
} from "@/lib/queues";
import { EMAIL_QUEUE, TICK_QUEUE, type SendEmailJobData } from "@/lib/types";
import { sendProcessor } from "./send-email";
import { tickProcessor } from "./tick";

const tickWorker = new Worker(TICK_QUEUE, tickProcessor, {
  connection: getBullConnection(),
  concurrency: 1,
});

const emailWorker = new Worker<SendEmailJobData>(EMAIL_QUEUE, sendProcessor, {
  connection: getBullConnection(),
  concurrency: 2,
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

async function start(): Promise<void> {
  await getTickQueue().upsertJobScheduler(
    "tick-every-minute",
    { every: 60_000 },
    { name: "tick" },
  );

  console.log(`[worker] tick worker started on queue "${TICK_QUEUE}"`);
  console.log(`[worker] email worker started on queue "${EMAIL_QUEUE}"`);
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
  await Promise.all([tickWorker.close(), emailWorker.close()]);
  await Promise.all([getTickQueue().close(), getEmailQueue().close()]);
  await getRedisConnection().quit();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
