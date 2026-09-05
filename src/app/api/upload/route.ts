import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import busboy from "busboy";
import { Readable } from "stream";
import { createHash } from "crypto";
import {
  createWriteStream,
  readFileSync,
  writeFileSync,
  appendFileSync,
  rmSync,
  mkdirSync,
  readdirSync,
} from "fs";
import type { ReadableStream as WebReadableStream } from "stream/web";
import type { Dirent } from "fs";
import path from "path";
import { videoQueue, countActiveJobs, tryLockSingleFlight, releaseSingleFlight } from "@/lib/bullmq-queue";
import { db } from "@/lib/db";
import { UPLOADS_DIR, RESULTS_DIR, PROGRESS_DIR, newJobId } from "@/lib/storage";

export const runtime = "nodejs";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function writeProgress(id: string, percent: number, stage: string) {
  const metaPath = path.join(PROGRESS_DIR, id + ".json");
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.percent = percent; meta.stage = stage; meta.lastUpdate = Date.now();
    writeFileSync(metaPath, JSON.stringify(meta));
  } catch { /* ignore */ }
}

function appendLog(id: string, line: string) {
  const logPath = path.join(PROGRESS_DIR, id + ".log");
  appendFileSync(logPath, line + "\n");
}

function wipeAll() {
  rmSync(UPLOADS_DIR, { recursive: true, force: true });
  rmSync(RESULTS_DIR, { recursive: true, force: true });
  rmSync(PROGRESS_DIR, { recursive: true, force: true });
}

function findDuplicateDir(clientHash: string | null): string | null {
  if (!clientHash) return null;
  let entries: Dirent[] = [];
  try { entries = readdirSync(UPLOADS_DIR, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("skate-")) continue;
    try {
      const stored = readFileSync(path.join(UPLOADS_DIR, entry.name, "hash.md5"), "utf8").trim();
      if (stored === clientHash) return entry.name;
    } catch { /* no hash yet */ }
  }
  return null;
}

function cleanupDir(dir: string, id: string) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  try { rmSync(path.join(PROGRESS_DIR, id + ".json"), { force: true }); } catch {}
  try { rmSync(path.join(PROGRESS_DIR, id + ".log"), { force: true }); } catch {}
}

export async function POST(req: NextRequest) {
  if (!(await tryLockSingleFlight())) {
    return NextResponse.json({ ok: false, error: "Another video is already being uploaded or processed. Please wait for it to finish." }, { status: 409 });
  }
  try {
    // Fast-fail while another job is still processing
    if ((await countActiveJobs()) > 0) {
      return NextResponse.json({ ok: false, error: "Another video is already being processed. Please wait for it to finish." }, { status: 409 });
    }

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data")) {
      return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
    }

    const bb = busboy({ headers: { "content-type": contentType } });

    const fields: Record<string, string> = {};
    const id = newJobId();
    let dir = "";
    let inPath = "";
    let segDir = "";
    let metaPath = "";
    let fileSeen = false;
    let prepared = false;
    let duplicateDir: string | null = null;
    const uploadError: { current: Error | null } = { current: null };
    let fileSize = 0;
    let fileName = "";
    let fileWriteDone: Promise<void> = Promise.resolve();
    let serverHash: string | null = null;

    // Duplicate detection resolves on the hash field (client sends it before the video)
    bb.on("field", (name, val) => {
      fields[name] = val;
      if (name === "hash" && !duplicateDir) {
        duplicateDir = findDuplicateDir(val);
      }
    });

    bb.on("file", (name, stream, info) => {
      if (name !== "video") { stream.resume(); return; }
      fileSeen = true;
      fileName = info.filename;
      // Duplicate already known from the hash field → drop the bytes, write nothing
      if (duplicateDir) { stream.resume(); return; }

      if (!prepared) {
        prepared = true;
        dir = path.join(UPLOADS_DIR, `skate-${id}`);
        segDir = path.join(dir, "segments");
        inPath = path.join(dir, "input.mp4");
        metaPath = path.join(PROGRESS_DIR, id + ".json");

        // Single-active-job model: clear all previous files before saving the new upload
        wipeAll();
        mkdirSync(dir, { recursive: true });
        mkdirSync(segDir, { recursive: true });
        mkdirSync(PROGRESS_DIR, { recursive: true });
        writeFileSync(metaPath, JSON.stringify({ jobId: id, dir: `skate-${id}`, status: "running", started: Date.now(), percent: 5, stage: "saving" }));
        console.log(`[upload] received: ${fileName} | target: ${dir}`);
      }

      const hash = createHash("md5");
      const out = createWriteStream(inPath);
      stream.on("data", d => { hash.update(d); fileSize += d.length; });
      fileWriteDone = new Promise<void>((resolve, reject) => {
        out.on("error", reject);
        out.on("finish", () => { serverHash = hash.digest("hex"); resolve(); });
      });
      stream.pipe(out, { end: true });
    });

    bb.on("error", (e: unknown) => {
      uploadError.current = e instanceof Error ? e : new Error(String(e));
    });

    const multipartDone = new Promise<void>((resolve) => {
      bb.on("close", () => resolve());
    });

    const bodyStream = Readable.fromWeb(req.body as unknown as WebReadableStream);
    bodyStream.on("error", () => {});
    bodyStream.pipe(bb);

    await multipartDone;
    await fileWriteDone;

    const uploadFailure = uploadError.current;
    if (uploadFailure) {
      if (prepared) cleanupDir(dir, id);
      return NextResponse.json({ error: "upload failed: " + uploadFailure.message }, { status: 400 });
    }
    if (!fileSeen) {
      if (prepared) cleanupDir(dir, id);
      return NextResponse.json({ error: "no file" }, { status: 400 });
    }
    if (duplicateDir) {
      if (prepared) cleanupDir(dir, id);
      console.log(`[upload] duplicate: ${fileName} matches ${duplicateDir}`);
      return NextResponse.json({ ok: false, duplicate: true, existingDir: duplicateDir });
    }

    console.log(`[upload] stored: ${fmtBytes(fileSize)} | hash: ${serverHash}`);
    writeProgress(id, 15, "upload_complete");
    appendLog(id, `[upload] saved ${fileName} (${fmtBytes(fileSize)})`);

    // Validate with ffmpeg
    try {
      await new Promise<void>((res, rej) => {
        const p = spawn("ffmpeg", ["-v", "quiet", "-i", inPath, "-t", "0.1", "-f", "null", "-"]);
        p.on("close", c => c === 0 ? res() : rej(new Error("invalid")));
      });
    } catch {
      writeFileSync(inPath, "");
      writeProgress(id, 0, "error");
      return NextResponse.json({ error: "corrupt video file" }, { status: 400 });
    }

    // Persist hash for duplicate detection
    try {
      writeFileSync(path.join(dir, "hash.md5"), serverHash || "", "utf8");
    } catch { /* ignore */ }
    appendLog(id, `[hash] ${serverHash}`);
    writeProgress(id, 25, "hash_computed");

    // Submit to BullMQ
    try {
      await videoQueue.add("video-process", {
        inPath, segDir, id, dir: `skate-${id}`,
        threshold: fields["threshold"] || "0.003",
        minContour: fields["min-contour"] || "50",
        minMotionFrames: fields["min-motion-frames"] || "8",
        bufferFrames: fields["buffer-frames"] || "60",
        historyStr: fields["history"] || "300",
        varThreshold: fields["var-threshold"] || "25",
        detectShadows: fields["detect-shadows"] || "false",
      }, { jobId: id });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[upload] queue add error:", msg);
      cleanupDir(dir, id);
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    // Persist to Postgres
    try {
      await db.query(
        `INSERT INTO videos (dir, hash, original_name, file_size) VALUES ($1, $2, $3, $4) ON CONFLICT (dir) DO NOTHING`,
        [`skate-${id}`, serverHash, fileName, fileSize]
      );
      await db.query(
        `INSERT INTO jobs (job_id, status, percent, stage) VALUES ($1, $2, $3, $4) ON CONFLICT (job_id) DO UPDATE SET percent = $3, stage = $4`,
        [id, "running", 25, "hash_computed"]
      );
    } catch (e: unknown) {
      console.error("[db] insert error:", e instanceof Error ? e.message : String(e));
    }

    return NextResponse.json({ ok: true, jobId: id, dir: `skate-${id}` });
  } finally {
    await releaseSingleFlight();
  }
}