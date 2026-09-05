import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redis = new IORedis({ host: 'redis', port: 6379 });
export const videoQueue = new Queue('video-process', { connection: redis });
