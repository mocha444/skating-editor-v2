import { NextResponse } from "next/server";
import { readdir, readFile } from "fs/promises";
import path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const hash = searchParams.get("hash") || "";
  if (!hash) return NextResponse.json({ duplicate: false });
  try {
    const entries = await readdir(UPLOADS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("skate-")) continue;
      try {
        const stored = (await readFile(path.join(UPLOADS_DIR, entry.name, "hash.md5"), "utf8")).trim();
        if (stored === hash) return NextResponse.json({ duplicate: true, dir: entry.name });
      } catch {}
    }
  } catch {}
  return NextResponse.json({ duplicate: false });
}
