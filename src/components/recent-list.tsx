"use client";

import { useState } from "react";
import { RefreshCw, Trash2, AlertTriangle, X } from "lucide-react";
import type { RecentItem } from "@/lib/editor-types";
import { Button } from "@/components/ui/button";

type Props = {
  items: RecentItem[];
  busy: boolean;
  onReProcess: (dir: string) => void;
  onDelete: (dir: string) => void;
};

export function RecentList({ items, busy, onReProcess, onDelete }: Props) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <h2 className="mb-2 text-sm font-bold text-muted-foreground">Most Recent Uploads</h2>
      {items.map((r) => (
        <article
          key={r.dir}
          className="flex items-start gap-3 rounded-xl border border-border bg-card p-3"
        >
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0"
            aria-label={`Preview ${r.dir}`}
          >
            <video
              src={r.url}
              className="h-20 w-32 rounded-lg border border-border bg-black object-cover transition-colors hover:border-amber-400"
              preload="metadata"
              muted
            />
          </a>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate font-mono text-sm text-amber-400 underline-offset-2 hover:text-amber-300 hover:underline"
            >
              {r.dir}
            </a>
            <span className="text-xs text-muted-foreground">
              {r.date} · {r.durationLabel || "—"}
            </span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Button
                variant="default"
                size="xs"
                onClick={() => onReProcess(r.dir)}
                disabled={busy}
              >
                <RefreshCw aria-hidden />
                Re-process
              </Button>
              <Button
                variant="destructive"
                size="xs"
                onClick={() => setPendingDelete(r.dir)}
                disabled={busy}
              >
                <Trash2 aria-hidden />
                Delete
              </Button>
            </div>
            {pendingDelete === r.dir && (
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                <AlertTriangle className="size-3.5 shrink-0 text-destructive" aria-hidden />
                <span className="text-destructive">
                  Delete {r.dir} and all its segments? This cannot be undone.
                </span>
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={() => {
                    setPendingDelete(null);
                    onDelete(r.dir);
                  }}
                >
                  Delete
                </Button>
                <Button variant="ghost" size="xs" onClick={() => setPendingDelete(null)}>
                  <X aria-hidden />
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}