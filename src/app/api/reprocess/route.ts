import { NextResponse } from "next/server";
import path from "path";
import { UPLOADS_DIR, newJobId } from "@/lib/storage";
import { db } from "@/lib/jobs";

export const runtime = "nodejs";

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

  const jobId = newJobId();
  const inPath = path.join(UPLOADS_DIR, dir, "input.mp4");
  const segDir = path.join(UPLOADS_DIR, dir, "segments");

  db.createJob({
    id: jobId,
    dir,
    inPath,
    segDir,
    status: "pending",
    stage: "queued",
    percent: 5,
    started: Date.now(),
    originalName: dir,
    threshold: threshold || "0.003",
    minContour: minContour || "50",
    minMotionFrames: minMotionFrames || "8",
    bufferFrames: bufferFrames || "60",
    history: historyStr || "300",
    varThreshold: varThreshold || "25",
    detectShadows: detectShadows || "false",
  });

  return NextResponse.json({ ok: true, jobId, dir });
}