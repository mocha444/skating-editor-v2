"use client";
import { useState, useRef, useEffect } from "react";

type Status = "idle" | "uploading" | "processing" | "done" | "error";
type Result = { segments: number; duration: number; finalUrl: string; rawSegments: [number, number][] | [number, number, number][]; segUrls?: string[]; logs?: string[] };

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string>("");
  const [logs, setLogs] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isDuplicate, setIsDuplicate] = useState<boolean | null>(null); // null = unknown
  // Detection parameters
  const [threshold, setThreshold] = useState(0.003);
  const [minContour, setMinContour] = useState(50);
  const [minMotionFrames, setMinMotionFrames] = useState(8);
  const [bufferFrames, setBufferFrames] = useState(60);
  const [history, setHistory] = useState(300);
  const [varThreshold, setVarThreshold] = useState(25);
  const [detectShadows, setDetectShadows] = useState(false);
  const [recent, setRecent] = useState<{dir:string;url:string;date:string}[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/recent").then(r => r.json()).then(data => setRecent(data)).catch(() => {});
  }, []);

  // Auto-scroll log panel
  useEffect(() => {
    if (autoScroll && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs, autoScroll]);

  function fmt(s?: number) { return `${(s ?? 0).toFixed(1)}s`; }

  async function computeHash(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("MD5", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function submit() {
    if (!file) return;
    setStatus("uploading");
    setLogs([`Uploading ${file.name}...`]);
    setError("");
    try {
      const fd = new FormData();
      fd.append("video", file);
      const hash = await computeHash(file);
      fd.append("hash", hash);
      fd.append("threshold", threshold.toString());
      fd.append("min-contour", minContour.toString());
      fd.append("min-motion-frames", minMotionFrames.toString());
      fd.append("buffer-frames", bufferFrames.toString());
      fd.append("history", history.toString());
      fd.append("var-threshold", varThreshold.toString());
      fd.append("detect-shadows", detectShadows.toString());
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (j.duplicate) {
        setStatus("error");
        setError(`Same video already uploaded (${j.existingDir})`);
        return;
      }
      if (!r.ok) throw new Error(j.error);
      setStatus("processing");
      setLogs([`Uploading done. Detecting motion + cutting...`]);
      setResult(j);
      setStatus("done");
      setLogs(prev => [...prev, `✓ Done! ${j.segments} segments, ${j.duration.toFixed(1)}s of skating`]);
    } catch (e: any) {
      setStatus("error");
      setError(e.message);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white p-6 flex flex-col items-center gap-6">
      <h1 className="text-5xl font-extrabold tracking-tight mt-4">Skating Editor</h1>

      {/* Recent uploads */}
      <div className="w-full max-w-2xl">
        <h2 className="text-sm font-bold text-neutral-400 mb-2">Most Recent Uploads</h2>
        {recent.length > 0 ? (
          <div className="space-y-2">
            {recent.map(r => (
              <div key={r.dir} className="bg-neutral-900 border border-neutral-700 rounded-xl p-3 flex justify-between items-center">
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:text-amber-300 text-sm font-mono underline">
                  {r.dir}
                </a>
                <span className="text-xs text-neutral-500">{r.date}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-neutral-500 text-sm">No uploads yet</p>
        )}
      </div>

      {/* Upload zone */}
      <div className="w-full max-w-2xl">
        <label
          className="flex flex-col items-center border-2 border-dashed border-neutral-600 hover:border-white rounded-3xl p-16 cursor-pointer transition-colors bg-neutral-900 hover:bg-neutral-800"
          onClick={e => status !== "idle" && e.preventDefault()}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/mp4"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setFile(f);
              setStatus("idle");
              setResult(null);
              setIsDuplicate(null);
              setLogs([`File selected: ${f.name} (${(f.size/1e6).toFixed(1)} MB)`]);
              // Compute hash and check for duplicates server-side
              (async () => {
                try {
                  const hash = await computeHash(f);
                  setLogs(prev => [...prev, `Hash: ${hash.slice(0, 8)}…`]);
                  const r = await fetch(`/api/check-duplicate?hash=${hash}`);
                  const j = await r.json();
                  if (j.duplicate) {
                    setIsDuplicate(true);
                    setLogs(prev => [...prev, `⚠ Duplicate: ${j.dir}`]);
                  } else {
                    setIsDuplicate(false);
                  }
                } catch (e: any) {
                  setLogs(prev => [...prev, `Could not check dup: ${e.message}`]);
                }
              })();
            }}
          />
          {file ? (
            <div>
              <p className="text-2xl font-semibold">{file.name}</p>
              <p className="text-amber-300 text-xs font-mono mt-1">type: {file.type || "unknown"} | size: {(file.size/1e6).toFixed(2)} MB | ext: {file.name.split('.').pop()}</p>

              <div className="mt-4 p-3 bg-neutral-800 rounded-xl text-xs text-neutral-300 space-y-2">
                <p className="font-semibold text-amber-400">Detection Settings</p>
                <label>Threshold: <input type="range" min="0.0001" max="0.05" step="0.001" value={threshold} onChange={e => setThreshold(parseFloat(e.target.value))} /></label>
                <label>Min Contour: <input type="range" min="10" max="200" step="5" value={minContour} onChange={e => setMinContour(parseInt(e.target.value))} /></label>
                <label>Min Motion Frames: <input type="range" min="5" max="30" step="1" value={minMotionFrames} onChange={e => setMinMotionFrames(parseInt(e.target.value))} /></label>
                <label>Buffer Frames: <input type="range" min="30" max="300" step="10" value={bufferFrames} onChange={e => setBufferFrames(parseInt(e.target.value))} /></label>
                <label>History: <input type="range" min="100" max="500" step="50" value={history} onChange={e => setHistory(parseInt(e.target.value))} /></label>
                <label>Var Threshold: <input type="range" min="10" max="50" step="5" value={varThreshold} onChange={e => setVarThreshold(parseInt(e.target.value))} /></label>
                <label>Detect Shadows: <input type="checkbox" checked={detectShadows} onChange={e => setDetectShadows(e.target.checked)} /></label>
              </div>
            </div>
          ) : (
            <>
              <p className="text-2xl font-semibold">Click to upload .mp4</p>
              <p className="text-neutral-500 text-sm mt-2">Your skating video — we'll cut out the dead air</p>
            </>
          )}
        </label>
      </div>

      {/* Submit */}
      {file && status === "idle" && (
        <button
          onClick={submit}
          disabled={status !== "idle" || isDuplicate === true}
          className="bg-white text-neutral-950 font-bold px-8 py-3 rounded-xl hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isDuplicate === true ? "Already in library" : "Process Video"}
        </button>
      )}

      {/* Progress */}
      {(status === "uploading" || status === "processing") && (
        <div className="flex flex-col items-center gap-3">
          <div className="text-lg animate-pulse">
            {status === "uploading" ? "Uploading..." : "Detecting motion + cutting..."}
          </div>
          <div className="w-64 h-2 bg-neutral-800 rounded-full overflow-hidden">
            <div className="h-full bg-white rounded-full animate-pulse" style={{ width: "60%" }} />
          </div>
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div className="text-red-400 bg-red-950 border border-red-800 rounded-xl px-6 py-3">
          Error: {error}
        </div>
      )}

      {/* Build logs — appears during processing / done / error + upload */}
      {(status === "uploading" || status === "processing" || status === "done" || status === "error") && (
        <div className="w-full max-w-2xl flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-neutral-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              Build logs {logs.length > 0 ? `(${logs.length} lines)` : "(waiting...)"}
            </h3>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const text = logs.join("\n");
                  if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(text).then(
                      () => setLogs(prev => [...prev, "✓ Logs copied to clipboard"]),
                      () => fallbackCopy(text)
                    );
                  } else {
                    fallbackCopy(text);
                  }
                  function fallbackCopy(t: string) {
                    const ta = document.createElement("textarea");
                    ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
                    document.body.appendChild(ta); ta.select();
                    try { document.execCommand("copy"); setLogs(prev => [...prev, "✓ Logs copied to clipboard"]); }
                    catch { setLogs(prev => [...prev, "✗ Copy failed — your browser blocks clipboard access"]); }
                    document.body.removeChild(ta);
                  }
                }}
                className="text-xs text-neutral-400 hover:text-white px-2 py-1 rounded border border-neutral-700 hover:border-neutral-500 transition-colors"
                disabled={!logs.length}
              >
                Copy logs
              </button>
              <label className="flex items-center gap-2 text-sm text-neutral-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={e => setAutoScroll(e.target.checked)}
                  className="w-4 h-4 accent-amber-400 rounded"
                />
                Auto-scroll
              </label>
            </div>
          </div>
          <div
            ref={logRef}
            className="bg-black border border-neutral-700 rounded-xl p-4 text-xs font-mono text-neutral-300 h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed shadow-inner"
          >
            {logs.length > 0 ? logs.map((line, i) => (
              <div key={i} className="py-0.5 border-b border-neutral-800/50 last:border-0">
                <span className="text-amber-400 select-none">[log]</span> {line}
              </div>
            )) : (
              <div className="text-neutral-500 italic">Waiting for build output from MOG2 + ffmpeg...</div>
            )}
          </div>
        </div>
      )}

      {/* Result */}
      {status === "done" && result && (
        <div className="w-full max-w-2xl flex flex-col gap-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6">
            <h2 className="text-xl font-bold mb-4">Done! Found {result.segments} clip{result.segments !== 1 ? "s" : ""} ({fmt(result.duration)} of skating)</h2>

            {/* Final video */}
            <video
              controls
              className="w-full rounded-xl mb-2"
              src={result.finalUrl}
            />
            <a href={result.finalUrl} target="_blank" rel="noopener noreferrer" className="block text-center text-sm text-amber-400 hover:text-amber-300 underline">Open full assembled video →</a>

            {/* Segment breakdown */}
            <div className="mt-4 space-y-2">
              <p className="text-sm font-semibold text-neutral-400">Segments extracted:</p>
              {result?.rawSegments?.map((seg, i) => {
                const [s, e] = seg;
                const segUrl = result.segUrls?.[i] || result.finalUrl;
                return (
                  <div key={i} className="flex justify-between text-sm text-neutral-300 bg-neutral-800 rounded px-3 py-1">
                    <span>Clip {i + 1} — {fmt(s)} → {fmt(e)}</span>
                    <a href={segUrl} className="bg-amber-400 text-neutral-950 text-xs font-bold px-3 py-1 rounded hover:bg-amber-300 transition-colors" target="_blank" rel="noopener noreferrer">Play →</a>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            onClick={() => { setFile(null); setStatus("idle"); setResult(null); setIsDuplicate(null); if (inputRef.current) inputRef.current.value = ""; }}
            className="bg-neutral-800 hover:bg-neutral-700 text-white font-semibold px-6 py-2 rounded-xl transition-colors self-center"
          >
            Process another
          </button>
        </div>
      )}
    </main>
  );
}
