import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
let _redis: IORedis | null = null;

// ── Limits ────────────────────────────────────────────────────────────────
// MAX_CONCURRENT_JOBS: users beyond this get priority 2 (queued).
// BullMQ processes lower priority numbers first, so 1 runs before 2.
export const MAX_CONCURRENT_JOBS = 5;
export const MAX_UPLOAD_BYTES_PER_SECOND = 5 * 1024 * 1024; // 5 MB/s
const UPLOAD_RATE_LIMIT_KEY = (uid: string) => `upload-rate:${uid}`;

function getRedis(): IORedis {
  if (!_redis) {
    _redis = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  }
  return _redis;
}

export const videoQueue = new Queue('video-process', {
  connection: {
    host: redisUrl.split('://')[1]?.split(':')[0] ?? 'localhost',
    port: parseInt(redisUrl.split(':').pop() ?? '6379'),
    lazyConnect: true,
    maxRetriesPerRequest: null,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  },
});

// Per-user byte-rate tracking: 5MB/s rolling window
// Rate key uses client IP from the reverse proxy.
// Rate: 5 * 1024 * 1024 = 5,242,880 bytes/sec (rolling 60s window)
// At limit: 314MB/min per user → prevents server overload
const SINGLE_FLIGHT_KEY = 'single-flight-lock';

export async function getJobPriority(): Promise<number> {
  try {
    const counts = await videoQueue.getJobCounts("active", "waiting", "delayed");
    const total = (counts.active || 0) + (counts.waiting || 0) + (counts.delayed || 0);
    return total < MAX_CONCURRENT_JOBS ? 1 : 2;
  } catch {
    return 1; // fail open: let them in
  }
}

export async function checkByteRateLimit(userId: string): Promise<{ allowed: boolean; resetIn?: number; limit: number }> {
  try {
    const windowMs = 60000; // 1 minute rolling window
    const maxBytes = MAX_UPLOAD_BYTES_PER_SECOND * (windowMs / 1000);
    const key = UPLOAD_RATE_LIMIT_KEY(userId);
    const current = await getRedis().get(key);
    const bytesUsed = current ? parseInt(current) : 0;
    if (bytesUsed > maxBytes) {
      const ttl = await getRedis().ttl(key);
      return { allowed: false, resetIn: ttl > 0 ? ttl : 60, limit: maxBytes };
    }
    return { allowed: true, limit: maxBytes };
  } catch {
    return { allowed: true, limit: MAX_UPLOAD_BYTES_PER_SECOND * 60 };
  }
}

export async function updateByteRateLimit(userId: string, bytes: number): Promise<void> {
  try {
    const key = UPLOAD_RATE_LIMIT_KEY(userId);
    await getRedis().incrby(key, bytes);
    await getRedis().expire(key, 60);
  } catch { /* ignore */ }
}

export async function countActiveJobs(): Promise<number> {
  try {
    const counts = await videoQueue.getJobCounts("active", "waiting", "delayed");
    return (counts.active || 0) + (counts.waiting || 0) + (counts.delayed || 0);
  } catch {
    return 0;
  }
}

export async function tryLockSingleFlight(ttlSeconds = 1800): Promise<boolean> {
  try {
    const res = await getRedis().set(SINGLE_FLIGHT_KEY, String(Date.now()), "EX", ttlSeconds, "NX");
    return res === "OK";
  } catch {
    return false;
  }
}

export async function releaseSingleFlight(): Promise<void> {
  try {
    await getRedis().del(SINGLE_FLIGHT_KEY);
  } catch {
    // ignore
  }
}
