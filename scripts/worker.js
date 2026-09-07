const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = process.cwd();
const DATA_DIR = process.env.DATA_DIR || path.join(PROJECT_ROOT, "data");
const PROGRESS_DIR = path.join(DATA_DIR, "progress");
const RESULTS_DIR = path.join(DATA_DIR, "results");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

function now() { return Date.now(); }

function readMeta(id) {
  try { return JSON.parse(fs.readFileSync(path.join(PROGRESS_DIR, id + ".json"), "utf8")); }
  catch { return null; }
}
function writeMeta(id, data) {
  fs.mkdirSync(PROGRESS_DIR, { recursive: true });
  fs.writeFileSync(path.join(PROGRESS_DIR, id + ".json"), JSON.stringify(data));
}
function appendLog(id, line) {
  const f = path.join(PROGRESS_DIR, id + ".log");
  fs.appendFileSync(f, line + "\n");
}
function update(id, patch) {
  const m = readMeta(id);
  if (m) writeMeta(id, { ...m, ...patch, lastUpdate: now() });
}
// --- atomic job claiming (prevents duplicate processing when >1 worker runs) ---
function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function lockPath(id) { return path.join(PROGRESS_DIR, id + ".lock"); }
// Returns true if this worker owns the job lock (mkdir is atomic).
function claim(id) {
  const dir = lockPath(id);
  try {
    fs.mkdirSync(dir);                 // fails if another worker already holds it
    fs.writeFileSync(path.join(dir, "pid"), String(process.pid));
    return true;
  } catch {
    // lock exists — steal it if the owner process is dead (crashed worker)
    try {
      const pid = parseInt(fs.readFileSync(path.join(dir, "pid"), "utf8"), 10);
      if (!pid || !isProcessAlive(pid)) {
        fs.rmSync(dir, { recursive: true, force: true });
        return claim(id);
      }
    } catch {}
    return false;
  }
}
function release(id) {
  fs.rmSync(lockPath(id), { recursive: true, force: true });
}

function updateRecent(dir, patch) {
  if (!dir) return;
  const f = path.join(DATA_DIR, "recent.json");
  let list = [];
  try { list = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
  if (!Array.isArray(list)) list = [];
  const next = list.map((e) => (e.dir === dir ? { ...e, ...patch } : e));
  try {
    fs.writeFileSync(f + ".tmp", JSON.stringify(next.slice(0, 30)));
    fs.renameSync(f + ".tmp", f);
  } catch {}
}

function runPython(script, args, id) {
  return new Promise((resolve, reject) => {
    const p = spawn("python3", [script, ...args]);
    let out = "", err = "";
    p.stdout.on("data", d => out += d.toString());
    p.stderr.on("data", d => { err += d.toString(); appendLog(id, `[mog2] ${d.toString().trim()}`); });
    p.on("close", c => {
      try { resolve(JSON.parse(out)); } catch { reject(new Error("detect parse: " + err.slice(-300))); }
    });
  });
}

function runFfmpeg(args, id, label) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args);
    let err = "";
    p.stderr.on("data", d => err += d.toString());
    p.on("close", c => {
      if (c === 0) resolve();
      else {
        appendLog(id, `[${label}] ffmpeg error: ${err.slice(-300)}`);
        reject(new Error(`ffmpeg ${label} failed: ` + err.slice(-200)));
      }
    });
  });
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

async function processJob(job) {
  const { id, threshold, minContour, minMotionFrames, bufferFrames, historyStr, varThreshold, detectShadows } = job;
  // Resolve to ABSOLUTE paths: the ffmpeg concat demuxer resolves the file
  // entries in list.txt relative to the list file's own directory, so a
  // relative segDir would get double-prefixed (data/.../data/...).
  const inPath = path.resolve(job.inPath);
  const segDir = path.resolve(job.segDir);
  mkdirSyncProject();
  fs.mkdirSync(segDir, { recursive: true });

  update(id, { status: "running", stage: "detect", percent: 30 });
  appendLog(id, "[mog2] starting motion detection...");

  const detectArgs = [inPath, segDir];
  detectArgs.push("--threshold", threshold || "0.003");
  detectArgs.push("--min-contour", minContour || "50");
  detectArgs.push("--min-motion-frames", minMotionFrames || "8");
  detectArgs.push("--buffer-frames", bufferFrames || "60");
  detectArgs.push("--history", historyStr || "300");
  detectArgs.push("--var-threshold", varThreshold || "25");
  detectArgs.push("--max-fps", "30");
  if (detectShadows === "true") detectArgs.push("--detect-shadows");

  const parsed = await runPython(path.join(PROJECT_ROOT, "scripts", "process_video.py"), [...detectArgs], id);
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

  // Report the REAL duration of the final file. `-c copy` snaps each cut to the
  // nearest keyframe, so the concatenated output is usually longer than the
  // nominal Σ(e−s) of the detections. Prefer the probed value so the count
  // matches the downloadable video exactly.
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
  update(id, { status: "done", stage: "done", percent: 100, finished: now(), result });
  updateRecent(job.dir || `skate-${id}`, { duration });
  appendLog(id, "[done] Final video ready");
  appendLog(id, `[timing] Total elapsed: ${((now() - (job.started || now())) / 1000).toFixed(1)}s`);
}

function mkdirSyncProject() {
  fs.mkdirSync(PROGRESS_DIR, { recursive: true });
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

function main() {
  mkdirSyncProject();
  try {
    for (const f of fs.readdirSync(PROGRESS_DIR).filter(x => x.endsWith(".json"))) {
      const id = f.slice(0, -5);
      const m = readMeta(id);
      if (m && m.status === "running") { m.status = "pending"; m.stage = "queued"; writeMeta(id, m); }
    }
  } catch {}

  console.log("[worker] watching directory for new jobs...");
  const watch = fs.watch(PROGRESS_DIR, (event, filename) => {
    if (filename && filename.endsWith(".json")) {
      const id = filename.slice(0, -5);
      const job = readMeta(id);
      if (!job) return;
      const isPending = job.status === "pending" || job.status === "queued";
      const isNewRun = event === "rename" && isPending;
      if (isNewRun || isPending) {
        setTimeout(async () => {
          const j = readMeta(id);
          if (!j) return;
          if (j.status !== "pending" && j.status !== "queued") return;
          if (!claim(id)) return;      // another worker already owns this job
          try {
            await processJob(j);
          } catch (e) {
            console.error(`[worker] job ${id} failed`, e.message);
            update(id, { status: "error", error: e.message, finished: now() });
            appendLog(id, `[error] ${e.message}`);
          } finally {
            release(id);
          }
        }, 200);
      }
    }
  });
  watch.on("error", (e) => console.error("[worker] watch error", e));
}

main();
