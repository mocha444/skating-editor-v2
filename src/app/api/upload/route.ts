import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from "fs";
import { open, readFile, readdir } from "fs/promises";
import path from "path";
import { UPLOADS_DIR, PROGRESS_DIR, newJobId } from "@/lib/storage";
import { addRecent } from "@/lib/store";

const SIG_BYTES = 1024 * 1024; // must match client-hash.ts (1 MiB)

async function readRangeMd5(filePath: string, start: number, end: number): Promise<string> {
  const fh = await open(filePath, "r");
  try {
    const len = end - start;
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, start);
    return createHash("md5").update(buf).digest("hex");
  } finally {
    await fh.close();
  }
}

async function computeSig(filePath: string, size: number) {
  if (size <= SIG_BYTES) {
    const whole = await readRangeMd5(filePath, 0, size);
    return { size, head: whole, tail: whole };
  }
  const head = await readRangeMd5(filePath, 0, SIG_BYTES);
  const tail = await readRangeMd5(filePath, size - SIG_BYTES, size);
  return { size, head, tail };
}

async function findDuplicateHash(hashHex: string, excludeId: string): Promise<string | null> {
  const entries = await readdir(UPLOADS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("skate-")) continue;
    if (entry.name === `skate-${excludeId}`) continue;
    try {
      const stored = (await readFile(path.join(UPLOADS_DIR, entry.name, "hash.md5"), "utf8")).trim();
      if (stored === hashHex) return entry.name;
    } catch {}
  }
  return null;
}

export const runtime = "nodejs";
export const maxDuration = 1800;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const chunkId = req.headers.get("x-chunk-id") || newJobId();
    const fileName = req.headers.get("x-file-name") || "video.mp4";
    const dir = path.join(UPLOADS_DIR, `skate-${chunkId}`);
    const inPath = path.join(dir, "input.mp4");
    const metaPath = path.join(PROGRESS_DIR, chunkId + ".json");

    mkdirSync(dir, { recursive: true });
    mkdirSync(path.join(dir, "segments"), { recursive: true });
    mkdirSync(PROGRESS_DIR, { recursive: true });

    const formData = await req.formData();
    const file = formData.get("video") as File;
    if (!file) return NextResponse.json({ error: "no file" }, { status: 400 });

    // Stream the file to disk while computing the full MD5 in a single pass
    // (no full-file buffer in memory, no second read of the file).
    const hash = createHash("md5");
    const out = createWriteStream(inPath);
    await new Promise<void>((res, rej) => {
      const reader = (file.stream() as ReadableStream<Uint8Array>).getReader();
      out.on("error", rej);
      out.on("finish", () => res());
      const pump = async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            hash.update(value);
            if (!out.write(value)) await new Promise<void>((r) => out.once("drain", r));
          }
          out.end();
        } catch (e) {
          rej(e instanceof Error ? e : new Error(String(e)));
        }
      };
      pump();
    });
    const hashHex = hash.digest("hex");

    // Authoritative server-side dedupe: if an identical file already exists,
    // discard this upload and report the duplicate (no job, no disk waste).
    try {
      const existing = await findDuplicateHash(hashHex, chunkId);
      if (existing) {
        rmSync(dir, { recursive: true, force: true });
        return NextResponse.json({ ok: false, duplicate: true, existingDir: existing });
      }
    } catch {}

    writeFileSync(path.join(dir, "hash.md5"), hashHex, "utf8");
    writeFileSync(path.join(dir, "sig.json"), JSON.stringify(await computeSig(inPath, file.size)));

    try {
      await new Promise<void>((res, rej) => {
        const p = spawn("ffmpeg", ["-v", "quiet", "-i", inPath, "-t", "0.1", "-f", "null", "-"]);
        p.on("close", (c) => (c === 0 ? res() : rej(new Error("invalid"))));
      });
    } catch {
      rmSync(dir, { recursive: true, force: true });
      return NextResponse.json({ error: "corrupt video file" }, { status: 400 });
    }

    writeFileSync(metaPath, JSON.stringify({
      jobId: chunkId,
      dir: `skate-${chunkId}`,
      inPath,
      segDir: path.join(dir, "segments"),
      id: chunkId,
      threshold: req.headers.get("x-threshold") || "0.003",
      minContour: req.headers.get("x-min-contour") || "50",
      minMotionFrames: req.headers.get("x-min-motion-frames") || "8",
      bufferFrames: req.headers.get("x-buffer-frames") || "60",
      historyStr: req.headers.get("x-history") || "300",
      varThreshold: req.headers.get("x-var-threshold") || "25",
      detectShadows: req.headers.get("x-detect-shadows") || "false",
      status: "pending",
      started: Date.now(),
      percent: 5,
      stage: "queued",
    }));

    addRecent({
      dir: `skate-${chunkId}`,
      hash: hashHex,
      originalName: fileName,
      duration: 0,
      uploadedAt: Date.now(),
    }).catch(() => {});

    return NextResponse.json({ ok: true, jobId: chunkId, dir: `skate-${chunkId}`, complete: true, hash: hashHex });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[upload] error:", msg);
    return NextResponse.json({ error: msg || "upload failed" }, { status: 500 });
  }
}
