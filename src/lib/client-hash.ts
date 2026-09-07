import SparkMD5 from "spark-md5";

const CHUNK_SIZE = 8 * 1024 * 1024;

export async function computeFileHash(file: File): Promise<string> {
  const spark = new SparkMD5.ArrayBuffer();
  for (let start = 0; start < file.size; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, file.size);
    spark.append(await file.slice(start, end).arrayBuffer());
  }
  return spark.end();
}

// --- Fast duplicate pre-screen ----------------------------------------------
// Instead of hashing the whole file (slow for multi-GB videos), we hash only
// the first + last SIG_BYTES. Identical files always produce an identical
// signature, so this can never miss a true duplicate. A mismatched signature
// is proof the file is new, so the full upload can start immediately.
// Matching signatures are the rare "possible duplicate" case and are then
// confirmed with a full-file hash before any upload happens.
const SIG_BYTES = 1024 * 1024; // 1 MiB each end

export type FileSig = { size: number; head: string; tail: string };

async function md5Range(file: File, start: number, end: number): Promise<string> {
  const spark = new SparkMD5.ArrayBuffer();
  spark.append(await file.slice(start, end).arrayBuffer());
  return spark.end();
}

export async function computeFileSig(file: File): Promise<FileSig> {
  const size = file.size;
  if (size <= SIG_BYTES) {
    // Small file: the "head" range covers the whole file.
    const whole = await md5Range(file, 0, size);
    return { size, head: whole, tail: whole };
  }
  const head = await md5Range(file, 0, SIG_BYTES);
  const tail = await md5Range(file, size - SIG_BYTES, size);
  return { size, head, tail };
}
