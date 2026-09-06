import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { stat, readFile } from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { UPLOADS_DIR } from "@/lib/storage";
import { db } from "@/lib/db";

async function getDuration(inputPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
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
  await auth.protect();
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    // Find internal user ID from Clerk ID
    const userResult = await db.query("SELECT id FROM users WHERE clerk_id = $1", [clerkUserId]);
    if (!userResult.rows.length) {
      return NextResponse.json([]);
    }
    const userId = userResult.rows[0].id;

    // Get only THIS user's videos (latest first), limited to 1
    const videoResult = await db.query(
      `SELECT dir, hash, original_name FROM videos WHERE user_id = $1 ORDER BY uploaded_at DESC LIMIT 1`,
      [userId]
    );

    if (!videoResult.rows.length) return NextResponse.json([]);

    const v = videoResult.rows[0];
    const dir = v.dir;
    if (!dir || typeof dir !== "string" || dir.includes("..")) {
      return NextResponse.json([]);
    }

    const inputPath = path.join(UPLOADS_DIR, dir, "input.mp4");
    const s = await stat(inputPath);
    const duration = await getDuration(inputPath);
    let hash = v.hash || null;
    try {
      const h = await readFile(path.join(UPLOADS_DIR, dir, "hash.md5"), "utf8");
      hash = h.trim();
    } catch {}

    return NextResponse.json([{
      dir,
      url: `/uploads/${dir}/input.mp4`,
      date: new Date(s.mtimeMs).toLocaleString(),
      duration,
      durationLabel: duration ? formatDuration(duration) : "—",
      hash: hash ? hash.slice(0, 8) : null,
    }]);
  } catch (e: any) {
    console.error("[recent] error:", e.message);
    return NextResponse.json({ error: "Failed to load uploads" }, { status: 500 });
  }
}

function formatDuration(s: number): string {
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
