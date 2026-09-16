import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "path";
import { serveFile } from "@/lib/serve-file";
import { UPLOADS_DIR, RESULTS_DIR } from "@/lib/storage";
import { db } from "@/lib/jobs";

export const runtime = "nodejs";

// ?excludeSegments=1,3 — positions in the job's segUrls array. Lenient on
// purpose: blanks, non-integers and out-of-range entries are ignored so a
// stale UI selection trims what it can instead of failing the download.
function parseExcluded(param: string | null, count: number): Set<number> {
  const excluded = new Set<number>();
  if (!param) return excluded;
  for (const part of param.split(",")) {
    const t = part.trim();
    if (!t) continue;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 0 || n >= count) continue;
    excluded.add(n);
  }
  return excluded;
}

// Segment files are always worker-written as seg-<n>.mp4; anything else in a
// stored segUrl is rejected rather than passed to ffmpeg.
const SEG_FILE_RE = /^seg-\d+\.mp4$/;

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!/^[0-9a-zA-Z]{6,16}$/.test(jobId)) return new Response("Not Found", { status: 404 });

  const job = db.getJob(jobId);
  if (!job) return new Response("Not Found", { status: 404 });

  const dir: string = job.dir || "";
  const result = (job.result ?? {}) as { finalUrl?: string; segUrls?: string[] } | null;
  const finalUrl: string = result?.finalUrl || "";
  const segUrls: string[] = result?.segUrls || [];
  if (!/^skate-[0-9a-f]{6,16}$/i.test(dir) || typeof finalUrl !== "string" || !finalUrl) {
    return new Response("Not Found", { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const excluded = parseExcluded(searchParams.get("excludeSegments"), segUrls.length);

  const finalName = path.basename(finalUrl);
  if (finalName.includes("..") || finalName.includes("/")) return new Response("Not Found", { status: 404 });
  const finalPath = path.join(RESULTS_DIR, finalName);

  let fileName = `skating_final_${jobId}.mp4`;
  try {
    const hashFile = await readFile(path.join(UPLOADS_DIR, dir, "hash.md5"), "utf8");
    if (hashFile) fileName = `skating_${hashFile.trim().slice(0, 8)}.mp4`;
  } catch {}

  // If no segments are excluded, serve the pre-built final video directly.
  if (excluded.size === 0) {
    const res = await serveFile(req, finalPath);
    const headers = new Headers(res.headers);
    headers.set("Content-Disposition", `attachment; filename="${fileName}"`);
    return new Response(res.body, { status: res.status, headers });
  }

  if (segUrls.length === 0) {
    return new Response(
      "This video was processed before per-clip trimming was available. Re-process it to enable removing clips.",
      { status: 400 },
    );
  }

  // Some segments excluded — re-concat only the remaining ones.
  // Each segment is already a separate file, so ffmpeg concat with -c copy
  // is fast (stream copy, no re-encoding).
  const segDir = path.join(UPLOADS_DIR, dir, "segments");
  const keepPositions = segUrls.map((_, i) => i).filter((i) => !excluded.has(i));

  if (keepPositions.length === 0) {
    return new Response("Cannot remove all segments.", { status: 400 });
  }

  // Resolve via the stored segUrls (not seg-<i>.mp4 by position) so historic
  // jobs with non-contiguous segment numbering still trim the right clips.
  const keepPaths: string[] = [];
  for (const pos of keepPositions) {
    const base = path.basename(segUrls[pos] ?? "");
    if (!SEG_FILE_RE.test(base)) {
      return new Response("Cannot trim this video (unexpected segment name).", { status: 400 });
    }
    keepPaths.push(path.join(segDir, base));
  }
  for (const p of keepPaths) {
    try {
      const st = await stat(p);
      if (!st.isFile()) throw new Error("not a file");
    } catch {
      return new Response(
        "Some clip files are no longer on disk (the video was likely re-processed since). Re-process to trim.",
        { status: 410 },
      );
    }
  }

  // Deterministic output name per exclusion set, so the trimmed preview
  // (<video src>) and the download button share one cached file instead of
  // racing a single trim_<jobId>.mp4 — and repeat trims skip ffmpeg.
  const outName = `trim_${jobId}_keep-${keepPositions.join("-")}.mp4`;
  const outPath = path.join(RESULTS_DIR, outName);

  let exists = false;
  try {
    exists = (await stat(outPath)).isFile();
  } catch {
    exists = false;
  }

  if (!exists) {
    // Unique list filename per build so concurrent trims of the same job
    // with different exclusion sets can't steal each other's concat list.
    const tmpList = path.join(RESULTS_DIR, `trim-${jobId}-${Date.now()}-${process.pid}.txt`);
    await writeFile(tmpList, keepPaths.map((p) => `file '${p}'`).join("\n"));
    try {
      await new Promise<void>((resolve, reject) => {
        const ffmpeg = spawn("ffmpeg", [
          "-y",
          "-f", "concat",
          "-safe", "0",
          "-i", tmpList,
          "-c", "copy",
          outPath,
        ]);

        let stderr = "";
        ffmpeg.stderr.on("data", (d) => { stderr += d.toString(); });
        ffmpeg.on("close", (code) => {
          if (code !== 0) return reject(new Error(`ffmpeg concat failed: ${stderr.slice(-200)}`));
          resolve();
        });
        ffmpeg.on("error", (e) => reject(e));
      });
    } catch (e) {
      await unlink(outPath).catch(() => {});
      return new Response(`Could not build trimmed video: ${(e as Error)?.message ?? e}`, { status: 500 });
    } finally {
      await unlink(tmpList).catch(() => {});
    }
  }

  const res = await serveFile(req, outPath);
  const headers = new Headers(res.headers);
  headers.set("Content-Disposition", `attachment; filename="${fileName}"`);

  // Keep the cached trim around for preview seeking/re-downloads; sweep it
  // later so the results dir doesn't fill with every combination tried.
  setTimeout(() => { unlink(outPath).catch(() => {}); }, 60 * 60 * 1000);

  return new Response(res.body, { status: res.status, headers });
}
