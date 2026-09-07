"use client";

import { Download, ExternalLink, Play } from "lucide-react";
import type { Result } from "@/lib/editor-types";
import { Button, buttonVariants } from "@/components/ui/button";
import { Confetti } from "@/components/confetti";
import { cn } from "@/lib/utils";

type Props = {
  result: Result;
  onProcessAnother: () => void;
};

function fmt(s?: number) {
  return `${(s ?? 0).toFixed(1)}s`;
}

// Human-friendly: 56.4s / 1m 28s
function fmtHuman(s?: number) {
  if (!s || Number.isNaN(s) || s < 0) return "";
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}m ${sec}s`;
}

export function ResultCard({ result, onProcessAnother }: Props) {
  const clip = result.segments === 1 ? "clip" : "clips";
  const downloadUrl = `/api/download/${result.jobId}`;

  // Vary the payoff line by how many clips we cut (deterministic → no hydration mismatch).
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

        <video controls className="w-full rounded-xl" src={result.finalUrl} />

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
          <a href={downloadUrl} className={cn(buttonVariants({ variant: "default" }))}>
            <Download aria-hidden />
            Download video
          </a>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted-foreground">Segments extracted:</p>
          {result.rawSegments.map((seg, i) => {
            const [s, e] = seg;
            const segUrl = result.segUrls?.[i] || result.finalUrl;
            return (
              <div
                key={i}
                className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm"
              >
                <span>
                  Clip {i + 1} — {fmt(s)} → {fmt(e)}
                </span>
                <a
                  href={segUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-bold text-amber-400 hover:text-amber-300"
                >
                  <Play className="size-3" aria-hidden />
                  Play
                </a>
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
