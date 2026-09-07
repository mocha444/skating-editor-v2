import { mkdir, rename, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_ROOT } from "@/lib/storage";

export type RecentEntry = {
  dir: string;
  hash: string;
  originalName: string;
  duration: number;
  uploadedAt: number;
};

const RECENT_FILE = path.join(DATA_ROOT, "recent.json");
const MAX_RECENT = 30;

async function readEntries(): Promise<RecentEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(RECENT_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeEntries(list: RecentEntry[]): Promise<void> {
  await mkdir(path.dirname(RECENT_FILE), { recursive: true });
  const tmp = RECENT_FILE + ".tmp";
  await writeFile(tmp, JSON.stringify(list.slice(0, MAX_RECENT), null, 2));
  await rename(tmp, RECENT_FILE);
}

export async function listRecent(): Promise<RecentEntry[]> {
  return (await readEntries()).sort((a, b) => b.uploadedAt - a.uploadedAt);
}

export async function addRecent(entry: RecentEntry): Promise<void> {
  const list = await readEntries();
  await writeEntries([entry, ...list.filter((e) => e.dir !== entry.dir)]);
}

export async function updateRecent(dir: string, patch: Partial<RecentEntry>): Promise<void> {
  const list = await readEntries();
  await writeEntries(list.map((e) => (e.dir === dir ? { ...e, ...patch } : e)));
}

export async function removeRecent(dir: string): Promise<void> {
  const list = await readEntries();
  await writeEntries(list.filter((e) => e.dir !== dir));
}
