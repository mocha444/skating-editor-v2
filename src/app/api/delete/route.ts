import { NextResponse } from "next/server";
import { rm } from "fs/promises";
import path from "path";
import { UPLOADS_DIR, RESULTS_DIR } from "@/lib/storage";
import { db } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData();
  const dir = form.get("dir") as string;
  if (!dir || dir.includes("..") || dir.includes("/")) {
    return NextResponse.json({ error: "invalid dir" }, { status: 400 });
  }

  const id = dir.replace(/^skate-/, "");
  try {
    await Promise.all([
      rm(path.join(UPLOADS_DIR, dir), { recursive: true, force: true }),
      rm(path.join(RESULTS_DIR, `skating_final_${id}.mp4`), { force: true }),
    ]);
    db.deleteJob(id);
    db.removeRecent(dir);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}