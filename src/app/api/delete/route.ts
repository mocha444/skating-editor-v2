import { NextResponse } from "next/server";
import { rm, stat } from "fs/promises";
import path from "path";
import { UPLOADS_DIR } from "@/lib/storage";

export const runtime = "nodejs";

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