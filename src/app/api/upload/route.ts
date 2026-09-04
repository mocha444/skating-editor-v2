import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { writeFile, mkdir, readFile, readdir } from "fs/promises";
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

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("video") as File | null;
  if (!file) return NextResponse.json({ error: "no file" }, { status: 400 });
  console.log("[upload] received:", file.name, "| type:", file.type, "| size:", file.size);

  // Duplicate check — compute MD5 of file and compare to existing uploads
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const md5 = createHash("md5").update(fileBuffer).digest("hex");
  const uploadsDir = await readdir(UPLOADS_DIR, { withFileTypes: true });
  for (const entry of uploadsDir) {
    if (entry.isDirectory() && entry.name.startsWith("skate-")) {
      try {
        const existingPath = path.join(UPLOADS_DIR, entry.name, "input.mp4");
        const existingBuffer = await readFile(existingPath);
        const existingMd5 = createHash("md5").update(existingBuffer).digest("hex");
        if (existingMd5 === md5) {
          console.log(`[upload] duplicate detected: ${file.name} matches ${entry.name}`);
          return NextResponse.json({ ok: false, duplicate: true, existingDir: entry.name, message: "Same video already uploaded" });
        }
      } catch {}
    }
  }

  const id = randomUUID().slice(0, 8);

  // persistent project directories
  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(RESULTS_DIR, { recursive: true });

  const workDir = path.join(UPLOADS_DIR, `skate-${id}`);
  const segDir = path.join(workDir, "segments");
  await mkdir(workDir, { recursive: true });
  await mkdir(segDir, { recursive: true });

  const inPath = path.join(workDir, "input.mp4");
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(inPath, buf);

  // 1) Detect motion via Python/OpenCV
  const detectOut = await run("python3", [
    path.join(PROJECT_ROOT, "scripts", "process_video.py"),
    inPath, segDir,
  ]);
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
