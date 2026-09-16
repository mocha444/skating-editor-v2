"use client";

import type { Status } from "@/lib/editor-types";
import { fmtBytes, fmtSpeed } from "@/lib/editor-types";

type Upload = { percent: number; loaded: number; total: number; speedBps: number };

type Props = {
  status: Extract<Status, "uploading" | "processing">;
  stage: string;
  percent: number;
  upload: Upload | null;
};

export function ProgressPanel({ status, stage, percent, upload }: Props) {
  const uploading = status === "uploading";
  const width = uploading ? upload?.percent ?? 5 : percent;

  const heading = uploading
    ? upload
      ? `Uploading ${fmtBytes(upload.loaded)} of ${fmtBytes(upload.total)}${upload.speedBps ? ` — ${fmtSpeed(upload.speedBps)}` : ""}`
      : "Uploading…"
    : `${(stage || "processing").replace(/_/g, " ").toUpperCase()} — ${percent}%`;

  return (
    <div
      className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5"
      role="status"
      aria-live="polite"
    >
      <p className="text-sm font-semibold tabular-nums">{heading}</p>
      <div
        role="progressbar"
        aria-valuenow={Math.round(width)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Processing progress"
        className="h-2.5 w-full max-w-md overflow-hidden rounded-full border border-border bg-muted"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-primary/40 transition-all duration-300 ease-out"
          style={{ width: `${Math.max(2, Math.min(100, width))}%` }}
        />
      </div>
    </div>
  );
}