import { NextRequest, NextResponse } from "next/server";
import { spawn, ChildProcess } from "child_process";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

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

export async function POST() {
  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(RESULTS_DIR, { recursive: true });
  await mkdir(path.join(UPLOADS_DIR, "progress"), { recursive: true });

  // Find latest input.mp4 by file mtime
  const { readdir, stat } = await import("fs/promises");
  const entries = (await readdir(UPLOADS_DIR, { withFileTypes: true }))
    .filter(d => d.isDirectory() && d.name.startsWith("skate-") && !d.name.startsWith("skate-process"));
  if (!entries.length) return NextResponse.json({ error: "no uploads" }, { status: 404 });

  const withMtime = await Promise.all(
    entries.map(async d => {
      const s = await stat(path.join(UPLOADS_DIR, d.name, "input.mp4"));
      return { name: d.name, mtime: s.mtimeMs };
    })
  );
  withMtime.sort((a, b) => b.mtime - a.mtime);
  const latestDir = withMtime[0].name;
  const inPath = path.join(UPLOADS_DIR, latestDir, "input.mp4");
  const segDir = path.join(UPLOADS_DIR, latestDir, "segments");
  await mkdir(segDir, { recursive: true });

  const id = randomUUID().slice(0, 8);
  const outDir = path.join(UPLOADS_DIR, `skate-process-${id}`);
  await mkdir(outDir, { recursive: true });

  const detectOut = await run("python3", [
    path.join(PROJECT_ROOT, "scripts", "process_video.py"),
    inPath, segDir,
  ]);
  const { segments } = JSON.parse(detectOut);

  if (!segments || !segments.length) {
    return NextResponse.json({ error: "no motion detected", workDir: outDir });
  }

  const segFiles: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const [s, e] = segments[i];
    if (e - s < 0.5) continue;
    const f = path.join(segDir, `seg-${i}.mp4`);
    await run("ffmpeg", ["-y", "-ss", String(s), "-i", inPath, "-t", String(e - s), "-c", "copy", f]);
    segFiles.push(f);
  }

  const listPath = path.join(outDir, "list.txt");
  await writeFile(listPath, segFiles.map(f => `file '${f}'`).join("\n"));
  const finalPath = path.join(RESULTS_DIR, `skating_final_${id}.mp4`);
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", finalPath]);

  // Per-segment URLs for UI play buttons
  const segDirUrl = `/uploads/${latestDir}/segments`;
  const segUrls = segments.map((_, i) => `${segDirUrl}/seg-${i}.mp4`);

  return NextResponse.json({
    ok: true,
    segments: segments.length,
    duration: segments.reduce((a: number, [s, e]: number[]) => a + (e - s), 0),
    finalUrl: `/results/skating_final_${id}.mp4`,
    rawSegments: segments,
    segUrls,
  });
}
