import { NextRequest } from "next/server";
import { unwatchFile, watchFile } from "fs";
import { readFile } from "fs/promises";
import path from "path";
import { PROGRESS_DIR } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  if (!jobId || jobId.includes("..")) {
    return new Response("bad jobId", { status: 400 });
  }

  const metaPath = path.join(PROGRESS_DIR, jobId + ".json");
  const logPath = path.join(PROGRESS_DIR, jobId + ".log");

  const encoder = new TextEncoder();
  let closed = false;
  let logged = 0;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };

      const push = async () => {
        try {
          let logs: string[] = [];
          try {
            logs = (await readFile(logPath, "utf8")).split("\n").filter(Boolean);
          } catch {}
          const meta = JSON.parse(await readFile(metaPath, "utf8"));
          const fresh = logs.slice(logged);
          if (fresh.length) send("log", fresh);
          logged = logs.length;
          send("progress", { percent: meta.percent || 0, stage: meta.stage || "", status: meta.status || "" });

          if (meta.status === "done" || meta.status === "error") {
            send("done", { status: meta.status, result: meta.result || null, error: meta.error || null });
            clearInterval(interval);
            controller.close();
          }
        } catch {}
      };

      watchFile(metaPath, { interval: 400 }, push);
      const interval = setInterval(push, 400);
      push();

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        try { unwatchFile(metaPath); } catch {}
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
