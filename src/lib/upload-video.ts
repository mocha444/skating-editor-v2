import SparkMD5 from "spark-md5";
import type { DetectionSettings } from "@/lib/editor-types";

export type UploadProgressSnapshot = {
  loaded: number;
  total: number;
  percent: number;
  speedBps: number;
};

export type UploadResponse = {
  ok?: boolean;
  jobId?: string;
  dir?: string;
  duplicate?: boolean;
  existingDir?: string;
  error?: string;
};

const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB — must match the server
const MAX_CHUNK_ATTEMPTS = 3;

/**
 * Resumable, chunked upload.
 *
 * - The file is split into fixed-size chunks and uploaded one by one.
 * - A stable uploadId (derived from name+size+mtime) lets an interrupted
 *   upload resume: the server reports which chunks it already has, we skip
 *   them, and only missing chunks are (re)sent.
 * - A failed chunk is retried a few times before surfacing the error.
 *
 * Returns the same { status, json } shape the old single-POST uploader used.
 */
export async function uploadFormData(
  file: File,
  settings: DetectionSettings,
  onProgress: (p: UploadProgressSnapshot) => void
): Promise<{ status: number; json: UploadResponse }> {
  const uploadId = uploadIdFor(file);
  const chunkCount = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

  // Ask the server which chunks are already on disk (resume after a disconnect).
  let serverChunks = new Set<number>();
  try {
    const st = await fetch(`/api/upload?op=status&uploadId=${encodeURIComponent(uploadId)}`).then((r) => r.json());
    if (Array.isArray(st.completed)) serverChunks = new Set(st.completed.map(Number));
  } catch {}
  // Remember this session so re-selecting the same file resumes it.
  try {
    localStorage.setItem(`skate:up:${file.name}:${file.size}`, uploadId);
  } catch {}

  const startTime = Date.now();
  let uploadedBytes = 0;
  for (const i of serverChunks) uploadedBytes += chunkLength(file, i);

  function emit() {
    const now = Date.now();
    const elapsed = Math.max(1, (now - startTime) / 1000);
    onProgress({
      loaded: uploadedBytes,
      total: file.size,
      percent: file.size > 0 ? (uploadedBytes / file.size) * 100 : 100,
      speedBps: uploadedBytes / elapsed,
    });
  }

  for (let i = 0; i < chunkCount; i++) {
    if (serverChunks.has(i)) continue;

    let ok = false;
    for (let attempt = 1; attempt <= MAX_CHUNK_ATTEMPTS && !ok; attempt++) {
      try {
        await uploadChunk(file, uploadId, i, chunkCount);
        ok = true;
        uploadedBytes += chunkLength(file, i);
        serverChunks.add(i);
        emit();
      } catch (e) {
        if (attempt === MAX_CHUNK_ATTEMPTS) throw e;
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }

  try { localStorage.removeItem(`skate:up:${file.name}:${file.size}`); } catch {}

  return finalize(file, settings, uploadId);
}

function chunkLength(file: File, index: number): number {
  return Math.min(CHUNK_SIZE, file.size - index * CHUNK_SIZE);
}

// Stable id derived from the file's identity. Uses SparkMD5 (not crypto.subtle)
// because crypto.subtle requires a secure context (HTTPS/localhost) and this app
// is also served over a plain-HTTP LAN address.
function uploadIdFor(file: File): string {
  const key = `${file.name}:${file.size}:${file.lastModified}`;
  return "u" + SparkMD5.hash(key).slice(0, 12);
}

function uploadChunk(file: File, uploadId: string, index: number, chunkCount: number): Promise<void> {
  const blob = file.slice(index * CHUNK_SIZE, Math.min((index + 1) * CHUNK_SIZE, file.size));
  const fd = new FormData();
  fd.append("chunk", blob, `chunk-${index}`);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload?op=chunk");
    xhr.setRequestHeader("x-upload-id", uploadId);
    xhr.setRequestHeader("x-chunk-index", String(index));
    xhr.setRequestHeader("x-chunk-count", String(chunkCount));
    xhr.setRequestHeader("x-file-size", String(file.size));
    xhr.setRequestHeader("x-file-name", file.name);
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.ontimeout = () => reject(new Error("Upload timed out."));
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText) as UploadResponse;
        if (xhr.status >= 200 && xhr.status < 300 && j.ok) resolve();
        else reject(new Error(j.error || `Upload chunk ${index} failed (${xhr.status}).`));
      } catch {
        reject(new Error(`Server returned an unexpected response (${xhr.status}).`));
      }
    };
    xhr.send(fd);
  });
}

async function finalize(
  file: File,
  settings: DetectionSettings,
  uploadId: string
): Promise<{ status: number; json: UploadResponse }> {
  const res = await fetch(`/api/upload?op=finalize`, {
    method: "POST",
    headers: {
      "x-upload-id": uploadId,
      "x-file-size": String(file.size),
      "x-file-name": file.name,
      "x-threshold": settings.threshold,
      "x-min-contour": settings.minContour,
      "x-min-motion-frames": settings.minMotionFrames,
      "x-buffer-frames": settings.bufferFrames,
      "x-history": settings.history,
      "x-var-threshold": settings.varThreshold,
      "x-detect-shadows": settings.detectShadows,
    },
    body: new FormData(),
  });
  let json: UploadResponse = {};
  try {
    json = (await res.json()) as UploadResponse;
  } catch {}
  return { status: res.status, json };
}