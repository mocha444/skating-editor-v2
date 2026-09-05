import { NextResponse } from "next/server";
import { readdir, stat, readFile } from "fs/promises";
import type { Dirent } from "fs";
import path from "path";
import { spawn } from "child_process";
import { UPLOADS_DIR } from "@/lib/storage";

async function getDuration(inputPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ]);
    let out = "";
    p.stdout.on("data", d => (out += d.toString()));
    p.on("close", () => {
      const v = parseFloat(out.trim());
      resolve(isNaN(v) ? null : v);
    });
    p.on("error", () => resolve(null));
  });
}

export async function GET() {
  let entries: Dirent[] = [];
  try {
    entries = (await readdir(UPLOADS_DIR, { withFileTypes: true }))
      .filter(d => d.isDirectory() && d.name.startsWith("skate-") && !d.name.startsWith("skate-process"));
  } catch {
    entries = [];
  }
  if (!entries.length) return NextResponse.json([]);

  const withMtime = await Promise.all(
    entries.map(async d => {
      try {
        const inputPath = path.join(UPLOADS_DIR, d.name, "input.mp4");
        const s = await stat(inputPath);
        const duration = await getDuration(inputPath);
        let hash: string | null = null;
        try {
          hash = (await readFile(path.join(UPLOADS_DIR, d.name, "hash.md5"), "utf8")).trim();
        } catch {}
        return { dir: d.name, mtime: s.mtimeMs, duration, hash };
      } catch {
        return null;
      }
    })
  );

  const valid = withMtime.filter((x): x is { dir: string; mtime: number; duration: number | null; hash: string | null } => x !== null);
  valid.sort((a, b) => b.mtime - a.mtime);

  return NextResponse.json(valid.slice(0, 3).map(v => ({
    dir: v.dir,
    url: `/uploads/${v.dir}/input.mp4`,
    date: new Date(v.mtime).toLocaleString(),
    duration: v.duration,
    durationLabel: v.duration ? formatDuration(v.duration) : "—",
    hash: v.hash ? v.hash.slice(0, 8) : null,
  })));
}

function formatDuration(s: number): string {
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}