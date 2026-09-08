import { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "path";
import { serveFile } from "@/lib/serve-file";
import { UPLOADS_DIR, RESULTS_DIR } from "@/lib/storage";
import { db } from "@/lib/jobs";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!/^[0-9a-zA-Z]{6,16}$/.test(jobId)) return new Response("Not Found", { status: 404 });

  // Job metadata lives in the shared SQLite store now (the legacy
  // progress/<jobId>.json files are no longer written).
  const job = db.getJob(jobId);
  if (!job) return new Response("Not Found", { status: 404 });

  const dir: string = job.dir || "";
  const result = (job.result ?? {}) as { finalUrl?: string } | null;
  const finalUrl: string = result?.finalUrl || "";
  if (!/^skate-[0-9a-f]{6,16}$/i.test(dir) || typeof finalUrl !== "string" || !finalUrl) {
    return new Response("Not Found", { status: 404 });
  }

  const finalName = path.basename(finalUrl);
  if (finalName.includes("..") || finalName.includes("/")) return new Response("Not Found", { status: 404 });
  const finalPath = path.join(RESULTS_DIR, finalName);

  let fileName = `skating_final_${jobId}.mp4`;
  try {
    const hashFile = await readFile(path.join(UPLOADS_DIR, dir, "hash.md5"), "utf8");
    if (hashFile) fileName = `skating_${hashFile.trim().slice(0, 8)}.mp4`;
  } catch {}

  const res = await serveFile(req, finalPath);
  const headers = new Headers(res.headers);
  headers.set("Content-Disposition", `attachment; filename="${fileName}"`);
  return new Response(res.body, { status: res.status, headers });
}
