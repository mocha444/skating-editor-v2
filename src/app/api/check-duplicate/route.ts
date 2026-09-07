import { NextResponse } from "next/server";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { UPLOADS_DIR } from "@/lib/storage";

type Sig = { size: number; head: string; tail: string };

function isSig(v: unknown): v is Sig {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.size === "number" &&
    typeof s.head === "string" &&
    typeof s.tail === "string"
  );
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const hash = searchParams.get("hash") || "";

  const sizeRaw = searchParams.get("size");
  const head = searchParams.get("head") || "";
  const tail = searchParams.get("tail") || "";
  const size = sizeRaw !== null && sizeRaw !== "" ? Number(sizeRaw) : NaN;
  const sig: Sig | null =
    Number.isFinite(size) && head && tail ? { size, head, tail } : null;

  if (!hash && !sig) return NextResponse.json({ duplicate: false });

  try {
    const entries = await readdir(UPLOADS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("skate-")) continue;

      // Full-hash match (authoritative) — also matches legacy uploads.
      if (hash) {
        try {
          const stored = (await readFile(path.join(UPLOADS_DIR, entry.name, "hash.md5"), "utf8")).trim();
          if (stored === hash) return NextResponse.json({ duplicate: true, dir: entry.name });
        } catch {}
      }

      // Fast signature match (size + head + tail MD5). Only for uploads that
      // have a sig.json (i.e. created after this feature). A sig match is a
      // strong hint; the client confirms with a full hash before deciding.
      if (sig) {
        try {
          const parsed: unknown = JSON.parse(
            await readFile(path.join(UPLOADS_DIR, entry.name, "sig.json"), "utf8")
          );
          if (
            isSig(parsed) &&
            parsed.size === sig.size &&
            parsed.head === sig.head &&
            parsed.tail === sig.tail
          ) {
            return NextResponse.json({ duplicate: true, dir: entry.name });
          }
        } catch {}
      }
    }
  } catch {}

  return NextResponse.json({ duplicate: false });
}
