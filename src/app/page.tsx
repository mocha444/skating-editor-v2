"use client";
import { useState, useRef, useEffect } from "react";

type Status = "idle" | "uploading" | "processing" | "done" | "error";
type Result = { segments: number; duration: number; finalUrl: string; rawSegments: [number, number][] | [number, number, number][] };

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [latestName, setLatestName] = useState<string>("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/latest").then(r => r.json()).then(j => {
      if (j.file) setLatestName(j.dir);
    });
  }, []);

  function fmt(s?: number) { return `${(s ?? 0).toFixed(1)}s`; }

  async function submit() {
    if (!file) return;
    setStatus("uploading");
    setError("");
    const fd = new FormData();
    fd.append("video", file);
    try {
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      if (!r.ok) { const j = await r.json(); throw new Error(j.error); }
      setStatus("done");
      setResult(await r.json());
    } catch (e: any) {
      setStatus("error");
      setError(e.message);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white p-6 flex flex-col items-center gap-6">
      <h1 className="text-5xl font-extrabold tracking-tight mt-4">Skating Editor</h1>

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
            onChange={e => {
              const f = e.target.files?.[0];
              setFile(f || null);
              setStatus("idle");
              setResult(null);
            }}
          />
          {file ? (
            <div>
              <p className="text-2xl font-semibold">{file.name}</p>
              <p className="text-amber-300 text-xs font-mono mt-1">type: {file.type || "unknown"} | size: {(file.size/1e6).toFixed(2)} MB | ext: {file.name.split('.').pop()}</p>
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
          className="bg-white text-neutral-950 font-bold px-8 py-3 rounded-xl hover:bg-neutral-200 transition-colors"
        >
          Process Video
        </button>
      )}

      {/* Process latest without re-upload */}
      {latestName && status === "idle" && !file && (
        <div className="flex flex-col items-center gap-2 bg-neutral-900 border border-neutral-700 rounded-xl px-6 py-3">
          <p className="text-sm text-neutral-300">Latest upload: <b>{latestName}</b></p>
          <button
            onClick={async () => {
              setStatus("uploading");
              try {
                const r = await fetch("/api/process-latest", { method: "POST" });
                if (!r.ok) { const j = await r.json(); throw new Error(j.error); }
                setStatus("done");
                setResult(await r.json());
              } catch (e: any) {
                setStatus("error");
                setError(e.message);
              }
            }}
            className="bg-amber-400 text-neutral-950 font-bold px-6 py-2 rounded-lg hover:bg-amber-300 transition-colors text-sm"
          >
            Process Latest Upload
          </button>
        </div>
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

      {/* Result */}
      {status === "done" && result && (
        <div className="w-full max-w-2xl flex flex-col gap-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6">
            <h2 className="text-xl font-bold mb-4">Done! Found {result.segments} clip{result.segments !== 1 ? "s" : ""} ({fmt(result.duration)} of skating)</h2>

            {/* Final video */}
            <video
              controls
              className="w-full rounded-xl"
              src={result.finalUrl}
            />

            {/* Segment breakdown */}
            <div className="mt-4 space-y-2">
              <p className="text-sm font-semibold text-neutral-400">Segments extracted:</p>
              {result?.rawSegments?.map((seg, i) => {
                const [s, e] = seg;
                return (
                  <div key={i} className="flex justify-between text-sm text-neutral-300 bg-neutral-800 rounded px-3 py-1">
                    <span>Clip {i + 1}</span>
                    <span>{fmt(s)} → {fmt(e)} ({fmt(e - s)})</span>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            onClick={() => { setFile(null); setStatus("idle"); setResult(null); if (inputRef.current) inputRef.current.value = ""; }}
            className="bg-neutral-800 hover:bg-neutral-700 text-white font-semibold px-6 py-2 rounded-xl transition-colors self-center"
          >
            Process another
          </button>
        </div>
      )}
    </main>
  );
}
