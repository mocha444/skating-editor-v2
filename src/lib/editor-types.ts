export type Status = "idle" | "hashing" | "uploading" | "processing" | "done" | "error";

export type Result = {
  jobId: string;
  dir?: string;
  segments: number;
  duration: number;
  sourceDuration?: number;
  finalUrl: string;
  rawSegments: [number, number][] | [number, number, number][];
  segDurations?: number[];
  /**
   * The range each clip ACTUALLY covers in the source after stream-copy keyframe
   * snapping. `rawSegments` is the detected motion window, which is shorter —
   * showing that instead made the `@` offsets look wrong.
   */
  actualSegments?: [number, number][];
  segUrls?: string[];
  logs?: string[];
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
