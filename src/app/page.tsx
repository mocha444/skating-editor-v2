"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";

import { UploadZone } from "@/components/upload-zone";
import { VideosList } from "@/components/videos-list";
import { SystemTemps } from "@/components/system-temps";
import { ProgressPanel } from "@/components/progress-panel";
import { LogPanel } from "@/components/log-panel";
import { ResultCard } from "@/components/result-card";
import { AdvancedSettings } from "@/components/advanced-settings";
import { Button } from "@/components/ui/button";
import { DiscardDialog } from "@/components/discard-dialog";
import { uploadFormData } from "@/lib/upload-video";
import { computeFileSig, computeFileHash } from "@/lib/client-hash";
import {
  type Status,
  type Result,
  type DetectionSettings,
  DEFAULT_SETTINGS,
  fmtBytes,
} from "@/lib/editor-types";

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [progress, setProgress] = useState({ percent: 0, stage: "" });
  const [upload, setUpload] = useState<{ percent: number; loaded: number; total: number; speedBps: number } | null>(null);
  const [settings, setSettings] = useState<DetectionSettings>(DEFAULT_SETTINGS);
  const [videosTick, setVideosTick] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const isBusy = status === "uploading" || status === "processing";

  const closeStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  useEffect(() => closeStream, [closeStream]);

  // ---- Discard-after-done lifecycle -------------------------------------
  // A finished job's dir stays on disk until the user leaves it behind. If the
  // final video was downloaded, the next action cleans it up silently; if not,
  // we ask first — there's no going back.
  const [downloadedDirs, setDownloadedDirs] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<
    | { kind: "reset" }
    | { kind: "upload"; file: File }
    | null
  >(null);
  const [discard, setDiscard] = useState<{ name: string } | null>(null);

  const currentDir = status === "done" ? (result?.dir ?? null) : null;

  const deleteDir = useCallback(async (dir: string) => {
    try {
      const fd = new FormData();
      fd.append("dir", dir);
      await fetch("/api/delete", { method: "POST", body: fd });
    } catch {}
  }, []);

  const videoLabel = useCallback(
    (dir: string | null | undefined) => {
      if (!dir) return "this video";
      return dir;
    },
    []
  );

  const bumpVideos = useCallback(() => setVideosTick((t) => t + 1), []);

  const markDownloaded = useCallback((dir?: string) => {
    bumpVideos();
    if (!dir) return;
    setDownloadedDirs((prev) => {
      const next = new Set(prev);
      next.add(dir);
      return next;
    });
  }, [bumpVideos]);

  async function doReProcess(dir: string) {
    if (isBusy || !dir) return;
    setError("");
    setLogs([`Re-processing ${dir}…`]);
    // The new edit supersedes the old output, so a previous download of this
    // dir no longer counts.
    setDownloadedDirs((prev) => {
      if (!prev.has(dir)) return prev;
      const next = new Set(prev);
      next.delete(dir);
      return next;
    });
    try {
      const fd = new FormData();
      fd.append("dir", dir);
      fd.append("threshold", settings.threshold);
      fd.append("min-contour", settings.minContour);
      fd.append("min-motion-frames", settings.minMotionFrames);
      fd.append("buffer-frames", settings.bufferFrames);
      fd.append("history", settings.history);
      fd.append("var-threshold", settings.varThreshold);
      fd.append("detect-shadows", settings.detectShadows);
      const r = await fetch("/api/reprocess", { method: "POST", body: fd });
      const j = await r.json();
      if (!j.ok || !j.jobId) throw new Error(j.error || "Re-process failed");
      openStream(j.jobId as string);
    } catch (e: unknown) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const handleVideosDeleted = useCallback((dir: string) => {
    bumpVideos();
    // The currently displayed result may have been deleted from disk — if
    // so, drop its (now broken) result panel too.
    if (dir === currentDir) resetState();
  }, [bumpVideos, currentDir]);

  function appendLog(line: string) {
    setLogs((prev) => [...prev, line]);
  }

  function resetState() {
    closeStream();
    setFile(null);
    setStatus("idle");
    setResult(null);
    setProgress({ percent: 0, stage: "" });
    setUpload(null);
    setLogs([]);
    setError("");
  }

  // Apply a newly selected file to the UI (idle state, fresh logs).
  function selectFileNow(f: File) {
    closeStream();
    setFile(f);
    setStatus("idle");
    setResult(null);
    setError("");
    setLogs([`File selected: ${f.name} (${fmtBytes(f.size)})`]);
  }

  function handleFileSelected(f: File) {
    // Picking a new file abandons the finished result that's on screen.
    if (currentDir) {
      if (!downloadedDirs.has(currentDir)) {
        setPendingAction({ kind: "upload", file: f });
        setDiscard({ name: videoLabel(currentDir) });
        return;
      }
      void deleteDir(currentDir);
    }
    selectFileNow(f);
  }

  // "Process another" from the result card abandons the finished result.
  function requestProcessAnother() {
    if (!currentDir) {
      resetState();
      return;
    }
    if (!downloadedDirs.has(currentDir)) {
      setPendingAction({ kind: "reset" });
      setDiscard({ name: videoLabel(currentDir) });
      return;
    }
    void deleteDir(currentDir).then(() => {
      resetState();
    });
  }

  function cancelDiscard() {
    setPendingAction(null);
    setDiscard(null);
  }

  async function confirmDiscard() {
    const action = pendingAction;
    setPendingAction(null);
    setDiscard(null);
    if (!action) return;

    if (action.kind === "upload") {
      // Delete the abandoned result first (user accepted the risk), then bring
      // in the newly selected file.
      if (currentDir) await deleteDir(currentDir);
      selectFileNow(action.file);
      return;
    }
    if (action.kind === "reset") {
      if (currentDir) await deleteDir(currentDir);
      resetState();
      return;
    }
  }

  function openStream(jobId: string) {
    setStatus("processing");
    setProgress({ percent: 10, stage: "queued" });

    const es = new EventSource(`/api/events?jobId=${encodeURIComponent(jobId)}`);
    es.addEventListener("progress", (e) => {
      try {
        const m = JSON.parse((e as MessageEvent).data);
        setProgress({ percent: m.percent || 0, stage: m.stage || "" });
      } catch {}
    });
    es.addEventListener("log", (e) => {
      try {
        setLogs((prev) => [...prev, ...(JSON.parse((e as MessageEvent).data) as string[])]);
      } catch {}
    });
    es.addEventListener("done", (e) => {
      es.close();
      closeStream();
      try {
        const d = JSON.parse((e as MessageEvent).data);
        if (d.status === "done") {
          setStatus("done");
          setResult(d.result);
          setProgress({ percent: 100, stage: "done" });
          appendLog(`✓ Done! ${d.result?.segments} segments`);
          bumpVideos();
        } else if (d.status === "error") {
          setStatus("error");
          setError(d.error || "Processing failed");
        }
      } catch {}
    });
    es.onerror = () => {
      /* Intentionally do NOT close on error: EventSource auto-reconnects,
         and the server re-sends a fresh snapshot on each (re)connect. */
    };
    esRef.current = es;
  }

  async function submit() {
    if (!file || isBusy) return;

    setStatus("hashing");
    setError("");
    setLogs([`Checking ${file.name}…`]);

    try {
      // Fast pre-screen: hash only the ends of the file (few ms). New files skip
      // the slow full-file hash entirely and go straight to uploading.
      const sig = await computeFileSig(file);
      const dup = await fetch(
        `/api/check-duplicate?size=${sig.size}&head=${encodeURIComponent(sig.head)}&tail=${encodeURIComponent(sig.tail)}`
      ).then((r) => r.json());
      if (dup.duplicate) {
        // Signature matched an existing upload — confirm with the full-file hash
        // to be exact before rejecting (avoids false positives).
        const hash = await computeFileHash(file);
        const confirmed = await fetch(`/api/check-duplicate?hash=${encodeURIComponent(hash)}`).then((r) => r.json());
        if (confirmed.duplicate) {
          setStatus("error");
          setError("This video was already processed. Upload a different file.");
          appendLog(`✗ Duplicate detected — hash ${hash.slice(0, 8)}`);
          return;
        }
      }

      setStatus("uploading");
      setLogs([`Uploading ${file.name}…`]);
      setUpload(null);

      const { status: httpStatus, json } = await uploadFormData(file, settings, (p) => setUpload(p));

      // Server-side authoritative dedupe (hash computed during upload).
      if (json.duplicate) {
        setStatus("error");
        setError("This video was already processed. Upload a different file.");
        appendLog(`✗ Duplicate detected by server (${json.existingDir || ""})`);
        return;
      }

      if (!json.ok || httpStatus < 200 || httpStatus >= 300 || !json.jobId) {
        throw new Error(json.error || `Upload failed (${httpStatus})`);
      }
      openStream(json.jobId as string);
    } catch (e: unknown) {
      closeStream();
      setStatus("error");
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      appendLog(`✗ Error: ${message}`);
    }
  }

  const onSettingsChange = useCallback((patch: Partial<DetectionSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-8 pb-20 sm:px-6">
      <header className="relative mt-2 flex flex-col items-center gap-1.5 text-center">
        <div className="flex items-center gap-3">
          <Camera className="size-8 text-amber-400" aria-hidden />
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Skating Editor</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Cut the dead air out of your skate videos — automatically.
        </p>
      </header>

      <SystemTemps />

      <UploadZone
        file={file}
        busy={isBusy}
        hashing={status === "hashing"}
        onFileSelected={handleFileSelected}
        onClear={resetState}
      />

      <AdvancedSettings settings={settings} onChange={onSettingsChange} />

      {file && status === "idle" && (
        <Button onClick={submit} className="px-8 py-2.5 text-base" size="lg">
          Process Video
        </Button>
      )}

      {(status === "uploading" || status === "processing") && (
        <ProgressPanel
          status={status as "uploading" | "processing"}
          stage={progress.stage}
          percent={progress.percent}
          upload={upload}
        />
      )}

      {status === "error" && (
        <div role="alert" className="w-full max-w-xl rounded-xl border border-destructive/40 bg-destructive/10 px-6 py-3 text-destructive">
          {error}
        </div>
      )}

      {(status === "uploading" || status === "processing" || status === "done" || status === "error") && (
        <LogPanel logs={logs} autoScroll={autoScroll} onToggleAutoScroll={setAutoScroll} onAppendLog={appendLog} />
      )}

      {status === "done" && result && (
        <ResultCard
          result={result}
          busy={isBusy}
          onProcessAnother={requestProcessAnother}
          onDownloaded={markDownloaded}
          onReprocess={doReProcess}
        />
      )}

      <VideosList
        busy={isBusy}
        refreshKey={videosTick}
        currentDir={currentDir}
        onReprocess={doReProcess}
        onDeleted={handleVideosDeleted}
      />

      <DiscardDialog
        open={discard != null}
        name={discard?.name ?? "this video"}
        onCancel={cancelDiscard}
        onConfirm={() => void confirmDiscard()}
      />
    </main>
  );
}
