import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/lib/env";
import { TICK_QUEUE, EMAIL_QUEUE, type SendEmailJobData } from "@/lib/types";

let redisConnection: IORedis | null = null;
let tickQueue: Queue | null = null;
let emailQueue: Queue<SendEmailJobData> | null = null;

export function getRedisConnection(): IORedis {
  if (!redisConnection) {
    redisConnection = new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
    });
  }
  return redisConnection;
}

/**
 * bullmq ships its own nested copy of ioredis whose types are nominally
 * incompatible with the top-level ioredis (protected members), so the
 * shared connection is cast when handed to bullmq.
 */
export function getBullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

export function getTickQueue(): Queue {
  if (!tickQueue) {
    tickQueue = new Queue(TICK_QUEUE, { connection: getBullConnection() });
  }
  return tickQueue;
}

export function getEmailQueue(): Queue<SendEmailJobData> {
  if (!emailQueue) {
    emailQueue = new Queue<SendEmailJobData>(EMAIL_QUEUE, {
      connection: getBullConnection(),
    });
  }
  return emailQueue;
}
