import { NextResponse } from "next/server";
import { writeFileSync } from "fs";
import { mkdir } from "fs/promises";
import path from "path";
import { UPLOADS_DIR, PROGRESS_DIR, newJobId } from "@/lib/storage";

export const runtime = "nodejs";

function writeMeta(id: string, data: object) {
  writeFileSync(path.join(PROGRESS_DIR, id + ".json"), JSON.stringify(data));
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

  const jobId = newJobId();
  const inPath = path.join(UPLOADS_DIR, dir, "input.mp4");
  const segDir = path.join(UPLOADS_DIR, dir, "segments");

  await mkdir(PROGRESS_DIR, { recursive: true });
  await mkdir(segDir, { recursive: true });

  writeMeta(jobId, {
    jobId, dir,
    inPath, segDir, id: jobId,
    threshold: threshold || "0.003",
    minContour: minContour || "50",
    minMotionFrames: minMotionFrames || "8",
    bufferFrames: bufferFrames || "60",
    historyStr: historyStr || "300",
    varThreshold: varThreshold || "25",
    detectShadows: detectShadows || "false",
    status: "pending", started: Date.now(), percent: 5, stage: "queued",
  });

  return NextResponse.json({ ok: true, jobId, dir });
}
