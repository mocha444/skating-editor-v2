// @ts-check
// Integration tests for the SQLite-backed job queue + recent store.
// These are the pieces that replaced the file-based progress/recent.json store:
// atomic dequeue, crash-recovery, retry/backoff, and race-free recent writes.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "skate-jobs-"));
process.env.DATA_DIR = TMP;

const store = require("../scripts/jobs-db.cjs");

// Isolate every test: start from an empty queue + recent list.
beforeEach(() => {
  store.getDb().exec("DELETE FROM jobs");
  store.getDb().exec("DELETE FROM recent");
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

test("recent: add/update/remove and no duplicate dirs", () => {
  store.addRecent({ dir: "skate-x", hash: "aa", originalName: "a.mp4", duration: 0, uploadedAt: 1000 });
  store.addRecent({ dir: "skate-x", hash: "aa", originalName: "a.mp4", duration: 0, uploadedAt: 1000 });
  assert.equal(store.listRecent().length, 1, "re-add same dir must not duplicate");
  store.updateRecentDuration("skate-x", 42.5);
  assert.equal(store.listRecent().find((e) => e.dir === "skate-x").duration, 42.5);
  store.removeRecent("skate-x");
  assert.equal(store.listRecent().length, 0);
});

test("recent ordering is newest-first", () => {
  store.addRecent({ dir: "skate-1", hash: "1", originalName: "1.mp4", duration: 0, uploadedAt: 100 });
  store.addRecent({ dir: "skate-2", hash: "2", originalName: "2.mp4", duration: 0, uploadedAt: 200 });
  const ids = store.listRecent().map((e) => e.dir);
  assert.deepEqual(ids, ["skate-2", "skate-1"]);
});

// Clean up the temp DB after all tests.
test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});