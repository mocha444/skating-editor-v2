export type Status = "idle" | "hashing" | "uploading" | "processing" | "done" | "error";

export type Result = {
  jobId: string;
  segments: number;
  duration: number;
  finalUrl: string;
  rawSegments: [number, number][] | [number, number, number][];
  segUrls?: string[];
  logs?: string[];
};

export type RecentItem = {
  durationLabel: string;
  dir: string;
  url: string;
  date: string;
};

export type DetectionSettings = {
  threshold: string;
  minContour: string;
  minMotionFrames: string;
  bufferFrames: string;
  history: string;
  varThreshold: string;
  detectShadows: string;
};

export const DEFAULT_SETTINGS: DetectionSettings = {
  threshold: "0.0012",
  minContour: "50",
  minMotionFrames: "12",
  bufferFrames: "20",
  history: "300",
  varThreshold: "25",
  detectShadows: "false",
};

/** Appends detection settings to a FormData using the API's expected field names. */
export function appendSettings(fd: FormData, s: DetectionSettings) {
  fd.append("threshold", s.threshold);
  fd.append("min-contour", s.minContour);
  fd.append("min-motion-frames", s.minMotionFrames);
  fd.append("buffer-frames", s.bufferFrames);
  fd.append("history", s.history);
  fd.append("var-threshold", s.varThreshold);
  fd.append("detect-shadows", s.detectShadows);
}

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function fmtSpeed(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return "";
  return `${fmtBytes(bps)}/s`;
}