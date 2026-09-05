import { NextRequest } from "next/server";
import path from "node:path";
import { serveFile } from "@/lib/serve-file";
import { RESULTS_DIR } from "@/lib/storage";

export const runtime = "nodejs";

const FILE_RE = /^skating_final_[0-9a-zA-Z_-]{6,32}\.mp4$/;

export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!FILE_RE.test(file)) return new Response("Not Found", { status: 404 });
  return serveFile(req, path.join(RESULTS_DIR, file));
}