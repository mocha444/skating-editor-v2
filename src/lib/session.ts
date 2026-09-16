import type { DetectionSettings } from "@/lib/editor-types";

/**
 * The whole app session, persisted so a reload never loses the pipeline.
 *
 * The flow is fire-and-forget: picking a file starts upload → finalize → queue →
 * process, with no "Process" button. That only works if the UI can rebuild
 * itself after a refresh, so every phase transition is written here and read
 * back on mount.
 *
 * localStorage (not IndexedDB): a few hundred bytes, read synchronously on first
 * paint so there is no flash of "nothing running". Only metadata is stored —
 * never file contents.
 */

export type Phase = "idle" | "uploading" | "ready" | "processing" | "done" | "error";

/** Enough to re-derive the upload id and to tell the user which file to re-pick. */
export type FileIdentity = { name: string; size: number; lastModified: number };

export type PersistedSession = {
  version: 1;
  updatedAt: number;
  phase: Phase;
  file?: FileIdentity;
  uploadId?: string;
  chunkCount?: number;
  sentBytes?: number;
  jobId?: string;
  dir?: string;
  settings?: DetectionSettings;
  error?: string;
};

const KEY = "skate:session";
const TTL_MS = 4 * 60 * 60 * 1000; // matches the retention window; older is meaningless

export function loadSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<PersistedSession>;
    if (!s || s.version !== 1 || typeof s.phase !== "string") return null;
    if (typeof s.updatedAt === "number" && Date.now() - s.updatedAt > TTL_MS) {
      clearSession();
      return null;
    }
    return s as PersistedSession;
  } catch {
    return null;
  }
}

/** Merge a patch into the stored session and persist it. */
export function saveSession(patch: Partial<PersistedSession>): PersistedSession {
  const next: PersistedSession = {
    version: 1,
    updatedAt: Date.now(),
    phase: "idle",
    ...(loadSession() ?? {}),
    ...patch,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — persistence is a nicety, never fail the flow */
  }
  return next;
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

export function identityOf(file: File): FileIdentity {
  return { name: file.name, size: file.size, lastModified: file.lastModified };
}

/**
 * Whether a re-picked file is the one the stored session belongs to. Compares the
 * same triple the upload id derives from, so a match means the server's existing
 * chunks are valid for this file.
 */
export function matchesSession(s: PersistedSession | null, file: File): boolean {
  if (!s?.file) return false;
  return s.file.name === file.name && s.file.size === file.size && s.file.lastModified === file.lastModified;
}
