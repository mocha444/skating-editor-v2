// @ts-check
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "skate-test-"));

const { newJobId, isSafeSegment, UPLOADS_DIR, RESULTS_DIR, PROGRESS_DIR } = require("../src/lib/storage.ts");

test("newJobId returns 8-char id", () => {
  const id = newJobId();
  assert.match(id, /^[0-9a-f]{8}$/);
});

test("newJobId never returns all-digit id", () => {
  for (let i = 0; i < 200; i++) {
    const id = newJobId();
    assert.ok(!/^\d+$/.test(id), `got all-digit id ${id}`);
  }
});

test("newJobId is unique across 1000 calls", () => {
  const set = new Set();
  for (let i = 0; i < 1000; i++) set.add(newJobId());
  assert.equal(set.size, 1000);
});

test("isSafeSegment rejects path traversal", () => {
  assert.equal(isSafeSegment(".."), false);
  assert.equal(isSafeSegment("a/b"), false);
  assert.equal(isSafeSegment("a\\b"), false);
});

test("isSafeSegment allows plain names", () => {
  assert.equal(isSafeSegment("seg-0.mp4"), true);
  assert.equal(isSafeSegment("input.mp4"), true);
});

test("directory paths are absolute", () => {
  assert.ok(path.isAbsolute(UPLOADS_DIR));
  assert.ok(path.isAbsolute(RESULTS_DIR));
  assert.ok(path.isAbsolute(PROGRESS_DIR));
});
