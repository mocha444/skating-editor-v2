import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "no file" }, { status: 400 });

  const buffer = await file.arrayBuffer();
  const hash = createHash("md5").update(Buffer.from(buffer)).digest("hex");
  return NextResponse.json({ hash });
}
