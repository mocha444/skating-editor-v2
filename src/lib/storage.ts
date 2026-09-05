import path from "node:path";
import { randomUUID } from "node:crypto";

const DATA_ROOT = process.env.DATA_DIR || path.join(process.cwd(), "data");

export const UPLOADS_DIR = path.join(DATA_ROOT, "uploads");
export const RESULTS_DIR = path.join(DATA_ROOT, "results");
export const PROGRESS_DIR = path.join(DATA_ROOT, "progress");

export function newJobId(): string {
  let id = randomUUID().slice(0, 8);
  while (/^\d+$/.test(id)) id = randomUUID().slice(0, 8);
  return id;
}

export function isSafeSegment(name: string): boolean {
  return !name.includes("..") && !name.includes("/") && !name.includes("\\");
}