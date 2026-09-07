// @ts-check
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const { serveFile } = require("../src/lib/serve-file.ts");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "serve-test-"));
const big = path.join(tmpDir, "big.mp4");
const small = path.join(tmpDir, "small.txt");

// 1 MiB file
fs.writeFileSync(big, Buffer.alloc(1024 * 1024, 0xab));
fs.writeFileSync(small, "hello world");

test("serveFile 404 on missing", async () => {
  const r = await serveFile({ headers: new Map() }, path.join(tmpDir, "nope.mp4"));
  assert.equal(r.status, 404);
});

test("serveFile 404 on directory", async () => {
  const r = await serveFile({ headers: new Map() }, tmpDir);
  assert.equal(r.status, 404);
});

test("serveFile 200 with content-type for mp4", async () => {
  const r = await serveFile({ headers: new Map() }, big);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Content-Type"), "video/mp4");
  assert.equal(Number(r.headers.get("Content-Length")), 1024 * 1024);
  assert.equal(r.headers.get("Accept-Ranges"), "bytes");
  await r.arrayBuffer();
});

test("serveFile 206 for valid range", async () => {
  const req = { headers: new Map([["range", "bytes=0-99"]]) };
  const r = await serveFile(req, big);
  assert.equal(r.status, 206);
  assert.equal(r.headers.get("Content-Length"), "100");
  assert.equal(r.headers.get("Content-Range"), `bytes 0-99/${1024 * 1024}`);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.length, 100);
});

test("serveFile 206 for suffix range (-500)", async () => {
  const req = { headers: new Map([["range", "bytes=-500"]]) };
  const r = await serveFile(req, big);
  assert.equal(r.status, 206);
  assert.equal(r.headers.get("Content-Length"), "500");
  const range = r.headers.get("Content-Range");
  assert.ok(range.startsWith(`bytes ${1024*1024 - 500}-${1024*1024 - 1}/`));
});

test("serveFile 416 for invalid range", async () => {
  const req = { headers: new Map([["range", "bytes=99999999-"]]) };
  const r = await serveFile(req, big);
  assert.equal(r.status, 416);
});

test("serveFile ignores malformed range header (returns 200)", async () => {
  const req = { headers: new Map([["range", "bytes=garbage"]]) };
  const r = await serveFile(req, big);
  assert.equal(r.status, 200);
  await r.arrayBuffer();
});

test("serveFile unknown extension returns octet-stream", async () => {
  const weird = path.join(tmpDir, "x.zzz");
  fs.writeFileSync(weird, "data");
  const r = await serveFile({ headers: new Map() }, weird);
  assert.equal(r.headers.get("Content-Type"), "application/octet-stream");
  await r.arrayBuffer();
});

test("serveFile onFinish callback fires", async () => {
  let called = 0;
  const r = await serveFile({ headers: new Map() }, small, { onFinish: () => called++ });
  await r.arrayBuffer();
  // close event is async; wait a tick
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(called, 1, "onFinish should fire once");
});
