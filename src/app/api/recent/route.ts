import { NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

export async function GET() {
  const entries = (await readdir(UPLOADS_DIR, { withFileTypes: true }))
    .filter(d => d.isDirectory() && d.name.startsWith("skate-") && !d.name.startsWith("skate-process"));

  const withMtime = await Promise.all(
    entries.map(async d => {
      try {
        const inputPath = path.join(UPLOADS_DIR, d.name, "input.mp4");
        const s = await stat(inputPath);
        return { dir: d.name, mtime: s.mtimeMs };
      } catch {
        return null;
      }
    })
  );

  const valid = withMtime.filter((x): x is { dir: string; mtime: number } => x !== null);
  valid.sort((a, b) => b.mtime - a.mtime);

  return NextResponse.json(valid.slice(0, 3).map(v => ({
    dir: v.dir,
    url: `/uploads/${v.dir}/input.mp4`,
    date: new Date(v.mtime).toLocaleString(),
  })));
}