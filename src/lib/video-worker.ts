import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import path from 'path';
import { RESULTS_DIR, PROGRESS_DIR } from './storage';
import { db } from './db';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });

function writeProgress(id: string, percent: number, stage: string) {
  const metaPath = path.join(PROGRESS_DIR, id + ".json");
  try {
    const meta = JSON.parse(require("fs").readFileSync(metaPath, "utf8"));
    meta.percent = percent; meta.stage = stage; meta.lastUpdate = Date.now();
    require("fs").writeFileSync(metaPath, JSON.stringify(meta));
  } catch {}
}

function appendLog(id: string, line: string) {
  const logPath = path.join(PROGRESS_DIR, id + ".log");
  require("fs").appendFileSync(logPath, line + "\n");
}

mkdirSync(PROGRESS_DIR, { recursive: true });
mkdirSync(RESULTS_DIR, { recursive: true });

const PROJECT_ROOT = process.cwd();

const worker = new Worker('video-process', async (job: Job) => {
  const { inPath, id, segDir, threshold, minContour, minMotionFrames, bufferFrames, historyStr, varThreshold, detectShadows } = job.data;

  mkdirSync(PROGRESS_DIR, { recursive: true });
  mkdirSync(RESULTS_DIR, { recursive: true });

  writeProgress(id, 30, "detect");
  appendLog(id, "[mog2] starting motion detection...");

  const detectArgs = [path.join(PROJECT_ROOT, "scripts", "process_video.py"), inPath, segDir];
  detectArgs.push("--threshold", threshold || "0.003");
  detectArgs.push("--min-contour", minContour || "50");
  detectArgs.push("--min-motion-frames", minMotionFrames || "8");
  detectArgs.push("--buffer-frames", bufferFrames || "60");
  detectArgs.push("--history", historyStr || "300");
  detectArgs.push("--var-threshold", varThreshold || "25");
  detectArgs.push("--max-fps", "30");
  if (detectShadows === "true") detectArgs.push("--detect-shadows");

  let detectOutRaw = "", detectErr = "";
  const segments = await new Promise<number[][]>((resolve, reject) => {
    const p = spawn("python3", detectArgs);
    p.stdout.on("data", d => detectOutRaw += d.toString());
    p.stderr.on("data", d => { detectErr += d.toString(); appendLog(id, `[mog2] ${d.toString().trim()}`); });
    p.on("close", code => {
      try {
        const parsed = JSON.parse(detectOutRaw);
        resolve(parsed.segments);
      } catch {
        reject(new Error("Failed to parse Python output: " + detectErr.slice(-300)));
      }
    });
  });

  if (!segments.length) throw new Error("no motion detected");
  writeProgress(id, 60, "detect_done");
  appendLog(id, `[mog2] Found ${segments.length} segments`);

  const segFiles: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const [s, e] = segments[i];
    if (e - s < 0.5) continue;
    writeProgress(id, 60 + Math.round((20 * (i + 1)) / segments.length), "cutting");
    const f = path.join(segDir, `seg-${i}.mp4`);
    appendLog(id, `[cut] ${i + 1}/${segments.length} ${s.toFixed(2)}s → ${e.toFixed(2)}s`);

    // Trim with re-encoding to ensure frame-accurate cuts and audio sync.
    // -ss BEFORE -i = fast seek (keyframe-aligned input, then re-encode from there)
    // -vaapi_device + -hwaccel vaapi = GPU-accelerated decode when available
    // -c:v h264_vaapi for encode = offload H.264 encode to iGPU (saves CPU)
    await new Promise((res, rej) => {
      const cut = spawn("ffmpeg", [
        "-y",
        "-hwaccel", "vaapi",
        "-hwaccel_device", "/dev/dri/renderD128",
        "-hwaccel_output_format", "vaapi",
        "-ss", String(s),
        "-i", inPath,
        "-t", String(e - s),
        "-c:v", "h264_vaapi",
        "-preset", "ultrafast",
        "-crf", "18",
        "-threads", "1",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        f,
      ]);
      let err = "";
      cut.stderr.on("data", d => { err += d.toString(); });
      cut.on("close", c => {
        if (c === 0) res(true);
        else {
          appendLog(id, `[cut] ffmpeg error: ${err.slice(-300)}`);
          rej(new Error("ffmpeg cut failed: " + err.slice(-200)));
        }
      });
    });
    segFiles.push(f);
  }

  writeProgress(id, 90, "concat");
  const listPath = path.join(path.dirname(segDir), "list.txt");
  await writeFile(listPath, segFiles.map(f => `file '${f}'`).join("\n"));
  const finalPath = path.join(RESULTS_DIR, `skating_final_${id}.mp4`);
  // Concat re-encode uses libx264 (segments may have different GOPs from vaapi cuts)
  await new Promise((res, rej) => {
    const concat = spawn("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "18",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      finalPath,
    ]);
    let err = "";
    concat.stderr.on("data", d => { err += d.toString(); });
    concat.on("close", c => {
      if (c === 0) res(true);
      else {
        appendLog(id, `[concat] ffmpeg error: ${err.slice(-300)}`);
        rej(new Error("ffmpeg concat failed: " + err.slice(-200)));
      }
    });
  });
  appendLog(id, "[concat] Done!");
  writeProgress(id, 100, "done");

  const result = {
    ok: true,
    jobId: id,
    segments: segments.length,
    duration: segments.reduce((a, [s, e]) => a + (e - s), 0),
    finalUrl: `/results/skating_final_${id}.mp4`,
    rawSegments: segments,
    segUrls: segFiles.map((f, i) => `/uploads/skate-${id}/segments/seg-${i}.mp4`),
  };
  const metaPath = path.join(PROGRESS_DIR, id + ".json");
  const meta = JSON.parse(require("fs").readFileSync(metaPath, "utf8"));
  meta.status = "done"; meta.result = result; meta.finished = Date.now();
  require("fs").writeFileSync(metaPath, JSON.stringify(meta));
  appendLog(id, "[done] Final video ready");
  const elapsedMs = (meta.finished || Date.now()) - (meta.started || meta.finished || Date.now());
  appendLog(id, `[timing] Total elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);

  try {
    await db.query(
      `INSERT INTO jobs (job_id, status, percent, stage, result)
       VALUES ($1, 'done', 100, 'done', $2::jsonb)
       ON CONFLICT (job_id) DO UPDATE SET status = 'done', percent = 100, stage = 'done', result = $2::jsonb, finished_at = NOW()`,
      [id, result]
    );
    await db.query(
      `UPDATE videos SET duration = $1 WHERE dir = $2`,
      [result.duration, `skate-${id}`]
    );
  } catch (e: any) {
    console.error('[worker] db update error:', e.message);
  }

  return result;
}, {
  connection: redis,
  concurrency: 5, // 5 concurrent jobs (1 GPU + 4 CPU fallback); 4-core N95
  limiter: { max: 5, duration: 1000 }, // throttle: 5 jobs/sec max
  removeOnComplete: { age: 3600, count: 100 }, // keep last 100 completed jobs
  removeOnFail: { age: 86400 }, // keep failed jobs for 24h for debugging
});

worker.on('completed', (job) => console.log(`[worker] Job ${job.id} completed`));
worker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.id} failed`, err);
  if (job?.data?.id) {
    const metaPath = path.join(PROGRESS_DIR, job.data.id + ".json");
    try {
      const meta = JSON.parse(require("fs").readFileSync(metaPath, "utf8"));
      meta.status = "error"; meta.error = err.message; meta.finished = Date.now();
      require("fs").writeFileSync(metaPath, JSON.stringify(meta));
    } catch {}
    db.query(
      `INSERT INTO jobs (job_id, status, error, finished_at)
       VALUES ($1, 'error', $2, NOW())
       ON CONFLICT (job_id) DO UPDATE SET status = 'error', error = $2, finished_at = NOW()`,
      [job.data.id, err.message]
    ).catch(() => {});
  }
});

console.log('[worker] Video processing worker started');
