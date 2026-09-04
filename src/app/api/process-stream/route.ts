import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { writeFile, mkdir, readFile, readdir, stat } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { existsSync } from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROJECT_ROOT = process.cwd();
const UPLOADS_DIR = path.join(PROJECT_ROOT, "public", "uploads");
const RESULTS_DIR = path.join(PROJECT_ROOT, "public", "results");
const PROGRESS_DIR = path.join(UPLOADS_DIR, "progress");

function sse(data: any) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function runStreamed(cmd: string, args: string[], send: (line: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = "", err = "";
    p.stdout.on("data", d => {
      const text = d.toString();
      out += text;
      text.split("\n").filter(Boolean).forEach(send);
    });
    p.stderr.on("data", d => {
      const text = d.toString();
      err += text;
      text.split("\n").filter(Boolean).forEach(send);
    });
    p.on("close", code => code === 0 ? resolve(out) : reject(new Error(`${cmd} failed: ${err}`)));
  });
}

async function runFfmpeg(args: string[], send: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args);
    let err = "";
    p.stderr.on("data", d => {
      const text = d.toString();
      err += text;
      // Just show key ffmpeg lines
      text.split("\n").filter(l => l.trim()).forEach(line => {
        if (line.includes("frame=") || line.includes("time=") || line.includes("size=") || line.includes("error") || line.includes("Output")) {
          send(line.trim());
        }
      });
    });
    p.on("close", code => code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err.slice(-200)}`)));
  });
}

export async function GET() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: string) => {
        try { controller.enqueue(encoder.encode(sse({ type: "log", line, time: Date.now() }))); } catch {}
      };
      const sendData = (data: any) => {
        try { controller.enqueue(encoder.encode(sse({ type: "data", ...data, time: Date.now() }))); } catch {}
      };
      const sendDone = (data: any) => {
        try { controller.enqueue(encoder.encode(sse({ type: "done", ...data }))); } catch {}
        try { controller.close(); } catch {}
      };
      const sendError = (msg: string) => {
        try { controller.enqueue(encoder.encode(sse({ type: "error", error: msg }))); } catch {}
        try { controller.close(); } catch {}
      };

      try {
        await mkdir(UPLOADS_DIR, { recursive: true });
        await mkdir(RESULTS_DIR, { recursive: true });
        await mkdir(PROGRESS_DIR, { recursive: true });

        // Find latest input
        send("Finding latest upload...");
        const entries = (await readdir(UPLOADS_DIR, { withFileTypes: true }))
          .filter(d => d.isDirectory() && d.name.startsWith("skate-") && !d.name.startsWith("skate-process"));

        if (!entries.length) { sendError("no uploads"); return; }

        const withMtime = await Promise.all(
          entries.map(async d => {
            const s = await stat(path.join(UPLOADS_DIR, d.name, "input.mp4"));
            return { name: d.name, mtime: s.mtimeMs };
          })
        );
        withMtime.sort((a, b) => b.mtime - a.mtime);
        const latestDir = withMtime[0].name;
        const inPath = path.join(UPLOADS_DIR, latestDir, "input.mp4");
        const segDir = path.join(UPLOADS_DIR, latestDir, "segments");
        await mkdir(segDir, { recursive: true });

        const fileSize = (await stat(inPath)).size;
        send(`Loaded ${latestDir} (${(fileSize/1e6).toFixed(1)} MB)`);

        const id = randomUUID().slice(0, 8);
        const outDir = path.join(UPLOADS_DIR, `skate-process-${id}`);
        await mkdir(outDir, { recursive: true });

        // 1) Motion detection
        send("▶ Starting MOG2 motion detection...");
        sendData({ step: "detect" });
        const detectOut = await runStreamed("python3", [
          path.join(PROJECT_ROOT, "scripts", "process_video.py"),
          inPath, segDir,
        ], send);
        const { segments } = JSON.parse(detectOut);

        if (!segments || !segments.length) {
          sendError("no motion detected");
          return;
        }
        send(`✓ Found ${segments.length} segments: ${segments.map((s: any) => `${s[0].toFixed(1)}s→${s[1].toFixed(1)}s`).join(", ")}`);

        // 2) Cut each segment
        sendData({ step: "cut", total: segments.length });
        const segFiles: string[] = [];
        for (let i = 0; i < segments.length; i++) {
          const [s, e] = segments[i];
          if (e - s < 0.5) continue;
          const f = path.join(segDir, `seg-${i}.mp4`);
          send(`▶ Cutting segment ${i+1}/${segments.length}: ${s.toFixed(2)}s → ${e.toFixed(2)}s (${(e-s).toFixed(1)}s)`);
          await runFfmpeg(["-y", "-ss", String(s), "-i", inPath, "-t", String(e - s), "-c", "copy", f], send);
          segFiles.push(f);
          sendData({ step: "cut", done: i + 1, total: segments.length });
        }

        // 3) Concat
        send("▶ Joining all segments into final video...");
        sendData({ step: "concat" });
        const listPath = path.join(outDir, "list.txt");
        await writeFile(listPath, segFiles.map(f => `file '${f}'`).join("\n"));
        const finalPath = path.join(RESULTS_DIR, `skating_final_${id}.mp4`);
        await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", finalPath], send);

        const segDirUrl = `/uploads/${latestDir}/segments`;
        const segUrls = (segments as [number, number][]).map((_, i) => `${segDirUrl}/seg-${i}.mp4`);
        const finalUrl = `/results/skating_final_${id}.mp4`;

        const finalSize = (await stat(finalPath)).size;
        send(`✓ Final video built (${(finalSize/1e6).toFixed(1)} MB)`);

        sendDone({
          ok: true,
          segments: segments.length,
          duration: segments.reduce((a: number, [s, e]: number[]) => a + (e - s), 0),
          finalUrl,
          rawSegments: segments,
          segUrls,
        });
      } catch (e: any) {
        sendError(e.message);
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
