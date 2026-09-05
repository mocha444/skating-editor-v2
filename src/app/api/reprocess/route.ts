import { NextResponse } from "next/server";
import { mkdir } from "fs/promises";
import path from "path";
import { videoQueue, countActiveJobs, tryLockSingleFlight, releaseSingleFlight } from "@/lib/bullmq-queue";
import { db } from "@/lib/db";
import { UPLOADS_DIR, PROGRESS_DIR, newJobId } from "@/lib/storage";

export const runtime = "nodejs";

function writeMeta(id: string, data: object) {
  require("fs").writeFileSync(path.join(PROGRESS_DIR, id + ".json"), JSON.stringify(data));
}

export async function POST(req: Request) {
  const form = await req.formData();
  const dir = form.get("dir") as string;
  const threshold = form.get("threshold") as string;
  const minContour = form.get("min-contour") as string;
  const minMotionFrames = form.get("min-motion-frames") as string;
  const bufferFrames = form.get("buffer-frames") as string;
  const historyStr = form.get("history") as string;
  const varThreshold = form.get("var-threshold") as string;
  const detectShadows = form.get("detect-shadows") as string;

  if (!dir || dir.includes("..") || dir.includes("/")) {
    return NextResponse.json({ error: "invalid dir" }, { status: 400 });
  }

  if (!(await tryLockSingleFlight())) {
    return NextResponse.json({ ok: false, error: "Another video is already being processed. Please wait for it to finish." }, { status: 409 });
  }
  try {
    if ((await countActiveJobs()) > 0) {
      return NextResponse.json({ ok: false, error: "Another video is already being processed. Please wait for it to finish." }, { status: 409 });
    }

    const jobId = newJobId();
    const inPath = path.join(UPLOADS_DIR, dir, "input.mp4");
    const segDir = path.join(UPLOADS_DIR, dir, "segments");

    await mkdir(PROGRESS_DIR, { recursive: true });
    await mkdir(segDir, { recursive: true });
    writeMeta(jobId, { jobId, dir, status: "running", started: Date.now(), percent: 5, stage: "starting" });

    await videoQueue.add('video-process', {
      inPath, segDir, id: jobId, dir,
      threshold: threshold || '0.003',
      minContour: minContour || '50',
      minMotionFrames: minMotionFrames || '8',
      bufferFrames: bufferFrames || '60',
      historyStr: historyStr || '300',
      varThreshold: varThreshold || '25',
      detectShadows: detectShadows || 'false',
    }, { jobId });
    try {
      await db.query(
        `INSERT INTO jobs (job_id, status, percent, stage) VALUES ($1, $2, $3, $4)
         ON CONFLICT (job_id) DO UPDATE SET percent = $3, stage = $4`,
        [jobId, 'running', 5, 'starting']
      );
    } catch (dbErr: any) {
      console.error('[db] insert error:', dbErr.message);
    }
    return NextResponse.json({ ok: true, jobId, dir });
  } finally {
    await releaseSingleFlight();
  }
}