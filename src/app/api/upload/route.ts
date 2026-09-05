import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { mkdir, writeFile, readFile, readdir, stat } from "fs/promises";
import { createReadStream } from "fs";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { createHash } from "crypto";

export const runtime = "nodejs";
const PROJECT_ROOT = process.cwd();
const UPLOADS_DIR = path.join(PROJECT_ROOT, "public", "uploads");
const RESULTS_DIR = path.join(PROJECT_ROOT, "public", "results");
const PROGRESS_DIR = path.join(PROJECT_ROOT, "public", "uploads", "progress");

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
    const meta = JSON.parse(require("fs").readFileSync(metaPath, "utf8"));
    meta.percent = percent; meta.stage = stage; meta.lastUpdate = Date.now();
    require("fs").writeFileSync(metaPath, JSON.stringify(meta));
  } catch {}
}

function appendLog(id: string, line: string) {
  const logPath = path.join(PROGRESS_DIR, id + ".log");
  require("fs").appendFileSync(logPath, line + "\n");
}

export async function POST(req: NextRequest) {
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
  console.log(`[upload] received: ${file.name} | size: ${fmtBytes(file.size)} (${file.size} bytes) | hash: ${clientHash}`);

  // Fast duplicate check
  const uploadsDir = await readdir(UPLOADS_DIR, { withFileTypes: true });
  if (clientHash) {
    for (const entry of uploadsDir) {
      if (!entry.isDirectory() || !entry.name.startsWith("skate-")) continue;
      try {
        const hashPath = path.join(UPLOADS_DIR, entry.name, "hash.md5");
        const storedHash = (await readFile(hashPath, "utf8")).trim();
        if (storedHash === clientHash) {
          console.log(`[upload] duplicate: ${file.name} matches ${entry.name}`);
          return NextResponse.json({ ok: false, duplicate: true, existingDir: entry.name, message: "Same video already uploaded" });
        }
      } catch {}
    }
  }

  const id = randomUUID().slice(0, 8);
  const dir = path.join(UPLOADS_DIR, `skate-${id}`);
  await mkdir(dir, { recursive: true });
  await mkdir(PROGRESS_DIR, { recursive: true });
  const workDir = dir;
  const segDir = path.join(workDir, "segments");
  await mkdir(segDir, { recursive: true });
  const metaPath = path.join(PROGRESS_DIR, id + ".json");
  const logPath = path.join(PROGRESS_DIR, id + ".log");
  require("fs").writeFileSync(metaPath, JSON.stringify({ jobId: id, dir: `skate-${id}`, status: "running", started: Date.now(), percent: 5, stage: "saving" }));

  // Stream upload
  const inPath = path.join(workDir, "input.mp4");
  const { Readable } = await import("stream");
  const webStream = file.stream() as unknown as ReadableStream<Uint8Array>;
  const nodeStream = Readable.fromWeb(webStream as any);
  await pipeline(nodeStream, createWriteStream(inPath));

  writeProgress(id, 15, "upload_complete");
  appendLog(id, `[upload] saved ${file.name}`);

  // Validate
  try {
    await new Promise((res, rej) => {
      const p = spawn("ffmpeg", ["-v", "quiet", "-i", inPath, "-t", "0.1", "-f", "null", "-"]);
      p.on("close", c => c === 0 ? res(true) : rej(new Error("invalid")));
    });
  } catch (e: any) {
    await import("fs/promises").then(f => f.unlink(inPath));
    writeProgress(id, 0, "error");
    return NextResponse.json({ error: "corrupt video file (truncated upload?) — please re-upload the full file from your camera and don't refresh during upload", fileName: file.name }, { status: 400 });
  }

  writeProgress(id, 25, "hash_computing");
  const serverHash = await computeFileHash(inPath);
  await writeFile(path.join(workDir, "hash.md5"), serverHash, "utf8");
  appendLog(id, `[hash] ${serverHash}`);

  // Background processing (fire and forget, writes progress as it goes)
  (async () => {
    try {
      writeProgress(id, 30, "proxy");
      const detectArgs = [path.join(PROJECT_ROOT, "scripts", "process_video.py"), inPath, segDir];
      detectArgs.push("--threshold", threshold || "0.003");
      detectArgs.push("--min-contour", minContour || "50");
      detectArgs.push("--min-motion-frames", minMotionFrames || "8");
      detectArgs.push("--buffer-frames", bufferFrames || "60");
      detectArgs.push("--history", historyStr || "300");
      detectArgs.push("--var-threshold", varThreshold || "25");
      if (detectShadows === "true") detectArgs.push("--detect-shadows");

      writeProgress(id, 40, "detect");
      appendLog(id, "[mog2] starting motion detection...");
      const p = spawn("python3", detectArgs);
      let detectErr = "", detectOutRaw = "";
      p.stdout.on("data", d => detectOutRaw += d.toString());
      p.stderr.on("data", d => { detectErr += d.toString(); appendLog(id, `[mog2] ${d.toString().trim()}`); });

      const { segments, count } = await new Promise<any>((resolve, reject) => {
        p.on("close", code => {
          try {
            const parsed = JSON.parse(detectOutRaw);
            resolve(parsed);
          } catch {
            reject(new Error("Failed to parse Python output: " + detectErr.slice(-300)));
          }
        });
      });

      if (!segments || !segments.length) throw new Error("no motion detected");
      writeProgress(id, 60, "detect_done");
      appendLog(id, `[mog2] Found ${segments.length} segments`);

      const segFiles: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        const [s, e] = segments[i];
        if (e - s < 0.5) continue;
        writeProgress(id, 60 + Math.round((20 * (i + 1)) / segments.length), "cutting");
        const f = path.join(segDir, `seg-${i}.mp4`);
        appendLog(id, `[cut] ${i + 1}/${segments.length} ${s.toFixed(2)}s → ${e.toFixed(2)}s`);
        await new Promise((res, rej) => {
          const cut = spawn("ffmpeg", ["-y", "-ss", String(s), "-i", inPath, "-t", String(e - s), "-c", "copy", f]);
          cut.on("close", c => c === 0 ? res(true) : rej(new Error("ffmpeg cut failed")));
        });
        segFiles.push(f);
      }

      writeProgress(id, 90, "concat");
      const listPath = path.join(workDir, "list.txt");
      await writeFile(listPath, segFiles.map(f => `file '${f}'`).join("\n"));
      const finalPath = path.join(RESULTS_DIR, `skating_final_${id}.mp4`);
      await new Promise((res, rej) => {
        const concat = spawn("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", finalPath]);
        concat.on("close", c => c === 0 ? res(true) : rej(new Error("ffmpeg concat failed")));
      });
      appendLog(id, "[concat] Done!");
      writeProgress(id, 100, "done");

      const result = {
        ok: true,
        jobId: id,
        dir: `skate-${id}`,
        segments: segments.length,
        duration: segments.reduce((a: number, [s, e]: number[]) => a + (e - s), 0),
        finalUrl: `/results/skating_final_${id}.mp4`,
        rawSegments: segments,
        segUrls: segFiles.map((f, i) => `/uploads/skate-${id}/segments/seg-${i}.mp4`),
        hash: serverHash,
      };
      const metaPath2 = path.join(PROGRESS_DIR, id + ".json");
      const meta = JSON.parse(require("fs").readFileSync(metaPath2, "utf8"));
      meta.status = "done"; meta.result = result; meta.finished = Date.now();
      require("fs").writeFileSync(metaPath2, JSON.stringify(meta));
      appendLog(id, "[done] Final video ready");
      const metaDone = JSON.parse(require("fs").readFileSync(metaPath2, "utf8"));
      const elapsedMs = (metaDone.finished || Date.now()) - (metaDone.started || metaDone.finished || Date.now());
      const elapsedSec = (elapsedMs / 1000).toFixed(1);
      appendLog(id, `[timing] Total elapsed: ${elapsedSec}s`);
    } catch (e: any) {
      writeProgress(id, 0, "error");
      appendLog(id, `[error] ${e.message}`);
      const metaPath2 = path.join(PROGRESS_DIR, id + ".json");
      try { const meta = JSON.parse(require("fs").readFileSync(metaPath2, "utf8")); meta.status = "error"; meta.error = e.message; meta.finished = Date.now(); require("fs").writeFileSync(metaPath2, JSON.stringify(meta)); } catch {}
    }
  })();

  // Return job info immediately for polling
  return NextResponse.json({ ok: true, jobId: id, dir: `skate-${id}` });
}
