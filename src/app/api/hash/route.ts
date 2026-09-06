import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import busboy from "busboy";
import { Readable } from "stream";
import { createHash } from "crypto";
import type { ReadableStream as WebReadableStream } from "stream/web";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  await auth.protect();
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const bb = busboy({ headers: { "content-type": contentType } });
  const hash = createHash("md5");
  let fileSeen = false;
  const hashError: { current: Error | null } = { current: null };

  bb.on("file", (name, stream) => {
    if (name !== "file") { stream.resume(); return; }
    fileSeen = true;
    stream.on("data", (d: Buffer) => hash.update(d));
  });

  bb.on("error", (e: unknown) => {
    hashError.current = e instanceof Error ? e : new Error(String(e));
  });

  const multipartDone = new Promise<void>((resolve) => {
    bb.on("close", () => resolve());
  });

  const bodyStream = Readable.fromWeb(req.body as unknown as WebReadableStream);
  bodyStream.on("error", () => {});
  bodyStream.pipe(bb);

  await multipartDone;

  if (hashError.current) {
    return NextResponse.json({ error: "upload failed: " + hashError.current.message }, { status: 400 });
  }
  if (!fileSeen) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }

  return NextResponse.json({ hash: hash.digest("hex") });
}