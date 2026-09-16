"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Download, RefreshCw, Trash2 } from "lucide-react";
import type { Result } from "@/lib/editor-types";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  result: Result;
  busy?: boolean;
  onProcessAnother: () => void;
  /** Called the moment the user downloads the final video (used to skip the destructive confirm later). */
  onDownloaded?: (dir?: string) => void;
  /** Re-run motion detection on the same source with the current settings. */
  onReprocess?: (dir: string) => void;
};

function fmt(s?: number) {
  return `${(s ?? 0).toFixed(1)}s`;
}
function fmtHuman(s?: number) {
  if (!s || Number.isNaN(s) || s < 0) return "";
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}m ${sec}s`;
}
function fmtClock(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const msec = Math.floor((s % 1) * 10);
  return `${m}:${sec.toString().padStart(2, "0")}.${msec}`;
}
function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export function ResultCard({ result, busy, onProcessAnother, onDownloaded, onReprocess }: Props) {
  const downloadUrl = `/api/download/${result.jobId}`;

  const lengths = useMemo(
    () =>
      result.rawSegments.map((seg, i) => {
        const srcLen = seg[1] - seg[0];
        return result.segDurations?.[i] && result.segDurations[i] > 0
          ? result.segDurations[i]
          : srcLen;
      }) || [],
    [result.rawSegments, result.segDurations],
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [deletedSegments, setDeletedSegments] = useState<Set<number>>(new Set());

  // NOTE: the parent remounts this card per job (key={result.jobId}), so a
  // new result always starts with empty trash — no reset effect needed.

  // Indices surviving the trash, in order. The trimmed preview and the
  // trimmed download are both built from exactly these clips.
  const keptIndices = useMemo(
    () =>
      result.rawSegments.map((_, i) => i).filter((i) => !deletedSegments.has(i)),
    [result.rawSegments, deletedSegments],
  );
  // keptPosOf[originalIndex] = position inside the trimmed preview/download.
  const keptPosOf = useMemo(() => {
    const m = new Map<number, number>();
    keptIndices.forEach((orig, pos) => m.set(orig, pos));
    return m;
  }, [keptIndices]);
  const keptLengths = useMemo(
    () => keptIndices.map((i) => lengths[i] ?? 0),
    [keptIndices, lengths],
  );
  const keptStarts = useMemo<number[]>(() => {
    const arr: number[] = [];
    let acc = 0;
    for (const len of keptLengths) {
      arr.push(acc);
      acc += len;
    }
    return arr;
  }, [keptLengths]);
  function accOf(arr: number[]) {
    return arr.reduce((a, b) => a + b, 0);
  }
  const keptDuration = accOf(keptLengths);
  const total = Math.max(keptDuration, 1);

  const toggleDelete = (i: number) => {
    setDeletedSegments((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  // Position inside the TRIMMED preview (kept-only timeline).
  const activeSeg = (t: number): number => {
    for (let i = keptStarts.length - 1; i >= 0; i--) {
      if (t >= keptStarts[i] - 0.05) return i;
    }
    return -1;
  };
  // Active ORIGINAL clip index (for row highlight), -1 when nowhere.
  const activeKeptPos = activeSeg(currentTime);
  const active = activeKeptPos >= 0 ? (keptIndices[activeKeptPos] ?? -1) : -1;

  const remainingCount = keptIndices.length;
  const clip = remainingCount === 1 ? "clip" : "clips";
  const facts = `${remainingCount} ${clip} — ${fmt(keptDuration)} of skating`;
  const removed =
    result.sourceDuration && result.sourceDuration > result.duration
      ? result.sourceDuration - result.duration
      : 0;
  const removedLabel = fmtHuman(removed);

  const excludedParam = [...deletedSegments].sort((a, b) => a - b).join(",");
  const downloadHref =
    deletedSegments.size > 0
      ? `${downloadUrl}?excludeSegments=${encodeURIComponent(excludedParam)}`
      : downloadUrl;
  // The player previews the exact file the download serves: untrimmed it is
  // the final video, trimmed it is the server-side re-concat. `key` on the
  // <video> below forces a reload whenever this changes.
  const previewUrl = deletedSegments.size > 0 ? downloadHref : result.finalUrl;
  const allRemoved = remainingCount === 0;

  const playSeg = useCallback(
    (keptPos: number) => {
      const v = videoRef.current;
      if (!v) return;
      setCurrentTime(keptStarts[keptPos] ?? 0);
      v.currentTime = keptStarts[keptPos] ?? 0;
      void v.play();
    },
    [keptStarts],
  );

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const v = videoRef.current;
      const bar = barRef.current;
      if (!v || !bar) return;
      const rect = bar.getBoundingClientRect();
      const frac = clamp((clientX - rect.left) / rect.width, 0, 1);
      const t = frac * v.duration;
      setCurrentTime(t);
      v.currentTime = t;
      void v.play();
    },
    [],
  );

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="overflow-hidden rounded-2xl border border-border bg-card p-5">
        <h2 className="text-lg font-bold">{facts}</h2>
        {removedLabel && (
          <p className="text-sm text-muted-foreground">
            Removed {removedLabel} of dead air.
          </p>
        )}

        {/* Player + segment timeline */}
        <div className="mt-4 space-y-2">
          {allRemoved ? (
            <p role="status" className="rounded-xl bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
              All clips removed — restore at least one below to preview or download.
            </p>
          ) : (
            <video
              ref={videoRef}
              key={previewUrl}
              controls
              preload="metadata"
              className="w-full rounded-xl"
              src={previewUrl}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onLoadedMetadata={() => setCurrentTime(0)}
            />
          )}
          {deletedSegments.size > 0 && !allRemoved && (
            <p role="status" className="text-xs text-muted-foreground">
              Previewing the download without {deletedSegments.size} removed{" "}
              {deletedSegments.size === 1 ? "clip" : "clips"}.
            </p>
          )}

          <div
            ref={barRef}
            role="slider"
            aria-label="Seek within video"
            aria-valuemin={0}
            aria-valuemax={Math.round(total)}
            aria-valuenow={Math.round(currentTime)}
            tabIndex={0}
            onClick={(e) => seekFromEvent(e.clientX)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") {
                const v = videoRef.current;
                if (!v) return;
                v.currentTime = Math.min(v.duration, v.currentTime + 1);
              } else if (e.key === "ArrowLeft") {
                const v = videoRef.current;
                if (!v) return;
                v.currentTime = Math.max(0, v.currentTime - 1);
              }
            }}
            className="group relative h-6 w-full cursor-pointer touch-none select-none rounded-md"
          >
            {/* thin track line */}
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
            {/* one primary bar per KEPT segment, positioned in preview-video time */}
            {keptStarts.map((st, pos) => {
              const left = (st / total) * 100;
              const width = (keptLengths[pos] / total) * 100;
              const orig = keptIndices[pos];
              return (
                <div
                  key={orig}
                  className={cn(
                    "absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full transition-colors",
                    active === orig
                      ? "bg-primary"
                      : "bg-primary/60 hover:bg-primary/90",
                  )}
                  style={{ left: `${left}%`, width: `max(0.6%, ${width}%)` }}
                />
              );
            })}
            {/* playhead */}
            <div
              className="pointer-events-none absolute inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
              style={{ left: `${(currentTime / total) * 100}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{fmtClock(currentTime)}</span>
            <span className="text-primary">
              {active >= 0 ? `Clip ${active + 1}` : ""}
            </span>
            <span>{fmtClock(total)}</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <a
            href={allRemoved ? undefined : downloadHref}
            onClick={(e) => {
              if (allRemoved) {
                e.preventDefault();
                return;
              }
              onDownloaded?.(result.dir);
            }}
            aria-disabled={allRemoved}
            className={cn(
              buttonVariants({ variant: "default" }),
              allRemoved && "pointer-events-none opacity-50",
            )}
          >
            <Download aria-hidden />
            {deletedSegments.size > 0
              ? `Download video (${remainingCount} ${remainingCount === 1 ? "clip" : "clips"})`
              : "Download video"}
          </a>
          {result.dir && onReprocess && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onReprocess(result.dir as string)}
              title="Run motion detection again on this video with the current settings"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
            >
              <RefreshCw className="size-4" aria-hidden />
              Re-process
            </button>
          )}
        </div>

        <div className="mt-4 space-y-2" role="list">
          <p className="text-sm font-semibold text-muted-foreground">
            Segments — click a clip to play it (click a removed one to restore it), or tap the trash to remove it from the preview and download:
          </p>
          {result.rawSegments.map((seg, i) => {
            const [s, e] = seg;
            const actual = result.actualSegments?.[i];
            const realStart = actual ? actual[0] : s;
            const realEnd = actual ? actual[1] : e;
            const realLen = actual
              ? actual[1] - actual[0]
              : result.segDurations?.[i] ?? e - s;
            const isActive = active === i;
            const isDeleted = deletedSegments.has(i);
            // The download API refuses an empty edit, so the last surviving
            // clip can't be trashed — restore one first.
            const trashDisabled = !isDeleted && remainingCount <= 1;
            const keptPos = keptPosOf.get(i);
            return (
              <div
                key={i}
                role="listitem"
                tabIndex={0}
                onClick={() => {
                  if (isDeleted) toggleDelete(i);
                  else if (keptPos !== undefined) playSeg(keptPos);
                }}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    if (isDeleted) toggleDelete(i);
                    else if (keptPos !== undefined) playSeg(keptPos);
                  }
                }}
                title={
                  isDeleted
                    ? "Removed from preview and download — click to restore"
                    : `Play clip ${i + 1}`
                }
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  isDeleted
                    ? "opacity-40 bg-muted"
                    : isActive
                      ? "bg-primary/15 ring-1 ring-primary/60"
                      : "bg-muted hover:bg-muted/70",
                )}
              >
                <span className="flex min-w-0 items-center gap-2 font-medium text-primary">
                  <span
                    className={cn("truncate", isDeleted && "line-through decoration-destructive/70")}
                    title={`detected ${fmt(s)} → ${fmt(e)}`}
                  >
                    Clip {i + 1} — {fmt(realStart)} → {fmt(realEnd)} ·{" "}
                    {fmt(realLen)}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={trashDisabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleDelete(i);
                  }}
                  aria-label={
                    isDeleted
                      ? `Restore clip ${i + 1}`
                      : trashDisabled
                        ? `Cannot remove the last clip`
                        : `Remove clip ${i + 1}`
                  }
                  title={isDeleted ? "Restore" : trashDisabled ? "Cannot remove the last clip" : "Remove"}
                  className={cn(
                    "shrink-0 rounded p-1 transition-colors",
                    isDeleted
                      ? "text-destructive hover:bg-destructive/10"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    trashDisabled && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground",
                  )}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <Button variant="secondary" className="self-center" onClick={onProcessAnother}>
        Process another
      </Button>
    </div>
  );
}
