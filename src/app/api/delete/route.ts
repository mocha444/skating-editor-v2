import { NextResponse } from "next/server";
import { rm } from "fs/promises";
import path from "path";
import { UPLOADS_DIR, RESULTS_DIR } from "@/lib/storage";
import { db } from "@/lib/jobs";

export const runtime = "nodejs";

/**
 * Delete an upload dir and EVERYTHING that belongs to it: all job rows for the
 * dir (a dir accumulates one row per upload/reprocess), each job's log file and
 * final result video, the upload tree, and the recent-list entry.
 *
 * Note the result filename is keyed by job id (skating_final_<jobId>.mp4), and
 * reprocesses mint NEW job ids while keeping the original dir — so we must walk
 * the job table rather than guess at a single file.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const dir = form.get("dir") as string;
  if (!dir || dir.includes("..") || dir.includes("/")) {
    return NextResponse.json({ error: "invalid dir" }, { status: 400 });
  }

  try {
    const jobs = db.listJobsByDir(dir);
    await Promise.all([
      rm(path.join(UPLOADS_DIR, dir), { recursive: true, force: true }),
      ...jobs.map(async (j) => {
        await Promise.all([
          rm(path.join(RESULTS_DIR, `skating_final_${j.id}.mp4`), { force: true }),
          rm(db.jobLogPath(j.id), { force: true }),
        ]);
        db.deleteJob(j.id);
      }),
    ]);
    db.removeRecent(dir);
    return NextResponse.json({ ok: true, deletedJobs: jobs.length });
  } catch {
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
