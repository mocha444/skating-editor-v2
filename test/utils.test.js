// @ts-check
const test = require("node:test");
const assert = require("node:assert/strict");
const { fmtBytes, fmtSpeed, appendSettings, DEFAULT_SETTINGS } = require("../src/lib/editor-types.ts");

test("fmtBytes handles small numbers", () => {
  assert.equal(fmtBytes(0), "0 B");
  assert.equal(fmtBytes(512), "512 B");
});

test("fmtBytes handles KB/MB/GB", () => {
  assert.match(fmtBytes(2048), /KB$/);
  assert.match(fmtBytes(5 * 1024 * 1024), /MB$/);
  assert.match(fmtBytes(2 * 1024 * 1024 * 1024), /GB$/);
});

test("fmtBytes returns dash for invalid", () => {
  assert.equal(fmtBytes(NaN), "—");
  assert.equal(fmtBytes(-1), "—");
  assert.equal(fmtBytes(Infinity), "—");
});

test("fmtSpeed returns empty for invalid", () => {
  assert.equal(fmtSpeed(0), "");
  assert.equal(fmtSpeed(NaN), "");
});

test("fmtSpeed formats valid rate", () => {
  assert.match(fmtSpeed(1024 * 1024), /MB\/s$/);
});

test("DEFAULT_SETTINGS has all fields", () => {
  for (const k of ["threshold","minContour","minMotionFrames","bufferFrames","history","varThreshold","detectShadows"]) {
    assert.ok(k in DEFAULT_SETTINGS, `missing ${k}`);
  }
});

test("appendSettings writes all fields", () => {
  const fd = new FormData ?? null;
  if (typeof FormData === "undefined") {
    // Node 18+ has global FormData (undici). Skip if unavailable.
    return;
  }
  const fd2 = new FormData();
  appendSettings(fd2, DEFAULT_SETTINGS);
  for (const k of ["threshold","min-contour","min-motion-frames","buffer-frames","history","var-threshold","detect-shadows"]) {
    assert.ok(fd2.has(k), `missing form field ${k}`);
  }
});
