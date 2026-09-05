import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { mkdir, writeFile, readFile, readdir, rm } from "fs/promises";
import { createReadStream, writeFileSync, appendFileSync, readFileSync } from "fs";
import path from "path";
import { createHash } from "crypto";
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

async function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("md5");
    const stream = createReadStream(filePath);
    stream.on("data", d => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
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

export async function POST(req: NextRequest) {
  if (!(await tryLockSingleFlight())) {
    return NextResponse.json({ ok: false, error: "Another video is already being uploaded or processed. Please wait for it to finish." }, { status: 409 });
  }
  try {
    const formData = await req.formData();
    const file = formData.get("video") as File | null;
    const clientHash = formData.get("hash") as string | null;
    const threshold = formData.get("threshold") as string | null;
    const minContour = formData.get("min-contour") as string | null;
    const minMotionFrames = formData.get("min-motion-frames") as string | null;
    const bufferFrames = formData.get("buffer-frames") as string | null;
    const historyStr = formData.get("history") as string | null;
    const varThreshold = formData.get("var-threshold") as string | null;
    const detectShadows = formData.get("detect-shadows") as string | null;

    if (!file) return NextResponse.json({ error: "no file" }, { status: 400 });
    console.log(`[upload] received: ${file.name} | size: ${fmtBytes(file.size)} | hash: ${clientHash}`);

    // Only one video may be processed at a time
    if ((await countActiveJobs()) > 0) {
      return NextResponse.json({ ok: false, error: "Another video is already being processed. Please wait for it to finish." }, { status: 409 });
    }

    // Fast duplicate check
    await mkdir(UPLOADS_DIR, { recursive: true });
    const uploadsDir = await readdir(UPLOADS_DIR, { withFileTypes: true });
    if (clientHash) {
      for (const entry of uploadsDir) {
        if (!entry.isDirectory() || !entry.name.startsWith("skate-")) continue;
        try {
          const hashPath = path.join(UPLOADS_DIR, entry.name, "hash.md5");
          const storedHash = (await readFile(hashPath, "utf8")).trim();
          if (storedHash === clientHash) {
            console.log(`[upload] duplicate: ${file.name} matches ${entry.name}`);
            return NextResponse.json({ ok: false, duplicate: true, existingDir: entry.name });
          }
        } catch { /* no hash yet */ }
      }
    }

  const id = newJobId();
    const dir = path.join(UPLOADS_DIR, `skate-${id}`);

  // Single-active-job model: clear all previous files before saving the new upload
  await rm(UPLOADS_DIR, { recursive: true, force: true });
  await rm(RESULTS_DIR, { recursive: true, force: true });
  await rm(PROGRESS_DIR, { recursive: true, force: true });

  const workDir = dir;
  const segDir = path.join(workDir, "segments");
  await mkdir(dir, { recursive: true });
  await mkdir(segDir, { recursive: true });
  await mkdir(PROGRESS_DIR, { recursive: true });
  const inPath = path.join(workDir, "input.mp4");
  const metaPath = path.join(PROGRESS_DIR, id + ".json");
  const logPath = path.join(PROGRESS_DIR, id + ".log");
  writeFileSync(metaPath, JSON.stringify({ jobId: id, dir: `skate-${id}`, status: "running", started: Date.now(), percent: 5, stage: "saving" }));

  // Save file
  await writeFile(inPath, Buffer.from(await file.arrayBuffer()));
  writeProgress(id, 15, "upload_complete");
  appendLog(id, `[upload] saved ${file.name}`);

  // Validate
  try {
    await new Promise<void>((res, rej) => {
      const p = spawn("ffmpeg", ["-v", "quiet", "-i", inPath, "-t", "0.1", "-f", "null", "-"]);
      p.on("close", c => c === 0 ? res() : rej(new Error("invalid")));
    });
  } catch {
    await writeFile(inPath, "").catch(() => {});
    writeProgress(id, 0, "error");
    return NextResponse.json({ error: "corrupt video file" }, { status: 400 });
  }

  writeProgress(id, 25, "hash_computing");
  const serverHash = await computeFileHash(inPath);
  await writeFile(path.join(workDir, "hash.md5"), serverHash, "utf8");
  appendLog(id, `[hash] ${serverHash}`);

  // Submit to BullMQ
  try {
    await videoQueue.add("video-process", {
      inPath, segDir, id, dir: `skate-${id}`,
      threshold: threshold || "0.003",
      minContour: minContour || "50",
      minMotionFrames: minMotionFrames || "8",
      bufferFrames: bufferFrames || "60",
      historyStr: historyStr || "300",
      varThreshold: varThreshold || "25",
      detectShadows: detectShadows || "false",
    }, { jobId: id });
  } catch (e: any) {
    console.error("[upload] queue add error:", e.message);
    await rm(dir, { recursive: true, force: true });
    await rm(path.join(PROGRESS_DIR, id + ".json"), { force: true });
    await rm(path.join(PROGRESS_DIR, id + ".log"), { force: true });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  // Persist to Postgres
  try {
    await db.query(
      `INSERT INTO videos (dir, hash, original_name, file_size) VALUES ($1, $2, $3, $4) ON CONFLICT (dir) DO NOTHING`,
      [`skate-${id}`, serverHash, file.name, file.size]
    );
    await db.query(
      `INSERT INTO jobs (job_id, status, percent, stage) VALUES ($1, $2, $3, $4) ON CONFLICT (job_id) DO UPDATE SET percent = $3, stage = $4`,
      [id, "running", 25, "hash_computed"]
    );
  } catch (e: any) {
    console.error("[db] insert error:", e.message);
  }

  return NextResponse.json({ ok: true, jobId: id, dir: `skate-${id}` });
  } finally {
    await releaseSingleFlight();
  }
}
