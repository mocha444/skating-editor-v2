"use client";

import { useCallback, useRef, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import type { Result } from "@/lib/editor-types";
import { Button, buttonVariants } from "@/components/ui/button";
import { Confetti } from "@/components/confetti";
import { cn } from "@/lib/utils";

type Props = {
  result: Result;
  onProcessAnother: () => void;
  /** Called the moment the user downloads the final video (used to skip the destructive confirm later). */
  onDownloaded?: (dir?: string) => void;
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

export function ResultCard({ result, onProcessAnother, onDownloaded }: Props) {
  const clip = result.segments === 1 ? "clip" : "clips";
  const downloadUrl = `/api/download/${result.jobId}`;

  // Per-clip position in the FINAL (concatenated) video. The player plays the
  // final file, so we map the source-timestamp segments onto cumulative offsets.
  const lengths =
    result.rawSegments.map((seg, i) => {
      const srcLen = seg[1] - seg[0];
      return result.segDurations?.[i] && result.segDurations[i] > 0 ? result.segDurations[i] : srcLen;
    }) || [];
  const starts: number[] = [];
  {
    let acc = 0;
    for (const len of lengths) {
      starts.push(acc);
      acc += len;
    }
  }
  const total = Math.max(result.duration || accOf(lengths), accOf(lengths), 1);
  function accOf(arr: number[]) {
    return arr.reduce((a, b) => a + b, 0);
  }

  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const activeSeg = (t: number): number => {
    for (let i = starts.length - 1; i >= 0; i--) {
      if (t >= starts[i] - 0.05) return i;
    }
    return -1;
  };
  const active = activeSeg(currentTime);

  const playSeg = useCallback(
    (i: number) => {
      const v = videoRef.current;
      if (!v) return;
      setCurrentTime(starts[i] ?? 0);
      v.currentTime = starts[i] ?? 0;
      void v.play();
    },
    [starts]
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
    []
  );

  const headline =
    result.segments === 1
      ? "🎬 One clean cut!"
      : result.segments <= 3
        ? "🎬 Caught"
        : "🎬 Jam packed!";
  const quips = [
    "Sliced to perfection 🌶️",
    "Bangers only 🔥",
    "Skate edit goes nuts ⚡",
    "Drop the deck! 🛹",
    "Peak skating, zero filler ✨",
  ];
  const quip = quips[result.segments % quips.length];
  const facts = `${result.segments} ${clip} — ${fmt(result.duration)} of skating`;
  const removed =
    result.sourceDuration && result.sourceDuration > result.duration
      ? result.sourceDuration - result.duration
      : 0;
  const removedLabel = fmtHuman(removed);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="relative space-y-4 overflow-hidden rounded-2xl border border-border bg-card p-6">
        <Confetti />
        <div className="animate-pop space-y-1">
          <h2 className="text-xl font-extrabold">
            <span className="bg-gradient-to-r from-amber-400 via-orange-500 to-pink-500 bg-clip-text text-transparent">
              {headline}
            </span>{" "}
            {facts}!
          </h2>
          <p className="text-sm text-muted-foreground">{quip}</p>
          {removedLabel && (
            <p className="text-sm font-bold text-amber-400">
              ✂️ Removed {removedLabel} of dead air!
            </p>
          )}
        </div>

        {/* Player + segment timeline */}
        <div className="space-y-2">
          <video
            ref={videoRef}
            controls
            preload="metadata"
            className="w-full rounded-xl"
            src={result.finalUrl}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={() => setCurrentTime(0)}
          />

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
            {/* one amber bar per segment, positioned in final-video time */}
            {starts.map((st, i) => {
              const left = (st / total) * 100;
              const width = (lengths[i] / total) * 100;
              return (
                <div
                  key={i}
                  className={cn(
                    "absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full transition-colors",
                    active === i
                      ? "bg-amber-400"
                      : "bg-amber-400/60 hover:bg-amber-400/90"
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
            <span className="text-amber-400">{active >= 0 ? `Clip ${active + 1}` : ""}</span>
            <span>{fmtClock(total)}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <a
            href={result.finalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-amber-400 underline-offset-2 hover:text-amber-300 hover:underline"
          >
            Open full video
            <ExternalLink className="ml-1 inline size-3.5" aria-hidden />
          </a>
          <a
            href={downloadUrl}
            onClick={() => onDownloaded?.(result.dir)}
            className={cn(buttonVariants({ variant: "default" }))}
          >
            <Download aria-hidden />
            Download video
          </a>
        </div>

        <div className="space-y-2" role="list">
          <p className="text-sm font-semibold text-muted-foreground">
            Segments extracted — click a clip to jump to it in the player:
          </p>
          {result.rawSegments.map((seg, i) => {
            const [s, e] = seg;
            const isActive = active === i;
            return (
              <button
                key={i}
                type="button"
                role="listitem"
                onClick={() => playSeg(i)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  isActive
                    ? "bg-amber-400/15 ring-1 ring-amber-400/60"
                    : "bg-muted hover:bg-muted/70"
                )}
              >
                <span className="flex min-w-0 items-center gap-2 font-medium text-amber-400">
                  <span className="truncate">
                    Clip {i + 1} — {fmt(s)} → {fmt(e)}
                  </span>
                  {isActive && <span className="shrink-0 text-xs text-amber-400">▶ playing</span>}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  @ {fmtClock(starts[i] ?? 0)}
                </span>
              </button>
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