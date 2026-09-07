import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import { db } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_MS = 500;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  if (!jobId || jobId.includes("..")) {
    return new Response("bad jobId", { status: 400 });
  }

  const logPath = db.jobLogPath(jobId);
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
          const job = db.getJob(jobId);
          if (!job) return;

          let fresh: string[] = [];
          try {
            const all = (await readFile(logPath, "utf8")).split("\n").filter(Boolean);
            fresh = all.slice(logged);
            logged = all.length;
          } catch {}

          if (fresh.length) send("log", fresh);
          send("progress", { percent: job.percent || 0, stage: job.stage || "", status: job.status || "" });

          if (job.status === "done" || job.status === "error") {
            send("done", { status: job.status, result: job.result || null, error: job.error || null });
            clearInterval(interval);
            controller.close();
          }
        } catch {}
      };

      const interval = setInterval(push, POLL_MS);
      push();

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
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