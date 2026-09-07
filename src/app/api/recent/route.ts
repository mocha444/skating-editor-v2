import { NextResponse } from "next/server";
import { db } from "@/lib/jobs";

export const runtime = "nodejs";

export async function GET() {
  const entries = db.listRecent();
  const results = entries.map((e) => ({
    dir: e.dir,
    url: `/uploads/${e.dir}/input.mp4`,
    date: new Date(e.uploadedAt).toLocaleString(),
    duration: e.duration,
    durationLabel: e.duration ? formatDuration(e.duration) : "—",
    hash: e.hash ? e.hash.slice(0, 8) : "",
  }));
  return NextResponse.json(results);
}

function formatDuration(s: number): string {
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}