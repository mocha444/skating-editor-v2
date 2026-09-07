"use strict";
/**
 * Job worker. Polls the SQLite job queue (scripts/jobs-db.cjs) with an atomic
 * claim (dequeueJob), processes one job at a time, and writes progress/results
 * back to the DB. Log lines stream to a per-job .log file consumed via SSE.
 *
 * Multiple workers (one per host, or scaled) claim distinct jobs safely thanks
 * to the single shared DB on the volume. A worker crash mid-job leaves it
 * 'running'; it is reclaimed after a lease timeout or on restart.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const {
  DATA_DIR,
  PROGRESS_DIR,
  RESULTS_DIR: _unused,
  dequeueJob,
  setJob,
  completeJob,
  failJob,
  resetRunningJobs,
  jobLogPath,
  updateRecentDuration,
} = require("./jobs-db.cjs");
const RESULTS_DIR = path.join(DATA_DIR, "results");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

function now() {
  return Date.now();
}

function appendLog(id, line) {
  try {
    fs.appendFileSync(jobLogPath(id), line + "\n");
  } catch {}
}
function update(id, patch) {
  try {
    setJob(id, patch);
  } catch {}
}

function mkdirSyncProject() {
  fs.mkdirSync(PROGRESS_DIR, { recursive: true });
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

function ffprobeDuration(mediaPath) {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", ["-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", mediaPath]);
    let out = "";
    p.stdout.on("data", d => out += d.toString());
    p.on("error", () => resolve(null));
    p.on("close", () => {
      const v = parseFloat(out.trim());
      resolve(Number.isFinite(v) && v > 0 ? v : null);
    });
  });
}

function runPython(script, args, id) {
  return new Promise((resolve, reject) => {
    const p = spawn("python3", [script, ...args]);
    let out = "", err = "";
    p.stdout.on("data", d => out += d.toString());
    p.stderr.on("data", d => { err += d.toString(); appendLog(id, `[mog2] ${d.toString().trim()}`); });
    p.on("close", c => {
      if (c === 0) {
        try { resolve(JSON.parse(out)); }
        catch (e) { reject(new Error("detect parse: " + err.slice(-300))); }
      } else {
        reject(new Error("detect failed rc=" + c + ": " + err.slice(-300)));
      }
    });
    p.on("error", (e) => reject(new Error("python spawn: " + e.message)));
  });
}

function runFfmpeg(args, id, label) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args);
    let err = "";
    p.stdout.on("data", d => err += d.toString());
    p.stderr.on("data", d => err += d.toString());
    p.on("close", c => {
      if (c === 0) resolve();
      else {
        appendLog(id, `[${label}] ffmpeg error: ${err.slice(-300)}`);
        reject(new Error(`ffmpeg ${label} failed: ` + err.slice(-200)));
      }
    });
    p.on("error", (e) => reject(new Error("ffmpeg spawn: " + e.message)));
  });
}

async function processJob(job) {
  const { id, threshold, minContour, minMotionFrames, bufferFrames, history, varThreshold, detectShadows } = job;
  // Absolute paths already resolved at job-creation time; keep them so the
  // ffmpeg concat demuxer (which resolves list entries relative to the list
  // file's own dir) can't double-prefix a relative segDir.
  const inPath = job.inPath;
  const segDir = job.segDir;
  mkdirSyncProject();
  fs.mkdirSync(segDir, { recursive: true });

  update(id, { stage: "detect", percent: 30 });
  appendLog(id, "[mog2] starting motion detection...");

  const detectArgs = [inPath, segDir];
  detectArgs.push("--threshold", threshold || "0.003");
  detectArgs.push("--min-contour", minContour || "50");
  detectArgs.push("--min-motion-frames", minMotionFrames || "8");
  detectArgs.push("--buffer-frames", bufferFrames || "60");
  detectArgs.push("--history", history || "300");
  detectArgs.push("--var-threshold", varThreshold || "25");
  detectArgs.push("--max-fps", "30");
  if (detectShadows === "true") detectArgs.push("--detect-shadows");

  const parsed = await runPython(path.join(__dirname, "process_video.py"), [...detectArgs], id);
  const segments = parsed.segments || [];
  if (!segments.length) throw new Error("no motion detected");
  update(id, { stage: "detect_done", percent: 60 });
  appendLog(id, `[mog2] Found ${segments.length} segments`);

  const segFiles = [];
  for (let i = 0; i < segments.length; i++) {
    const [s, e] = segments[i];
    if (e - s < 0.5) continue;
    update(id, { percent: 60 + Math.round((20 * (i + 1)) / segments.length) });
    const f = path.join(segDir, `seg-${i}.mp4`);
    appendLog(id, `[cut] ${i + 1}/${segments.length} ${s.toFixed(2)}s → ${e.toFixed(2)}s`);
    await runFfmpeg(["-y", "-ss", String(s), "-i", inPath, "-t", String(e - s), "-c", "copy", "-avoid_negative_ts", "make_zero", f], id, "cut");
    segFiles.push(f);
  }

  update(id, { stage: "concat", percent: 90 });
  const listPath = path.join(path.dirname(segDir), "list.txt");
  fs.writeFileSync(listPath, segFiles.map(f => `file '${f}'`).join("\n"));
  const finalPath = path.join(RESULTS_DIR, `skating_final_${id}.mp4`);
  await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", finalPath], id, "concat");
  appendLog(id, "[concat] Done!");

  // Report the REAL final-file duration (stream-copy snaps to keyframes, so it
  // usually differs from the nominal sum of detections).
  const nominal = segments.reduce((a, [s, e]) => a + (e - s), 0);
  const duration = (await ffprobeDuration(finalPath)) ?? nominal;

  const result = {
    ok: true, jobId: id, segments: segments.length, duration,
    sourceDuration: typeof parsed.source_duration === "number" && parsed.source_duration > 0
      ? parsed.source_duration
      : duration,
    finalUrl: `/results/skating_final_${id}.mp4`,
    rawSegments: segments,
    segUrls: segFiles.map((f, i) => `/uploads/skate-${id}/segments/seg-${i}.mp4`),
  };
  completeJob(id, result, now());
  updateRecentDuration(job.dir || `skate-${id}`, duration);
  appendLog(id, "[done] Final video ready");
  appendLog(id, `[timing] Total elapsed: ${((now() - (job.started || now())) / 1000).toFixed(1)}s`);
}

// Poll loop: claim one job, process it fully, then look for more.
const POLL_MS = 1000;
let processing = false;

async function tick() {
  if (processing) return;
  let job;
  try {
    job = dequeueJob();
  } catch (e) {
    console.error("[worker] dequeue error", e && e.message);
    job = null;
  }
  if (!job) return;
  processing = true;
  const id = job.id;
  try {
    console.log(`[worker] claimed ${id} (${job.originalName || job.dir})`);
    await processJob(job);
    console.log(`[worker] ${id} done`);
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.error(`[worker] job ${id} failed: ${msg}`);
    failJob(id, msg);
    appendLog(id, `[error] ${msg}`);
  } finally {
    processing = false;
  }
}

function start() {
  mkdirSyncProject();
  try {
    resetRunningJobs(); // requeue anything from a previous crashed worker
  } catch (e) {
    console.error("[worker] reset error", e && e.message);
  }
  console.log(`[worker] watching SQLite queue at ${require("./jobs-db.cjs").DB_PATH}`);
  setInterval(tick, POLL_MS);
  tick();
}

start();