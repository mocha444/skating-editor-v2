import { NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

export async function GET() {
  try {
    const entries = (await readdir(UPLOADS_DIR, { withFileTypes: true }))
      .filter(d => d.isDirectory() && d.name.startsWith("skate-") && !d.name.startsWith("skate-process"));

    if (!entries.length) return NextResponse.json({ file: null });

    // Get the mtime of each input.mp4
    const withMtime = await Promise.all(
      entries.map(async d => {
        try {
          const s = await stat(path.join(UPLOADS_DIR, d.name, "input.mp4"));
          return { name: d.name, mtime: s.mtimeMs };
        } catch {
          return { name: d.name, mtime: 0 };
        }
      })
    );

    withMtime.sort((a, b) => b.mtime - a.mtime);
    const latest = withMtime[0].name;

    return NextResponse.json({
      file: `/uploads/${latest}/input.mp4`,
      dir: latest,
    });
  } catch {
    return NextResponse.json({ file: null });
  }
}
