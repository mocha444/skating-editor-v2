import { NextResponse } from "next/server";
import { db } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the server is working on, so the UI can re-attach after a reload.
 *
 * Without this the page had no way to rediscover a job: the only link was the
 * in-memory jobId and its EventSource, so refreshing mid-job rendered an empty
 * page while the worker carried on. This makes the UI self-healing — it also
 * covers a second tab, a different device, or coming back later to a finished
 * edit, none of which can rely on the original tab's memory.
 *
 * Returns the in-flight job if there is one, otherwise the most recently
 * finished job while it is still worth showing (within the retention window).
 */
const REATTACH_WINDOW_MS = 4 * 60 * 60 * 1000;

export async function GET() {
  const active = db.getActiveJob();
  if (active) {
    return NextResponse.json({
      job: {
        id: active.id,
        dir: active.dir,
        status: active.status,
        stage: active.stage,
        percent: active.percent,
      },
    });
  }

  // listJobs() is ordered created_at DESC, so [0] is the newest.
  const latest = db.listJobs()[0];
  const finishedRecently =
    latest?.finished != null && Date.now() - latest.finished < REATTACH_WINDOW_MS;

  if (latest && finishedRecently) {
    return NextResponse.json({
      job: {
        id: latest.id,
        dir: latest.dir,
        status: latest.status,
        stage: latest.stage,
        percent: latest.percent,
      },
    });
  }

  return NextResponse.json({ job: null });
}
