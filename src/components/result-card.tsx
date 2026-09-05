"use client";

import { Download, ExternalLink, Play, AlertTriangle } from "lucide-react";
import type { Result } from "@/lib/editor-types";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  result: Result;
  confirmReset: boolean;
  onDownload: () => void;
  onContinueDelete: () => void;
  onCancelReset: () => void;
  onProcessAnother: () => void;
};

function fmt(s?: number) {
  return `${(s ?? 0).toFixed(1)}s`;
}

export function ResultCard({
  result,
  confirmReset,
  onDownload,
  onContinueDelete,
  onCancelReset,
  onProcessAnother,
}: Props) {
  const clip = result.segments === 1 ? "clip" : "clips";
  const downloadUrl = `/api/download/${result.jobId}`;
  return (
    <div className="flex w-full flex-col gap-4">
      <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-xl font-bold">
          Done! Found {result.segments} {clip} ({fmt(result.duration)} of skating)
        </h2>

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
          <a
            href={downloadUrl}
            onClick={onDownload}
            className={cn(buttonVariants({ variant: "default" }))}
          >
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

      {confirmReset && (
        <div
          role="alertdialog"
          aria-label="Download warning"
          className="mx-auto w-full max-w-lg rounded-xl border border-amber-700/60 bg-amber-950/50 px-5 py-4 text-center"
        >
          <p className="mb-1 flex items-center justify-center gap-2 text-sm font-bold text-amber-200">
            <AlertTriangle className="size-4" aria-hidden />
            Download your finished video first
          </p>
          <p className="mb-4 text-xs text-amber-100/80">
            You haven&apos;t downloaded the completed video yet. Starting a new processing job will{" "}
            <span className="font-bold text-amber-300">permanently delete</span> it. We recommend
            downloading it first.
          </p>
          <div className="flex flex-col items-center gap-3">
            <a
              href={downloadUrl}
              onClick={onDownload}
              className={cn(buttonVariants({ variant: "default" }))}
            >
              <Download aria-hidden />
              Download video
            </a>
            <div className="flex gap-3">
              <button
                onClick={onContinueDelete}
                className="text-xs text-amber-300 underline hover:text-amber-200"
              >
                Continue anyway, delete it
              </button>
              <button
                onClick={onCancelReset}
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <Button variant="secondary" className="self-center" onClick={onProcessAnother}>
        Process another
      </Button>
    </div>
  );
}