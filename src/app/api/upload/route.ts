import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from "fs";
import { mkdir, open, readdir, readFile } from "fs/promises";
import path from "path";
import { UPLOADS_DIR, newJobId } from "@/lib/storage";
import { db } from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 1800;
export const dynamic = "force-dynamic";

const SIG_BYTES = 1024 * 1024; // must match client-hash.ts (1 MiB)
const SESSIONS_DIR = path.join(UPLOADS_DIR, ".upload-sessions");

// ---- chunked/resumable upload session state (persisted so reloads resume) ----
type SessionMeta = {
  uploadId: string;
  chunkCount: number;
  fileSize: number;
  fileName: string;
  totalBytes: number; // bytes of fully-received chunks
};

const sessionFile = (uploadId: string) => path.join(SESSIONS_DIR, uploadId, "manifest.json");
const chunkFile = (uploadId: string, index: number) => path.join(SESSIONS_DIR, uploadId, "chunks", String(index));

async function readSession(uploadId: string): Promise<SessionMeta | null> {
  try {
    const m: SessionMeta = JSON.parse(await readFile(sessionFile(uploadId), "utf8"));
    return m;
  } catch {
    return null;
  }
}

async function writeSession(m: SessionMeta) {
  await mkdir(path.dirname(sessionFile(m.uploadId)), { recursive: true });
  await writeFileSync(path.join(SESSIONS_DIR, m.uploadId, "manifest.json"), JSON.stringify(m));
}

async function completedChunks(uploadId: string, chunkCount: number): Promise<number[]> {
  const base = path.join(SESSIONS_DIR, uploadId, "chunks");
  const done: number[] = [];
  try {
    for (const name of await readdir(base)) {
      const idx = Number(name);
      if (idx >= 0 && idx < chunkCount) done.push(idx);
    }
  } catch {}
  return done.sort((a, b) => a - b);
}

function totalBytesFor(fileSize: number, chunkCount: number, done: number[]): number {
  const CHUNK = 8 * 1024 * 1024;
  return done.reduce((acc, i) => acc + Math.min(CHUNK, fileSize - i * CHUNK), 0);
}

// ---- dedup + validation (authoritative, hash computed while assembling) ----
async function readRangeMd5(filePath: string, start: number, end: number): Promise<string> {
  const fh = await open(filePath, "r");
  try {
    const len = end - start;
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, start);
    return createHash("md5").update(buf).digest("hex");
  } finally {
    await fh.close();
  }
}

async function computeSig(filePath: string, size: number) {
  if (size <= SIG_BYTES) {
    const whole = await readRangeMd5(filePath, 0, size);
    return { size, head: whole, tail: whole };
  }
  const head = await readRangeMd5(filePath, 0, SIG_BYTES);
  const tail = await readRangeMd5(filePath, size - SIG_BYTES, size);
  return { size, head, tail };
}

async function findDuplicateHash(hashHex: string, excludeId: string): Promise<string | null> {
  const entries = await readdir(UPLOADS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("skate-")) continue;
    if (entry.name === `skate-${excludeId}`) continue;
    try {
      const stored = (await readFile(path.join(UPLOADS_DIR, entry.name, "hash.md5"), "utf8")).trim();
      if (stored === hashHex) return entry.name;
    } catch {}
  }
  return null;
}

function settingsFrom(headers: Headers): Record<string, string> {
  return {
    threshold: headers.get("x-threshold") || "0.003",
    minContour: headers.get("x-min-contour") || "50",
    minMotionFrames: headers.get("x-min-motion-frames") || "8",
    bufferFrames: headers.get("x-buffer-frames") || "60",
    history: headers.get("x-history") || "300",
    varThreshold: headers.get("x-var-threshold") || "25",
    detectShadows: headers.get("x-detect-shadows") || "false",
  };
}

/** Assemble received chunks into input.mp4, hashing in a single streaming pass. */
async function assembleAndHash(uploadId: string, meta: SessionMeta, inPath: string): Promise<string> {
  const hash = createHash("md5");
  const out = createWriteStream(inPath);
  await new Promise<void>((res, rej) => {
    out.on("error", rej);
    out.on("finish", () => res());
    (async () => {
      try {
        for (let i = 0; i < meta.chunkCount; i++) {
          const probe = chunkFile(uploadId, i);
          const data: Buffer = await readFile(probe);
          hash.update(data);
          if (!out.write(data)) await new Promise<void>((r) => out.once("drain", r));
        }
        out.end();
      } catch (e) {
        rej(e instanceof Error ? e : new Error(String(e)));
      }
    })();
  });
  return hash.digest("hex");
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const uploadId = searchParams.get("uploadId") || "";
  if (!uploadId || uploadId.includes("..") || uploadId.includes("/")) {
    return NextResponse.json({ error: "bad uploadId" }, { status: 400 });
  }
  const meta = await readSession(uploadId);
  if (!meta) return NextResponse.json({ newSession: true, completed: [], chunkCount: 0, fileSize: 0 });
  const done = await completedChunks(uploadId, meta.chunkCount);
  return NextResponse.json({
    uploadId, chunkCount: meta.chunkCount, fileSize: meta.fileSize, fileName: meta.fileName,
    completed: done, totalBytes: totalBytesFor(meta.fileSize, meta.chunkCount, done),
  });
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const op = url.searchParams.get("op") || "";

  // ---- chunk upload ----
  if (op === "chunk") {
    const uploadId = req.headers.get("x-upload-id") || "";
    const index = Number(req.headers.get("x-chunk-index"));
    const chunkCount = Number(req.headers.get("x-chunk-count"));
    const fileSize = Number(req.headers.get("x-file-size"));
    const fileName = req.headers.get("x-file-name") || "video.mp4";
    if (!uploadId || uploadId.includes("..") || uploadId.includes("/") || !Number.isInteger(index)) {
      return NextResponse.json({ error: "bad chunk request" }, { status: 400 });
    }

    const form = await req.formData();
    const chunk = form.get("chunk") as Blob | null;
    if (!chunk) return NextResponse.json({ error: "no chunk" }, { status: 400 });

    mkdirSync(path.dirname(chunkFile(uploadId, index)), { recursive: true });
    const buf = Buffer.from(await chunk.arrayBuffer());
    writeFileSync(chunkFile(uploadId, index), buf);

    const meta: SessionMeta = { uploadId, chunkCount, fileSize, fileName, totalBytes: 0 };
    await writeSession(meta);
    const done = await completedChunks(uploadId, chunkCount);
    const totalBytes = totalBytesFor(fileSize, chunkCount, done);
    return NextResponse.json({ ok: true, index, received: done.length, chunkCount, totalBytes });
  }

  // ---- finalize: assemble, dedupe, validate, enqueue ----
  if (op === "finalize") {
    const uploadId = req.headers.get("x-upload-id") || "";
    const fileName = req.headers.get("x-file-name") || "video.mp4";
    if (!uploadId || uploadId.includes("..") || uploadId.includes("/")) {
      return NextResponse.json({ error: "bad uploadId" }, { status: 400 });
    }
    const meta = await readSession(uploadId);
    if (!meta) return NextResponse.json({ error: "no upload session" }, { status: 400 });

    const done = await completedChunks(uploadId, meta.chunkCount);
    if (done.length !== meta.chunkCount) {
      return NextResponse.json({ error: `incomplete upload: ${done.length}/${meta.chunkCount}` }, { status: 400 });
    }

    const chunkId = newJobId();
    const dir = path.join(UPLOADS_DIR, `skate-${chunkId}`);
    const inPath = path.join(dir, "input.mp4");
    mkdirSync(dir, { recursive: true });
    mkdirSync(path.join(dir, "segments"), { recursive: true });

    // Stream chunks -> input.mp4 while computing full MD5 in a single pass.
    let hashHex = "";
    try {
      hashHex = await assembleAndHash(uploadId, meta, inPath);
    } catch (e) {
      rmSync(dir, { recursive: true, force: true });
      return NextResponse.json({ error: (e instanceof Error ? e.message : "assemble failed") }, { status: 400 });
    }

    // Authoritative dedupe — discard the upload if an identical file exists.
    try {
      const existing = await findDuplicateHash(hashHex, chunkId);
      if (existing) {
        rmSync(dir, { recursive: true, force: true });
        return NextResponse.json({ ok: false, duplicate: true, existingDir: existing });
      }
    } catch {}

    writeFileSync(path.join(dir, "hash.md5"), hashHex, "utf8");
    writeFileSync(path.join(dir, "sig.json"), JSON.stringify(await computeSig(inPath, meta.fileSize)));

    // Corrupt-video guard.
    try {
      await new Promise<void>((res, rej) => {
        const p = spawn("ffmpeg", ["-v", "quiet", "-i", inPath, "-t", "0.1", "-f", "null", "-"]);
        p.on("close", (c) => (c === 0 ? res() : rej(new Error("invalid"))));
      });
    } catch {
      rmSync(dir, { recursive: true, force: true });
      return NextResponse.json({ error: "corrupt video file" }, { status: 400 });
    }

    const s = settingsFrom(req.headers);
    db.createJob({
      id: chunkId, dir: `skate-${chunkId}`, inPath,
      segDir: path.join(dir, "segments"), status: "pending", stage: "queued", percent: 5,
      started: Date.now(), originalName: fileName,
      threshold: s.threshold, minContour: s.minContour, minMotionFrames: s.minMotionFrames,
      bufferFrames: s.bufferFrames, history: s.history, varThreshold: s.varThreshold,
      detectShadows: s.detectShadows,
    });

    db.addRecent({
      dir: `skate-${chunkId}`, hash: hashHex, originalName: fileName, duration: 0, uploadedAt: Date.now(),
    });

    // Clean up the temp session.
    rmSync(path.join(SESSIONS_DIR, uploadId), { recursive: true, force: true });

    return NextResponse.json({ ok: true, jobId: chunkId, dir: `skate-${chunkId}`, complete: true, hash: hashHex });
  }

  return NextResponse.json({ error: "unknown op" }, { status: 400 });
}