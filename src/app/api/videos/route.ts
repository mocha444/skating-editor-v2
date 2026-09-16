import { NextResponse } from "next/server";
import { readdir, stat } from "node:fs/promises";
import path from "path";
import { UPLOADS_DIR } from "@/lib/storage";
import { db } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VideoItem = {
  dir: string;
  name: string;
  size: number;
  mtime: number;
  hasInput: boolean;
  jobId?: string;
  status?: string;
  finalUrl?: string;
  downloadUrl?: string;
  segments?: number;
  duration?: number;
};

/**
 * Lightweight "what's on disk" listing for the browse/delete UI.
 * Source of truth is the upload dirs themselves (input.mp4), joined with the
 * latest job row per dir for a friendly name + download link when finished.
 */
export async function GET() {
  let names: string[] = [];
  try {
    const entries = await readdir(UPLOADS_DIR, { withFileTypes: true });
    names = entries.filter((e) => e.isDirectory() && e.name.startsWith("skate-")).map((e) => e.name);
  } catch {
    return NextResponse.json({ videos: [] });
  }

  // Latest job per dir (listJobs is newest-first) for name + finished output.
  const latestByDir = new Map<string, { job: ReturnType<typeof db.getJob>; result: Record<string, unknown> }>();
  try {
    for (const j of db.listJobs()) {
      if (!j?.dir || latestByDir.has(j.dir)) continue;
      let result: Record<string, unknown> = {};
      try {
        if (j.result && typeof j.result === "object") result = j.result as Record<string, unknown>;
      } catch {}
      latestByDir.set(j.dir, { job: j, result });
    }
  } catch {}

  const videos: VideoItem[] = [];
  for (const dir of names) {
    if (dir.includes("..") || dir.includes("/")) continue;
    const inPath = path.join(UPLOADS_DIR, dir, "input.mp4");
    let size = 0;
    let mtime = 0;
    let hasInput = false;
    try {
      const st = await stat(inPath);
      if (st.isFile()) {
        hasInput = true;
        size = st.size;
        mtime = st.mtimeMs;
      }
    } catch {}
    if (!hasInput) continue;

    const entry = latestByDir.get(dir);
    const result = entry?.result ?? {};
    const finalUrl = typeof result.finalUrl === "string" ? (result.finalUrl as string) : undefined;
    const segments = typeof result.segments === "number" ? (result.segments as number) : undefined;
    const duration = typeof result.duration === "number" ? (result.duration as number) : undefined;
    const jobId = entry?.job?.id;
    videos.push({
      dir,
      name: entry?.job?.originalName || dir,
      size,
      mtime: Math.round(mtime),
      hasInput,
      jobId,
      status: entry?.job?.status ?? undefined,
      finalUrl,
      downloadUrl: jobId && finalUrl ? `/api/download/${jobId}` : undefined,
      segments,
      duration,
    });
  }
  videos.sort((a, b) => b.mtime - a.mtime);
  return NextResponse.json({ videos });
}
