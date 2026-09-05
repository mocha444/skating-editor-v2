import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".md5": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export interface ServeOptions {
  onFinish?: () => void;
}

export async function serveFile(req: Request, absPath: string, opts: ServeOptions = {}): Promise<Response> {
  let info;
  try {
    info = await stat(absPath);
  } catch {
    if (opts.onFinish) opts.onFinish();
    return new Response("Not Found", { status: 404 });
  }
  if (!info.isFile()) {
    if (opts.onFinish) opts.onFinish();
    return new Response("Not Found", { status: 404 });
  }

  const ext = path.extname(absPath).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";
  const total = info.size;
  const rangeHeader = req.headers.get("range");
  let status = 200;
  let start = 0;
  let end = total - 1;

  if (rangeHeader) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (m && (m[1] !== "" || m[2] !== "")) {
      if (m[1] === "") {
        const suffix = Number(m[2]);
        start = Math.max(total - suffix, 0);
      } else {
        start = Number(m[1]);
        end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
      }
      if (start > end || start >= total) {
        const resp = new Response("Range Not Satisfiable", {
          status: 416,
          headers: { "Content-Range": `bytes */${total}` },
        });
        if (opts.onFinish) opts.onFinish();
        return resp;
      }
      status = 206;
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (status === 206) {
    headers["Content-Range"] = `bytes ${start}-${end}/${total}`;
  }

  const stream = createReadStream(absPath, { start, end });
  if (opts.onFinish) {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      opts.onFinish?.();
    };
    stream.on("close", finish);
    stream.on("error", finish);
  }

  return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
    status,
    headers,
  });
}