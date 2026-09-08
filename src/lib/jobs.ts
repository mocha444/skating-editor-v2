// Typed surface over the shared SQLite store (scripts/jobs-db.cjs).
// Used only by server routes; wraps the CommonJS module with TypeScript types.

/* eslint-disable @typescript-eslint/no-require-imports */
// eslint-disable-next-line
const store = require("../../scripts/jobs-db.cjs") as JobDb;

export type JobStatus = "pending" | "queued" | "running" | "done" | "error";

export type Job = {
  jobId: string;
  id: string;
  dir: string;
  inPath: string;
  segDir: string;
  status: JobStatus | string;
  stage: string | null;
  percent: number;
  error: string | null;
  started: number | null;
  finished: number | null;
  lastUpdate: number | null;
  threshold: string | null;
  minContour: string | null;
  minMotionFrames: string | null;
  bufferFrames: string | null;
  history: string | null;
  varThreshold: string | null;
  detectShadows: string | null;
  keepSource: string | null;
  originalName: string | null;
  result: unknown;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: number | null;
  createdAt: number;
};

export type RecentEntry = {
  dir: string;
  hash: string;
  originalName: string;
  duration: number;
  uploadedAt: number;
};

export type JobPatch = Partial<
  Pick<
    Job,
    | "stage"
    | "percent"
    | "error"
    | "status"
    | "started"
    | "finished"
    | "originalName"
    | "threshold"
    | "minContour"
    | "minMotionFrames"
    | "bufferFrames"
    | "history"
    | "varThreshold"
    | "detectShadows"
    | "keepSource"
  >
>;

export interface JobDb {
  DATA_DIR: string;
  PROGRESS_DIR: string;
  DB_PATH: string;
  getDb(): unknown;
  createJob(job: Partial<Job>): Job | null;
  getJob(id: string): Job | null;
  dequeueJob(): Job | null;
  setJob(id: string, patch: JobPatch): Job | null;
  completeJob(id: string, result: unknown, finished: number): Job | null;
  failJob(id: string, error: string, opts?: { maxAttempts?: number }): Job | null;
  resetRunningJobs(): void;
  listJobs(): Job[];
  listJobsByDir(dir: string): Job[];
  deleteJob(id: string): void;
  countQueued(): number;
  jobLogPath(id: string): string;
  listRecent(): RecentEntry[];
  addRecent(entry: RecentEntry): void;
  updateRecentDuration(dir: string, duration: number): void;
  removeRecent(dir: string): void;
}

export const db = store as JobDb;
export default store as JobDb;