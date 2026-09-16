// @ts-check
// Integration tests for the SQLite-backed job queue.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "skate-jobs-"));
process.env.DATA_DIR = TMP;

const store = require("../scripts/jobs-db.cjs");

beforeEach(() => {
  store.getDb().exec("DELETE FROM jobs");
});

function makeJob(id, over = {}) {
  return {
    id, dir: `skate-${id}`, inPath: path.join(TMP, `skate-${id}`, "input.mp4"),
    segDir: path.join(TMP, `skate-${id}`, "segments"),
    status: "pending", stage: "queued", percent: 5,
    started: Date.now(), originalName: "test.mp4",
    threshold: "0.003", minContour: "50", minMotionFrames: "8", bufferFrames: "60",
    history: "300", varThreshold: "25", detectShadows: "false",
    ...over,
  };
}

test("createJob then getJob round-trips settings", () => {
  store.createJob(makeJob("a1"));
  const j = store.getJob("a1");
  assert.ok(j);
  assert.equal(j.status, "pending");
  assert.equal(j.minMotionFrames, "8");
  assert.equal(j.jobId, "a1");
  assert.equal(j.inPath, makeJob("a1").inPath);
});

test("dequeueJob claims each job exactly once (no double-processing)", () => {
  store.createJob(makeJob("b1"));
  store.createJob(makeJob("b2"));
  store.createJob(makeJob("b3"));
  const claimed = [store.dequeueJob(), store.dequeueJob(), store.dequeueJob()]
    .filter(Boolean)
    .map((j) => j.id);
  assert.equal(new Set(claimed).size, claimed.length, "claim produced duplicate ids");
  assert.equal(claimed.length, 3);
  // All three should now be 'running'.
  for (const id of ["b1", "b2", "b3"]) assert.equal(store.getJob(id).status, "running");
  // Queue is now empty.
  assert.equal(store.dequeueJob(), null);
});

test("completeJob marks done with result", () => {
  store.createJob(makeJob("c1"));
  const claimed = store.dequeueJob();
  const result = { ok: true, jobId: "c1", segments: 4, duration: 36.2 };
  store.completeJob(claimed.id, result, Date.now());
  const done = store.getJob("c1");
  assert.equal(done.status, "done");
  assert.deepEqual(done.result, result);
});

test("failJob retries with backoff, then errors at max_attempts", () => {
  store.createJob(makeJob("d1"));
  assert.equal(store.dequeueJob().id, "d1"); // attempts -> 1
  store.failJob("d1", "boom 1");
  // Backoff set, so it must not be immediately dequeue-able.
  assert.equal(store.getJob("d1").status, "queued");
  assert.equal(store.dequeueJob(), null, "should honor next_retry_at backoff");

  const advance = () => store.setJob("d1", { next_retry_at: Date.now() - 1 });
  advance();
  store.dequeueJob(); // attempts -> 2
  store.failJob("d1", "boom 2");
  advance();
  store.dequeueJob(); // attempts -> 3 == max
  store.failJob("d1", "final boom");
  const err = store.getJob("d1");
  assert.equal(err.status, "error");
  assert.equal(err.attempts, 3);
  assert.match(err.error, /final/);
});

test("crash recovery: resetRunningJobs requeues stale 'running' jobs", () => {
  store.createJob(makeJob("e1"));
  store.dequeueJob(); // running
  store.resetRunningJobs();
  assert.equal(store.getJob("e1").status, "queued");
});

// Clean up the temp DB after all tests.
test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});
// --- admission guard: one upload/process at a time -------------------------
// The pipeline is automatic (picking a file starts it), so the server must
// refuse a second job while one is in flight rather than queueing it.

test("getActiveJob returns null when nothing is in flight", () => {
  assert.equal(store.getActiveJob(), null);
});

test("getActiveJob reports pending, queued and running jobs", () => {
  for (const status of ["pending", "queued", "running"]) {
    store.getDb().exec("DELETE FROM jobs");
    store.createJob(makeJob(`act-${status}`, { status }));
    const active = store.getActiveJob();
    assert.ok(active, `${status} must count as active`);
    assert.equal(active.id, `act-${status}`);
  }
});

test("getActiveJob ignores finished and failed jobs", () => {
  store.createJob(makeJob("done1", { status: "done" }));
  store.createJob(makeJob("err1", { status: "error" }));
  assert.equal(store.getActiveJob(), null, "finished work must not block a new upload");
});

test("getActiveJob returns the oldest in-flight job when several somehow exist", () => {
  store.createJob(makeJob("first", { status: "queued", createdAt: 1000 }));
  store.createJob(makeJob("second", { status: "queued", createdAt: 2000 }));
  assert.equal(store.getActiveJob().id, "first");
});
