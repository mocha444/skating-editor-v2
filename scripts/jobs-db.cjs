/**
 * Shared SQLite-backed job + recent store.
 *
 * Plain CommonJS so it can be `require`d by BOTH:
 *   - scripts/worker.js (plain node)
 *   - Next.js server routes (src/lib/jobs.ts wraps this with types)
 *
 * Uses Node 24's built-in `node:sqlite` — no native compile, no external dep.
 * A single WAL-mode DB (app.db) on the shared volume gives the app and worker
 * atomic dequeue, transactional writes, and kills the recent.json write race.
 */
"use strict";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const PROGRESS_DIR = path.join(DATA_DIR, "progress");
const DB_PATH = path.join(DATA_DIR, "app.db");

const JOB_LEASE_MS = 5 * 60 * 1000; // a worker blob "running" this long is abandoned

let db = null;

/** Columns updateable via setJob (whitelist to avoid SQL injection). */
const UPDATE_COLS = {
  status: "status",
  stage: "stage",
  percent: "percent",
  error: "error",
  started: "started",
  finished: "finished",
  next_retry_at: "next_retry_at",
  threshold: "threshold",
  minContour: "min_contour",
  minMotionFrames: "min_motion_frames",
  bufferFrames: "buffer_frames",
  history: "history",
  varThreshold: "var_threshold",
  detectShadows: "detect_shadows",
  originalName: "original_name",
};

function getDb() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 10000");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id               TEXT PRIMARY KEY,
      dir              TEXT NOT NULL,
      in_path          TEXT NOT NULL,
      seg_dir          TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'pending',
      stage            TEXT,
      percent          INTEGER NOT NULL DEFAULT 0,
      error            TEXT,
      started          INTEGER,
      finished         INTEGER,
      last_update      INTEGER,
      threshold        TEXT,
      min_contour      TEXT,
      min_motion_frames TEXT,
      buffer_frames    TEXT,
      history          TEXT,
      var_threshold    TEXT,
      detect_shadows   TEXT,
      original_name    TEXT,
      result           TEXT,
      attempts         INTEGER NOT NULL DEFAULT 0,
      max_attempts     INTEGER NOT NULL DEFAULT 3,
      next_retry_at    INTEGER,
      created_at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
    CREATE TABLE IF NOT EXISTS recent (
      dir           TEXT PRIMARY KEY,
      hash          TEXT,
      original_name TEXT,
      duration      REAL NOT NULL DEFAULT 0,
      uploaded_at   INTEGER NOT NULL
    );
  `);
  return db;
}

/** Map a DB row (snake_case) to the camelCase job object the app/worker expect. */
function rowToJob(r) {
  if (!r) return null;
  let result = null;
  try {
    result = r.result ? JSON.parse(r.result) : null;
  } catch {}
  return {
    jobId: r.id,
    id: r.id,
    dir: r.dir,
    inPath: r.in_path,
    segDir: r.seg_dir,
    status: r.status,
    stage: r.stage,
    percent: r.percent,
    error: r.error,
    started: r.started,
    finished: r.finished,
    lastUpdate: r.last_update,
    threshold: r.threshold,
    minContour: r.min_contour,
    minMotionFrames: r.min_motion_frames,
    bufferFrames: r.buffer_frames,
    history: r.history,
    varThreshold: r.var_threshold,
    detectShadows: r.detect_shadows,
    originalName: r.original_name,
    result,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    nextRetryAt: r.next_retry_at,
    createdAt: r.created_at,
  };
}

function createJob(j) {
  const d = getDb();
  const created = j.createdAt !== undefined ? j.createdAt : Date.now();
  d.prepare(`
    INSERT INTO jobs (id, dir, in_path, seg_dir, status, stage, percent, started,
      threshold, min_contour, min_motion_frames, buffer_frames, history, var_threshold,
      detect_shadows, original_name, attempts, max_attempts, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    j.id, j.dir, j.inPath, j.segDir,
    j.status || "pending", j.stage || "queued", j.percent || 5,
    j.started ?? null,
    j.threshold ?? null, j.minContour ?? null, j.minMotionFrames ?? null,
    j.bufferFrames ?? null, j.history ?? null, j.varThreshold ?? null, j.detectShadows ?? null,
    j.originalName ?? null,
    0, j.maxAttempts || 3, created,
  );
  return getJob(j.id);
}

function getJob(id) {
  return rowToJob(getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id));
}

/**
 * Claim the next runnable job atomically. Returns the claimed (now 'running')
 * job, or null. Includes abandoned jobs whose worker died (lease expiry).
 */
function dequeueJob() {
  const d = getDb();
  const now = Date.now();
  d.exec("BEGIN IMMEDIATE");
  let row;
  try {
    row = d.prepare(`
      SELECT * FROM jobs
      WHERE ( status IN ('pending','queued')
              AND (next_retry_at IS NULL OR next_retry_at <= ?) )
         OR ( status = 'running' AND last_update IS NOT NULL AND last_update < ? )
      ORDER BY CASE WHEN status = 'running' THEN 1 ELSE 0 END, created_at ASC
      LIMIT 1
    `).get(now, now - JOB_LEASE_MS);
    if (row) {
      d.prepare(`
        UPDATE jobs SET status='running', stage='detect', percent=30,
          last_update=?, attempts=attempts+1, started=COALESCE(started, ?)
        WHERE id=?
      `).run(now, now, row.id);
      row = d.prepare("SELECT * FROM jobs WHERE id = ?").get(row.id);
    }
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  return row ? rowToJob(row) : null;
}

function setJob(id, patch) {
  const sets = [];
  const params = [];
  for (const [key, col] of Object.entries(UPDATE_COLS)) {
    if (!(key in patch)) continue;
    sets.push(`${col} = ?`);
    params.push(patch[key] === undefined ? null : patch[key]);
  }
  if (!sets.length) return getJob(id);
  sets.push("last_update = ?");
  params.push(Date.now());
  params.push(id);
  getDb().prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getJob(id);
}

function completeJob(id, result, finished) {
  const d = getDb();
  d.prepare(`
    UPDATE jobs SET status='done', stage='done', percent=100, error=NULL,
      result=?, finished=?, last_update=?
    WHERE id=?
  `).run(JSON.stringify(result), finished, Date.now(), id);
  return getJob(id);
}

/** Mark a job failed, applying exponential-backoff retry until max_attempts. */
function failJob(id, error, opts = {}) {
  const d = getDb();
  const row = d.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  if (!row) return null;
  const attempts = row.attempts || 0;
  const max = opts.maxAttempts || row.max_attempts || 3;
  const now = Date.now();
  if (attempts >= max) {
    d.prepare("UPDATE jobs SET status='error', error=?, finished=?, last_update=? WHERE id=?")
      .run(error, now, now, id);
  } else {
    const backoff = Math.min(600000, (2 ** attempts) * 2000); // 2s,4s,8s... capped at 10m
    d.prepare("UPDATE jobs SET status='queued', error=NULL, stage='queued', next_retry_at=?, last_update=? WHERE id=?")
      .run(now + backoff, now, id);
  }
  return getJob(id);
}

/** On worker startup: requeue jobs left 'running' by a crashed worker. */
function resetRunningJobs() {
  getDb().prepare("UPDATE jobs SET status='queued', stage='queued', percent=5, last_update=? WHERE status='running'")
    .run(Date.now());
}

function listJobs() {
  return getDb().prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200").all().map(rowToJob);
}

function deleteJob(id) {
  getDb().prepare("DELETE FROM jobs WHERE id = ?").run(id);
}

function countQueued() {
  const r = getDb().prepare(`
    SELECT COUNT(*) c FROM jobs
    WHERE (status IN ('pending','queued') AND (next_retry_at IS NULL OR next_retry_at <= ?))
       OR (status = 'running' AND last_update < ?)
  `).get(Date.now(), Date.now() - JOB_LEASE_MS);
  return r.c;
}

function jobLogPath(id) {
  return path.join(PROGRESS_DIR, id + ".log");
}

// --- recent (SQLite kills the recent.json read-modify-write race) ---
function listRecent() {
  return getDb().prepare("SELECT * FROM recent ORDER BY uploaded_at DESC LIMIT 30").all().map((r) => ({
    dir: r.dir, hash: r.hash, originalName: r.original_name, duration: r.duration, uploadedAt: r.uploaded_at,
  }));
}
function addRecent(e) {
  getDb().prepare(`
    INSERT INTO recent (dir, hash, original_name, duration, uploaded_at)
    VALUES (?,?,?,?,?)
    ON CONFLICT(dir) DO UPDATE SET
      hash=excluded.hash, original_name=excluded.original_name,
      duration=excluded.duration, uploaded_at=excluded.uploaded_at
  `).run(e.dir, e.hash, e.originalName, e.duration || 0, e.uploadedAt);
}
function updateRecentDuration(dir, duration) {
  getDb().prepare("UPDATE recent SET duration = ? WHERE dir = ?").run(duration, dir);
}
function removeRecent(dir) {
  getDb().prepare("DELETE FROM recent WHERE dir = ?").run(dir);
}

module.exports = {
  DATA_DIR,
  PROGRESS_DIR,
  DB_PATH,
  getDb,
  createJob,
  getJob,
  dequeueJob,
  setJob,
  completeJob,
  failJob,
  resetRunningJobs,
  listJobs,
  deleteJob,
  countQueued,
  jobLogPath,
  listRecent,
  addRecent,
  updateRecentDuration,
  removeRecent,
};