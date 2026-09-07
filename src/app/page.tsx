"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";

import { UploadZone } from "@/components/upload-zone";
import { RecentList } from "@/components/recent-list";
import { ProgressPanel } from "@/components/progress-panel";
import { LogPanel } from "@/components/log-panel";
import { ResultCard } from "@/components/result-card";
import { AdvancedSettings } from "@/components/advanced-settings";
import { Button } from "@/components/ui/button";
import { appendSettings } from "@/lib/editor-types";
import { uploadFormData } from "@/lib/upload-video";
import { computeFileSig, computeFileHash } from "@/lib/client-hash";
import {
  type Status,
  type Result,
  type RecentItem,
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
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [settings, setSettings] = useState<DetectionSettings>(DEFAULT_SETTINGS);
  const esRef = useRef<EventSource | null>(null);
  const isBusy = status === "uploading" || status === "processing";

  const closeStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  useEffect(() => closeStream, [closeStream]);

  const refreshRecent = useCallback(() => {
    fetch("/api/recent")
      .then((r) => r.json())
      .then(setRecent)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshRecent();
  }, [refreshRecent]);

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

  function onFileSelected(f: File) {
    closeStream();
    setFile(f);
    setStatus("idle");
    setResult(null);
    setError("");
    setLogs([`File selected: ${f.name} (${fmtBytes(f.size)})`]);
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
          refreshRecent();
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
          setError("This video was already processed. Delete it from Recent first, or upload a different file.");
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
        refreshRecent();
        setStatus("error");
        setError("This video was already processed. Delete it from Recent first, or upload a different file.");
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

  async function onReProcess(dir: string) {
    setError("");
    setLogs([`Re-processing ${dir}…`]);
    try {
      const fd = new FormData();
      fd.append("dir", dir);
      appendSettings(fd, settings);
      const r = await fetch("/api/reprocess", { method: "POST", body: fd });
      const j = await r.json();
      if (!j.ok || !j.jobId) throw new Error(j.error || "Re-process failed");
      openStream(j.jobId as string);
    } catch (e: unknown) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onDelete(dir: string) {
    try {
      const fd = new FormData();
      fd.append("dir", dir);
      await fetch("/api/delete", { method: "POST", body: fd });
      refreshRecent();
    } catch {}
  }

  const onSettingsChange = useCallback((patch: Partial<DetectionSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-8 pb-20 sm:px-6">
      <header className="relative mt-2 flex items-center justify-center gap-3">
        <Camera className="size-8 text-amber-400" aria-hidden />
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Skating Editor</h1>
      </header>

      <UploadZone
        file={file}
        busy={isBusy}
        hashing={status === "hashing"}
        onFileSelected={onFileSelected}
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

      {status === "done" && result && <ResultCard result={result} onProcessAnother={resetState} />}

      <RecentList items={recent} busy={isBusy} onReProcess={onReProcess} onDelete={onDelete} />
    </main>
  );
}
