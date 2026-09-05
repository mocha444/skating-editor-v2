import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { mkdir, writeFile, readFile, readdir, stat } from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { randomUUID, createHash } from "crypto";

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

export async function POST(req: Request) {
  const form = await req.formData();
  const dir = form.get("dir") as string;
  const threshold = form.get("threshold") as string;
  const minContour = form.get("min-contour") as string;
  const minMotionFrames = form.get("min-motion-frames") as string;
  const bufferFrames = form.get("buffer-frames") as string;
  const historyVal = form.get("history") as string;
  const varThreshold = form.get("var-threshold") as string;
  const detectShadows = form.get("detect-shadows") as string;

  const inPath = path.join(UPLOADS_DIR, dir, "input.mp4");
  const segDir = path.join(UPLOADS_DIR, dir, "segments");
  await mkdir(segDir, { recursive: true });

  // Ensure hash is stored (compute if missing)
  const hashPath = path.join(UPLOADS_DIR, dir, "hash.md5");
  let serverHash: string;
  try {
    serverHash = (await readFile(hashPath, "utf8")).trim();
  } catch {
    serverHash = await computeFileHash(inPath);
    await writeFile(hashPath, serverHash, "utf8");
  }

  const detectArgs = [path.join(PROJECT_ROOT, "scripts", "process_video.py"), inPath, segDir];
  if (threshold) detectArgs.push("--threshold", threshold);
  if (minContour) detectArgs.push("--min-contour", minContour);
  if (minMotionFrames) detectArgs.push("--min-motion-frames", minMotionFrames);
  if (bufferFrames) detectArgs.push("--buffer-frames", bufferFrames);
  if (historyVal) detectArgs.push("--history", historyVal);
  if (varThreshold) detectArgs.push("--var-threshold", varThreshold);
  if (detectShadows === "true") detectArgs.push("--detect-shadows");

  const detectOut = await run("python3", detectArgs);
  const { segments } = JSON.parse(detectOut);
  if (!segments || !segments.length) return NextResponse.json({ error: "no motion detected" }, { status: 400 });

  const segFiles: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const [s, e] = segments[i];
    if (e - s < 0.5) continue;
    const f = path.join(segDir, `seg-${i}.mp4`);
    await run("ffmpeg", ["-y", "-ss", String(s), "-i", inPath, "-t", String(e - s), "-c", "copy", f]);
    segFiles.push(f);
  }

  const listPath = path.join(UPLOADS_DIR, `${dir}`, "list.txt");
  await writeFile(listPath, segFiles.map(f => `file '${f}'`).join("\n"));
  const finalPath = path.join(RESULTS_DIR, `skating_final_${dir}.mp4`);
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", finalPath]);

  return NextResponse.json({
    ok: true,
    segments: segments.length,
    duration: segments.reduce((a: number, [s, e]: number[]) => a + (e - s), 0),
    finalUrl: `/results/skating_final_${dir}.mp4`,
    rawSegments: segments,
    segUrls: segFiles.map((f, i) => `/uploads/${dir}/segments/seg-${i}.mp4`),
    hash: serverHash,
  });
}