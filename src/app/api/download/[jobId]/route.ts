import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { serveFile } from "@/lib/serve-file";
import { UPLOADS_DIR, RESULTS_DIR, PROGRESS_DIR, isSafeSegment } from "@/lib/storage";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const JOBID_RE = /^[0-9a-zA-Z]{6,16}$/;
const DIR_RE = /^skate-[0-9a-f]{6,16}$/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  await auth.protect();
  const { jobId } = await params;
  if (!JOBID_RE.test(jobId)) return new Response("Not Found", { status: 404 });

  let meta;
  try {
    meta = JSON.parse(await readFile(path.join(PROGRESS_DIR, jobId + ".json"), "utf8"));
  } catch {
    return new Response("Not Found", { status: 404 });
  }

  const dir: string = meta?.dir || "";
  const finalUrl: string = meta?.result?.finalUrl || "";
  if (!DIR_RE.test(dir) || typeof finalUrl !== "string") return new Response("Not Found", { status: 404 });
  const finalName = path.basename(finalUrl);
  if (!isSafeSegment(finalName)) return new Response("Not Found", { status: 404 });

  const finalPath = path.join(RESULTS_DIR, finalName);

  let fileName = `skating_final_${jobId}.mp4`;
  try {
    const dbResult = await db.query("SELECT original_name FROM videos WHERE dir = $1", [dir]);
    const original = dbResult.rows[0]?.original_name as string | undefined;
    if (original) fileName = original.replace(/\.mp4$/i, "") + "_final.mp4";
  } catch {}

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try { await rm(finalPath, { force: true }); } catch {}
    try { await rm(path.join(UPLOADS_DIR, dir), { recursive: true, force: true }); } catch {}
    try { await rm(path.join(PROGRESS_DIR, jobId + ".json"), { force: true }); } catch {}
    try { await rm(path.join(PROGRESS_DIR, jobId + ".log"), { force: true }); } catch {}
  };
  const timeout = setTimeout(cleanup, 60_000);

  const res = await serveFile(req, finalPath, {
    onFinish: () => {
      clearTimeout(timeout);
      cleanup();
    },
  });

  const headers = new Headers(res.headers);
  headers.set("Content-Disposition", `attachment; filename="${fileName}"`);
  return new Response(res.body, { status: res.status, headers });
}