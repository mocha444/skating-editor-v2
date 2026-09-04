// Worker that processes a single upload in the background.
// Survives page refresh: client can reconnect via SSE to see progress.
import { spawn } from "child_process";
import { mkdir, writeFile, readFile, readdir, stat } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const PROJECT_ROOT = process.cwd();
const UPLOADS_DIR = path.join(PROJECT_ROOT, "public", "uploads");
const RESULTS_DIR = path.join(PROJECT_ROOT, "public", "results");
const PROGRESS_DIR = path.join(UPLOADS_DIR, "progress");

async function runWithLogs(cmd: string, args: string[]): Promise<{ out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = "", err = "";
    p.stdout.on("data", d => (out += d.toString()));
    p.stderr.on("data", d => (err += d.toString()));
    p.on("close", code => code === 0 ? resolve({ out, err }) : reject(new Error(`${cmd} failed: ${err.slice(-500)}`)));
  });
}

export async function processLatest(): Promise<{ ok: boolean; jobId: string; dir?: string; segments?: number; duration?: number; finalUrl?: string; segUrls?: string[]; logs?: string[]; error?: string }> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(RESULTS_DIR, { recursive: true });
  await mkdir(PROGRESS_DIR, { recursive: true });

  const entries = (await readdir(UPLOADS_DIR, { withFileTypes: true }))
    .filter(d => d.isDirectory() && d.name.startsWith("skate-") && !d.name.startsWith("skate-process"));

  if (!entries.length) return { ok: false, jobId: "", error: "no files on disk" };

  const withMtime = await Promise.all(
    entries.map(async d => {
      try { const s = await stat(path.join(UPLOADS_DIR, d.name, "input.mp4")); return { name: d.name, mtime: s.mtimeMs }; }
      catch { return null; }
    })
  );
  const valid = withMtime.filter((x): x is { name: string; mtime: number } => x !== null) as { name: string; mtime: number }[];
  if (!valid.length) return { ok: false, jobId: "", error: "no valid files on disk" };
  valid.sort((a, b) => b.mtime - a.mtime);

  const latestDir = valid[0].name;
  const inPath = path.join(UPLOADS_DIR, latestDir, "input.mp4");
  const segDir = path.join(UPLOADS_DIR, latestDir, "segments");
  await mkdir(segDir, { recursive: true });

  const id = randomUUID().slice(0, 8);
  const jobId = `${latestDir}_${id}`;
  const logFile = path.join(PROGRESS_DIR, `${jobId}.log`);
  const metaFile = path.join(PROGRESS_DIR, `${jobId}.json`);

  // Write initial meta so the SSE can find this job
  await writeFile(metaFile, JSON.stringify({
    jobId, dir: latestDir, status: "running", started: Date.now(), lines: 0,
  }));

  const appendLog = async (line: string) => {
    await writeFile(logFile, (await readFile(logFile, "utf8").catch(() => "")) + line + "\n");
    try {
      const meta = JSON.parse(await readFile(metaFile, "utf8"));
      meta.lines = (meta.lines || 0) + 1;
      meta.lastUpdate = Date.now();
      await writeFile(metaFile, JSON.stringify(meta));
    } catch {}
  };

  // Fire and forget — returns jobId immediately
  (async () => {
    try {
      await appendLog(`[job ${jobId}] starting on ${latestDir} (${((await stat(inPath)).size/1e6).toFixed(1)} MB)`);
      const detect = await runWithLogs("python3", [path.join(PROJECT_ROOT, "scripts", "process_video.py"), inPath, segDir]);
      detect.err.split("\n").filter(Boolean).forEach(l => appendLog(`[mog2] ${l.trim()}`));
      const { segments } = JSON.parse(detect.out);
      if (!segments || !segments.length) throw new Error("no motion detected");

      await appendLog(`[mog2] Found ${segments.length} segments`);

      for (let i = 0; i < segments.length; i++) {
        const [s, e] = segments[i];
        if (e - s < 0.5) continue;
        const f = path.join(segDir, `seg-${i}.mp4`);
        await appendLog(`[cut] ${i+1}/${segments.length} ${s.toFixed(2)}s → ${e.toFixed(2)}s`);
        await runWithLogs("ffmpeg", ["-y", "-ss", String(s), "-i", inPath, "-t", String(e - s), "-c", "copy", f]);
      }

      const listPath = path.join(UPLOADS_DIR, `skate-process-${id}`, "list.txt");
      await mkdir(path.dirname(listPath), { recursive: true });
      const segFiles = segments.map((_: any, i: number) => path.join(segDir, `seg-${i}.mp4`));
      await writeFile(listPath, segFiles.map(f => `file '${f}'`).join("\n"));
      const finalPath = path.join(RESULTS_DIR, `skating_final_${id}.mp4`);
      await appendLog("[concat] Joining segments...");
      await runWithLogs("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", finalPath]);
      await appendLog("[concat] Done!");

      const result = {
        ok: true,
        jobId, dir: latestDir, segments: segments.length,
        duration: segments.reduce((a: number, [s, e]: number[]) => a + (e - s), 0),
        finalUrl: `/results/skating_final_${id}.mp4`,
        rawSegments: segments,
        segUrls: segments.map((_: any, i: number) => `/uploads/${latestDir}/segments/seg-${i}.mp4`),
      };
      // Update meta with final result
      const meta = JSON.parse(await readFile(metaFile, "utf8"));
      Object.assign(meta, { status: "done", result, finished: Date.now() });
      await writeFile(metaFile, JSON.stringify(meta));
      await appendLog("[done] Final video ready");
    } catch (e: any) {
      const meta = JSON.parse(await readFile(metaFile, "utf8").catch(() => "{}"));
      Object.assign(meta, { status: "error", error: e.message, finished: Date.now() });
      await writeFile(metaFile, JSON.stringify(meta));
      await appendLog(`[error] ${e.message}`);
    }
  })();

  return { ok: true, jobId, dir: latestDir };
}
