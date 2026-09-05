import SparkMD5 from "spark-md5";

const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB slices → ~8 MB peak, safe for multi-GB files

/** Incremental client-side MD5 (matches the server's in-stream hash byte-for-byte). */
export async function computeFileHash(file: File): Promise<string> {
  try {
    const spark = new SparkMD5.ArrayBuffer();
    for (let start = 0; start < file.size; start += CHUNK_SIZE) {
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = await file.slice(start, end).arrayBuffer();
      spark.append(chunk);
    }
    return spark.end();
  } catch {
    // Fallback: server-streamed hash (never buffers the whole file in memory).
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/hash", { method: "POST", body: fd });
    const text = await r.text();
    let j: { hash?: string };
    try {
      j = JSON.parse(text);
    } catch {
      throw new Error("Server returned non-JSON: " + text.slice(0, 60));
    }
    if (!r.ok || !j.hash) throw new Error("Hash computation failed");
    return j.hash;
  }
}