import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const RESULTS_DIR = path.join(process.cwd(), "..", "public", "results");

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const filePath = path.join(RESULTS_DIR, `skating_final_${id}.mp4`);
  try {
    const buf = await readFile(filePath);
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": "video/mp4", "Content-Length": String(buf.length) },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
