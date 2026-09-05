import { NextResponse } from "next/server";
import { rm, stat } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
const PROJECT_ROOT = process.cwd();
const UPLOADS_DIR = path.join(PROJECT_ROOT, "public", "uploads");

export async function POST(req: Request) {
  const form = await req.formData();
  const dir = form.get("dir") as string;
  if (!dir || dir.includes("..") || dir.includes("/")) {
    return NextResponse.json({ error: "invalid dir" }, { status: 400 });
  }
  const target = path.join(UPLOADS_DIR, dir);
  try {
    const s = await stat(target);
    if (!s.isDirectory()) return NextResponse.json({ error: "not a dir" }, { status: 400 });
    await rm(target, { recursive: true, force: true });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}