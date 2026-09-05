import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });

export const videoQueue = new Queue('video-process', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  },
});

const SINGLE_FLIGHT_KEY = 'single-flight-lock';

export async function countActiveJobs(): Promise<number> {
  const counts = await videoQueue.getJobCounts("active", "waiting", "delayed");
  return counts.active + counts.waiting + counts.delayed;
}

export async function tryLockSingleFlight(ttlSeconds = 1800): Promise<boolean> {
  const res = await redis.set(SINGLE_FLIGHT_KEY, String(Date.now()), "EX", ttlSeconds, "NX");
  return res === "OK";
}

export async function releaseSingleFlight(): Promise<void> {
  await redis.del(SINGLE_FLIGHT_KEY);
}
