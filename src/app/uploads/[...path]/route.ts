import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import path from "node:path";
import { serveFile } from "@/lib/serve-file";
import { UPLOADS_DIR } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  await auth.protect();
  const segs = (await params).path;
  if (!Array.isArray(segs) || segs.length === 0) return new Response("Not Found", { status: 404 });
  const rel = segs.join("/");
  if (rel.includes("..") || rel.startsWith("/") || rel.includes("\0")) return new Response("Not Found", { status: 404 });
  const abs = path.join(UPLOADS_DIR, ...segs);
  if (!abs.startsWith(UPLOADS_DIR + path.sep)) return new Response("Not Found", { status: 404 });
  return serveFile(req, abs);
}