import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { mkdir, writeFile, readFile, readdir } from "fs/promises";
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

async function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = "", err = "";
    p.stdout.on("data", d => (out += d.toString()));
    p.stderr.on("data", d => (err += d.toString()));
    p.on("close", code => code === 0 ? resolve(out) : reject(new Error(`${cmd} failed: ${err}`)));
  });
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

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("video") as File | null;
  const clientHash = formData.get("hash") as string | null;
  const threshold = formData.get("threshold") as string | null;
  const minContour = formData.get("min-contour") as string | null;
  const minMotionFrames = formData.get("min-motion-frames") as string | null;
  const bufferFrames = formData.get("buffer-frames") as string | null;
  const history = formData.get("history") as string | null;
  const varThreshold = formData.get("var-threshold") as string | null;
  const detectShadows = formData.get("detect-shadows") as string | null;
  if (!file) return NextResponse.json({ error: "no file" }, { status: 400 });
  console.log("[upload] received:", file.name, "| size:", file.size, "| hash:", clientHash);

  // Fast duplicate check using client-provided hash + stored hash files
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

  // Save hash first so future dup checks are instant
  const id = randomUUID().slice(0, 8);
  const dir = path.join(UPLOADS_DIR, `skate-${id}`);
  await mkdir(dir, { recursive: true });
  if (clientHash) await writeFile(path.join(dir, "hash.md5"), clientHash, "utf8");

  // persistent project directories
  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(RESULTS_DIR, { recursive: true });

  const workDir = path.join(UPLOADS_DIR, `skate-${id}`);
  const segDir = path.join(workDir, "segments");
  await mkdir(workDir, { recursive: true });
  await mkdir(segDir, { recursive: true });

  const inPath = path.join(workDir, "input.mp4");
  // Stream the upload to disk instead of buffering the whole file in memory
  const { Readable } = await import("stream");
  const webStream = file.stream() as unknown as ReadableStream<Uint8Array>;
  const nodeStream = Readable.fromWeb(webStream as any);
  await pipeline(nodeStream, createWriteStream(inPath));

  // Validate file integrity with ffmpeg before processing
  try {
    await run("ffmpeg", ["-v", "quiet", "-i", inPath, "-t", "0.1", "-f", "null", "-"]);
  } catch (e: any) {
    await import("fs/promises").then(f => f.unlink(inPath));
    return NextResponse.json({ error: "corrupt video file (truncated upload?) — please re-upload the full file from your camera and don't refresh during upload", fileName: file.name }, { status: 400 });
  }

  // 1) Detect motion via Python/OpenCV
  // Server-side MD5 hash — always compute and store (more reliable than client hash)
  const serverHash = await computeFileHash(inPath);
  await writeFile(path.join(workDir, "hash.md5"), serverHash, "utf8");
  const detectArgs = [path.join(PROJECT_ROOT, "scripts", "process_video.py"), inPath, segDir];
  detectArgs.push("--threshold", threshold);
  detectArgs.push("--min-contour", minContour);
  detectArgs.push("--min-motion-frames", minMotionFrames);
  detectArgs.push("--buffer-frames", bufferFrames);
  detectArgs.push("--history", history);
  detectArgs.push("--var-threshold", varThreshold);
  if (detectShadows === "true") detectArgs.push("--detect-shadows");
  const detectOut = await run("python3", detectArgs);
  const { segments } = JSON.parse(detectOut);

  if (!segments.length) {
    return NextResponse.json({ error: "no motion detected", workDir });
  }

  // 2) Cut each segment with ffmpeg (copy codec — fast, lossless)
  const segFiles: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const [s, e] = segments[i];
    if (e - s < 0.5) continue; // skip sub-second fragments
    const f = path.join(segDir, `seg-${i}.mp4`);
    await run("ffmpeg", ["-y", "-ss", String(s), "-i", inPath, "-t", String(e - s), "-c", "copy", f]);
    segFiles.push(f);
  }

  // 3) Concat segments into final video
  const listPath = path.join(workDir, "list.txt");
  await writeFile(listPath, segFiles.map(f => `file '${f}'`).join("\n"));
  const finalPath = path.join(RESULTS_DIR, `skating_final_${id}.mp4`);
  // Re-encode audio (aac) to fix A/V drift at concat boundaries; copy video to preserve quality
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", finalPath]);

  // Build per-segment URLs so the UI can play each clip individually
  const workDirName = path.basename(workDir);
  const segUrls = segFiles.map((f, i) => `/uploads/${workDirName}/segments/seg-${i}.mp4`);

  return NextResponse.json({
    ok: true,
    segments: segments.length,
    duration: segments.reduce((a: number, [s, e]: [number, number]) => a + (e - s), 0),
    finalUrl: `/results/skating_final_${id}.mp4`,
    rawSegments: segments,
    segUrls,
  });
}
