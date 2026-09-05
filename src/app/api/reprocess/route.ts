import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { mkdir, writeFile, readFile } from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { videoQueue } from "@/lib/bullmq-queue";
import { db } from "@/lib/db";
import { UPLOADS_DIR, RESULTS_DIR, PROGRESS_DIR, newJobId } from "@/lib/storage";

export const runtime = "nodejs";
const PROJECT_ROOT = process.cwd();

function appendLog(id: string, line: string) {
  require("fs").appendFileSync(path.join(PROGRESS_DIR, id + ".log"), line + "\n");
}

function writeMeta(id: string, data: object) {
  require("fs").writeFileSync(path.join(PROGRESS_DIR, id + ".json"), JSON.stringify(data));
}

export async function POST(req: Request) {
  const form = await req.formData();
  const dir = form.get("dir") as string;
  const threshold = form.get("threshold") as string;
  const minContour = form.get("min-contour") as string;
  const minMotionFrames = form.get("min-motion-frames") as string;
  const bufferFrames = form.get("buffer-frames") as string;
  const historyStr = form.get("history") as string;
  const varThreshold = form.get("var-threshold") as string;
  const detectShadows = form.get("detect-shadows") as string;

  if (!dir || dir.includes("..") || dir.includes("/")) {
    return NextResponse.json({ error: "invalid dir" }, { status: 400 });
  }

  const jobId = newJobId();
  const inPath = path.join(UPLOADS_DIR, dir, "input.mp4");
  const segDir = path.join(UPLOADS_DIR, dir, "segments");

  await mkdir(PROGRESS_DIR, { recursive: true });
  await mkdir(segDir, { recursive: true });
  writeMeta(jobId, { jobId, dir, status: "running", started: Date.now(), percent: 5, stage: "starting" });

  // Background processing
  (async () => {
    try {
      // Ensure hash is stored
      const hashPath = path.join(UPLOADS_DIR, dir, "hash.md5");
      let serverHash: string;
      try { serverHash = (await readFile(hashPath, "utf8")).trim(); } catch {
        serverHash = await new Promise<string>((res, rej) => {
          const hash = createHash("md5");
          const s = require("fs").createReadStream(inPath);
          s.on("data", (d: Buffer) => hash.update(d));
          s.on("end", () => res(hash.digest("hex")));
          s.on("error", rej);
        });
        await writeFile(hashPath, serverHash, "utf8");
      }

      appendLog(jobId, `[reprocess] Starting with threshold=${threshold || 0.003} contour=${minContour || 50} frames=${minMotionFrames || 8} buffer=${bufferFrames || 60}`);

      // Detect motion — always from scratch (no proxy skip for detection)
      writeMeta(jobId, { jobId, dir, status: "running", percent: 20, stage: "detect" });
      appendLog(jobId, "[mog2] Starting motion detection...");
      const detectArgs = [path.join(PROJECT_ROOT, "scripts", "process_video.py"), inPath, segDir];
      if (threshold) detectArgs.push("--threshold", threshold);
      if (minContour) detectArgs.push("--min-contour", minContour);
      if (minMotionFrames) detectArgs.push("--min-motion-frames", minMotionFrames);
      if (bufferFrames) detectArgs.push("--buffer-frames", bufferFrames);
      if (historyStr) detectArgs.push("--history", historyStr);
      if (varThreshold) detectArgs.push("--var-threshold", varThreshold);
      if (detectShadows === "true") detectArgs.push("--detect-shadows");

      const detectOut = await new Promise<string>((res, rej) => {
        const p = spawn("python3", detectArgs);
        let out = "", err = "";
        p.stdout.on("data", d => { out += d.toString(); appendLog(jobId, d.toString().trim()); });
        p.stderr.on("data", d => { err += d.toString(); });
        p.on("close", code => code === 0 ? res(out) : rej(new Error(err.slice(-300))));
      });

      const { segments } = JSON.parse(detectOut);
      if (!segments || !segments.length) throw new Error("no motion detected");
      writeMeta(jobId, { jobId, dir, status: "running", percent: 55, stage: "detect_done" });
      appendLog(jobId, `[mog2] Found ${segments.length} segments`);

      // Cut segments
      const segFiles: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        const [s, e] = segments[i];
        if (e - s < 0.5) continue;
        const f = path.join(segDir, `seg-${i}.mp4`);
        writeMeta(jobId, { jobId, dir, status: "running", percent: 55 + Math.round((30 * (i + 1)) / segments.length), stage: "cutting" });
        appendLog(jobId, `[cut] ${i + 1}/${segments.length} ${s.toFixed(2)}s → ${e.toFixed(2)}s`);
        await new Promise<void>((res, rej) => {
          const cut = spawn("ffmpeg", ["-y", "-ss", String(s), "-i", inPath, "-t", String(e - s), "-c", "copy", f]);
          cut.on("close", c => c === 0 ? res() : rej(new Error("ffmpeg cut failed")));
        });
        segFiles.push(f);
      }

      // Concat
      writeMeta(jobId, { jobId, dir, status: "running", percent: 88, stage: "concat" });
      const listPath = path.join(UPLOADS_DIR, dir, "list.txt");
      await writeFile(listPath, segFiles.map(f => `file '${f}'`).join("\n"));
      const finalPath = path.join(RESULTS_DIR, `skating_final_${dir}.mp4`);
      appendLog(jobId, "[concat] Joining segments...");
      await new Promise<void>((res, rej) => {
        const concat = spawn("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", finalPath]);
        concat.on("close", c => c === 0 ? res() : rej(new Error("ffmpeg concat failed")));
      });
      appendLog(jobId, "[done] Final video ready");
      const metaDone2 = JSON.parse(require("fs").readFileSync(path.join(PROGRESS_DIR, jobId + ".json"), "utf8"));
      const elapsedMs2 = (metaDone2.finished || Date.now()) - (metaDone2.started || metaDone2.finished || Date.now());
      const elapsedSec2 = (elapsedMs2 / 1000).toFixed(1);
      appendLog(jobId, `[timing] Total elapsed: ${elapsedSec2}s`);
      writeMeta(jobId, { jobId, dir, status: "done", percent: 100, stage: "done", finished: Date.now(), result: {
        ok: true,
        segments: segments.length,
        duration: segments.reduce((a: number, [s, e]: number[]) => a + (e - s), 0),
        finalUrl: `/results/skating_final_${dir}.mp4`,
        rawSegments: segments,
        segUrls: segFiles.map((f, i) => `/uploads/${dir}/segments/seg-${i}.mp4`),
        hash: serverHash,
      }});
      try {
        const resultObj = {
          ok: true,
          segments: segments.length,
          duration: segments.reduce((a: number, [s, e]: number[]) => a + (e - s), 0),
          finalUrl: `/results/skating_final_${dir}.mp4`,
          rawSegments: segments,
          segUrls: segFiles.map((f, i) => `/uploads/${dir}/segments/seg-${i}.mp4`),
          hash: serverHash,
        };
        await db.query(
          `INSERT INTO jobs (job_id, status, percent, stage, result)
           VALUES ($1, 'done', 100, 'done', $2::jsonb)
           ON CONFLICT (job_id) DO UPDATE SET status = 'done', percent = 100, stage = 'done', result = $2::jsonb, finished_at = NOW()`,
          [jobId, resultObj]
        );
        await db.query(`UPDATE videos SET duration = $1 WHERE dir = $2`, [resultObj.duration, dir]);
      } catch (dbErr: any) {
        console.error('[db] reprocess update error:', dbErr.message);
      }
    } catch (e: any) {
      appendLog(jobId, `[error] ${e.message}`);
      writeMeta(jobId, { jobId, dir, status: "error", error: e.message, finished: Date.now() });
      try {
        await db.query(
          `INSERT INTO jobs (job_id, status, error, finished_at)
           VALUES ($1, 'error', $2, NOW())
           ON CONFLICT (job_id) DO UPDATE SET status = 'error', error = $2, finished_at = NOW()`,
          [jobId, e.message]
        );
      } catch {}
    }
  })();

  await videoQueue.add('video-process', {
    inPath, segDir, id: jobId, dir,
    threshold: threshold || '0.003',
    minContour: minContour || '50',
    minMotionFrames: minMotionFrames || '8',
    bufferFrames: bufferFrames || '60',
    historyStr: historyStr || '300',
    varThreshold: varThreshold || '25',
    detectShadows: detectShadows || 'false',
  }, { jobId });
  try {
    await db.query(
      `INSERT INTO jobs (job_id, status, percent, stage) VALUES ($1, $2, $3, $4)
       ON CONFLICT (job_id) DO UPDATE SET percent = $3, stage = $4`,
      [jobId, 'running', 5, 'starting']
    );
  } catch (dbErr: any) {
    console.error('[db] insert error:', dbErr.message);
  }
  return NextResponse.json({ ok: true, jobId, dir });
}
