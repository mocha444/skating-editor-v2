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
import { computeFileHash } from "@/lib/client-hash";
import { uploadFormData } from "@/lib/upload-video";
import {
  type Status,
  type Result,
  type RecentItem,
  type DetectionSettings,
  DEFAULT_SETTINGS,
  appendSettings,
  fmtBytes,
} from "@/lib/editor-types";

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isDuplicate, setIsDuplicate] = useState<boolean | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [settings, setSettings] = useState<DetectionSettings>(DEFAULT_SETTINGS);
  const [progress, setProgress] = useState({ percent: 0, stage: "" });
  const [upload, setUpload] = useState<{
    percent: number;
    loaded: number;
    total: number;
    speedBps: number;
  } | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hashRef = useRef<string | null>(null);

  const busy = status === "uploading" || status === "processing";

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => clearPoll, [clearPoll]);

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
    clearPoll();
    setFile(null);
    setStatus("idle");
    setResult(null);
    setIsDuplicate(null);
    setDownloaded(false);
    setConfirmReset(false);
    setProgress({ percent: 0, stage: "" });
    setUpload(null);
    hashRef.current = null;
  }

  async function onFileSelected(f: File) {
    clearPoll();
    setFile(f);
    setStatus("hashing");
    setResult(null);
    setIsDuplicate(null);
    setDownloaded(false);
    setConfirmReset(false);
    setProgress({ percent: 0, stage: "" });
    setLogs([`File selected: ${f.name} (${fmtBytes(f.size)})`]);
    try {
      const hash = await computeFileHash(f);
      hashRef.current = hash;
      appendLog(`Hash: ${hash.slice(0, 8)}…`);
      const r = await fetch(`/api/check-duplicate?hash=${hash}`);
      const j = await r.json();
      if (j.duplicate) {
        setIsDuplicate(true);
        appendLog(`⚠ Duplicate: ${j.dir}`);
      } else {
        setIsDuplicate(false);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      appendLog(`⚠ Could not check for duplicates: ${message}`);
    } finally {
      setStatus("idle");
    }
  }

  async function submit() {
    if (!file || busy) return;
    const hash = hashRef.current;
    if (!hash) {
      appendLog("✗ Hash not ready — select a file and wait for the duplicate check.");
      return;
    }
    setStatus("uploading");
    setDownloaded(false);
    setConfirmReset(false);
    setError("");
    setUpload(null);
    setLogs([`Uploading ${file.name}…`, `Hash: ${hash.slice(0, 8)}… — submitting`]);

    const fd = new FormData();
    fd.append("hash", hash);
    appendSettings(fd, settings);
    fd.append("video", file);

    try {
      const { status: httpStatus, json } = await uploadFormData(fd, (p) => setUpload(p));
      if (json.duplicate) {
        setStatus("error");
        setError(`Same video already uploaded (${json.existingDir})`);
        appendLog(`⚠ Duplicate detected: ${json.existingDir}`);
        return;
      }
      if (httpStatus < 200 || httpStatus >= 300) {
        throw new Error(json.error || `Upload failed (${httpStatus})`);
      }
      if (!json.jobId) throw new Error("No jobId returned");

      setStatus("processing");
      setUpload(null);
      setProgress({ percent: json.percent || 10, stage: json.stage || "saving" });

      const jobId = json.jobId as string;
      pollRef.current = setInterval(async () => {
        try {
          const pr = await fetch(`/api/progress/${jobId}?jobId=${jobId}`);
          if (!pr.ok) return;
          const meta = await pr.json();
          setProgress({ percent: meta.percent || 0, stage: meta.stage || "" });
          if (meta.log && meta.log.length) {
            setLogs((prev) => {
              const last = prev[prev.length - 1];
              if (meta.log[meta.log.length - 1] === last) return prev;
              return [...prev, meta.log[meta.log.length - 1]];
            });
          }
          if (meta.status === "done" || meta.result) {
            clearPoll();
            setStatus("done");
            setResult(meta.result || json);
            setProgress({ percent: 100, stage: "done" });
            appendLog(`✓ Done! ${meta.result?.segments} segments`);
            refreshRecent();
          } else if (meta.status === "error") {
            clearPoll();
            setStatus("error");
            setError(meta.error || "Processing failed");
          }
        } catch {}
      }, 2000);
    } catch (e: unknown) {
      clearPoll();
      setStatus("error");
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      appendLog(`✗ Error: ${message}`);
    }
  }

  async function processRecent(dir: string) {
    clearPoll();
    setStatus("processing");
    setResult(null);
    setLogs([`Re-processing ${dir} with current settings…`]);
    try {
      const fd = new FormData();
      fd.append("dir", dir);
      appendSettings(fd, settings);
      const r = await fetch("/api/reprocess", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "reprocess failed");
      if (!j.jobId) throw new Error("No jobId returned");
      setProgress({ percent: 5, stage: "starting" });
      appendLog(`Re-processing ${dir} (job: ${j.jobId})…`);
      const jobId = j.jobId as string;
      pollRef.current = setInterval(async () => {
        try {
          const pr = await fetch(`/api/progress/${jobId}?jobId=${jobId}`);
          if (!pr.ok) return;
          const meta = await pr.json();
          setProgress({ percent: meta.percent || 0, stage: meta.stage || "" });
          if (meta.log && meta.log.length) {
            setLogs((prev) => {
              const last = prev[prev.length - 1];
              if (meta.log[meta.log.length - 1] === last) return prev;
              return [...prev, meta.log[meta.log.length - 1]];
            });
          }
          if (meta.status === "done" || meta.result) {
            clearPoll();
            setStatus("done");
            setResult(meta.result || j);
            setProgress({ percent: 100, stage: "done" });
            appendLog(`✓ Re-processed! ${meta.result?.segments || j.segments} segments`);
            refreshRecent();
          } else if (meta.status === "error") {
            clearPoll();
            setStatus("error");
            setError(meta.error || "Re-processing failed");
          }
        } catch {}
      }, 2000);
    } catch (e: unknown) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteRecent(dir: string) {
    const fd = new FormData();
    fd.append("dir", dir);
    const r = await fetch("/api/delete", { method: "POST", body: fd });
    if (r.ok) {
      setRecent((prev) => prev.filter((x) => x.dir !== dir));
      appendLog(`Deleted: ${dir}`);
    } else {
      setError("Failed to delete.");
      appendLog(`✗ Failed to delete ${dir}`);
    }
  }

  function onDownload() {
    if (!result) return;
    setDownloaded(true);
    setConfirmReset(false);
  }

  function onProcessAnother() {
    if (result && !downloaded) {
      setConfirmReset(true);
      return;
    }
    resetState();
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-8 pb-20 sm:px-6">
      <header className="mt-2 flex items-center justify-center gap-3">
        <Camera className="size-8 text-amber-400" aria-hidden />
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Skating Editor</h1>
      </header>

      {recent.length > 0 && (
        <section className="w-full" aria-label="Recent uploads">
          <RecentList
            items={recent}
            busy={status === "processing"}
            onReProcess={processRecent}
            onDelete={deleteRecent}
          />
        </section>
      )}

      <UploadZone
        file={file}
        busy={busy}
        hashing={status === "hashing"}
        onFileSelected={onFileSelected}
        onClear={resetState}
      />

      <AdvancedSettings settings={settings} onChange={(p) => setSettings((s) => ({ ...s, ...p }))} />

      {file && status === "idle" && (
        <Button
          onClick={submit}
          disabled={isDuplicate === true || isDuplicate === null}
          className="px-8 py-2.5 text-base"
          size="lg"
        >
          {isDuplicate === true ? "Already in library" : "Process Video"}
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
        <div
          role="alert"
          className="w-full max-w-xl rounded-xl border border-destructive/40 bg-destructive/10 px-6 py-3 text-destructive"
        >
          {error}
        </div>
      )}

      {(status === "uploading" ||
        status === "processing" ||
        status === "done" ||
        status === "error") && (
        <LogPanel
          logs={logs}
          autoScroll={autoScroll}
          onToggleAutoScroll={setAutoScroll}
          onAppendLog={appendLog}
        />
      )}

      {status === "done" && result && (
        <ResultCard
          result={result}
          confirmReset={confirmReset}
          onDownload={onDownload}
          onContinueDelete={resetState}
          onCancelReset={() => setConfirmReset(false)}
          onProcessAnother={onProcessAnother}
        />
      )}
    </main>
  );
}