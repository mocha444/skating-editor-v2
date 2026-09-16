"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import { fmtBytes } from "@/lib/editor-types";
import { Button } from "@/components/ui/button";

export type VideoEntry = {
  dir: string;
  name: string;
  size: number;
  mtime: number;
  hasInput: boolean;
  jobId?: string;
  status?: string;
  finalUrl?: string;
  downloadUrl?: string;
  segments?: number;
  duration?: number;
};

type Props = {
  busy: boolean;
  refreshKey: number;
  currentDir?: string | null;
  onReprocess: (dir: string) => void;
  onDeleted: (dir: string) => void;
};

function fmtDate(ms: number) {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
}

export function VideosList({ busy, refreshKey, currentDir, onReprocess, onDeleted }: Props) {
  const [items, setItems] = useState<VideoEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmDir, setConfirmDir] = useState<string | null>(null);
  const [deletingDir, setDeletingDir] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/videos", { cache: "no-store" });
      const j = await r.json();
      setItems(Array.isArray(j.videos) ? j.videos : []);
    } catch {
      setError("Couldn't list saved videos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function doDelete(dir: string) {
    if (busy || deletingDir) return;
    setDeletingDir(dir);
    try {
      const fd = new FormData();
      fd.append("dir", dir);
      const r = await fetch("/api/delete", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || "Delete failed");
      setConfirmDir(null);
      onDeleted(dir);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingDir(null);
    }
  }

  return (
    <section className="w-full rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-muted-foreground">
          Saved videos{items.length > 0 ? ` (${items.length})` : ""}
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}

      {items.length === 0 && !loading && !error && (
        <p className="mt-2 text-xs text-muted-foreground">Nothing saved yet — processed videos show up here.</p>
      )}

      {items.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {items.map((v) => {
            const isCurrent = currentDir != null && v.dir === currentDir;
            const confirming = confirmDir === v.dir;
            const deleting = deletingDir === v.dir;
            return (
              <li
                key={v.dir}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs"
              >
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block truncate font-semibold" title={v.dir}>
                    {v.name}
                    {isCurrent && <span className="ml-1.5 font-normal text-muted-foreground">(on screen)</span>}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {fmtBytes(v.size)}{v.mtime ? ` · ${fmtDate(v.mtime)}` : ""}
                    {typeof v.segments === "number" ? ` · ${v.segments} clips` : ""}
                  </span>
                </span>
                {v.finalUrl && (
                  <a
                    href={v.finalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                    title="Open final video"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                    Open
                  </a>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onReprocess(v.dir)}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                  title="Re-process with current settings"
                >
                  <RefreshCw className="size-3.5" aria-hidden />
                  Re-process
                </button>
                {confirming ? (
                  <span className="inline-flex items-center gap-1">
                    <Button
                      variant="destructive"
                      size="xs"
                      disabled={busy || deleting}
                      onClick={() => void doDelete(v.dir)}
                    >
                      {deleting ? "Deleting…" : "Confirm"}
                    </Button>
                    <Button variant="ghost" size="xs" disabled={deleting} onClick={() => setConfirmDir(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmDir(v.dir)}
                    aria-label={`Delete ${v.name}`}
                    title="Delete"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    Delete
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
