"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  logs: string[];
  autoScroll: boolean;
  onToggleAutoScroll: (v: boolean) => void;
  onAppendLog: (line: string) => void;
};

export function LogPanel({ logs, autoScroll, onToggleAutoScroll, onAppendLog }: Props) {
  const logRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  function flashCopied() {
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }

  async function copyLogs() {
    const text = logs.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      onAppendLog("✓ Logs copied to clipboard");
      flashCopied();
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        onAppendLog("✓ Logs copied to clipboard");
        flashCopied();
      } catch {
        onAppendLog("✗ Copy failed — your browser blocks clipboard access");
      }
      document.body.removeChild(ta);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          {logs.length > 0 && (
            <span className="size-1.5 animate-pulse rounded-full bg-amber-400" aria-hidden />
          )}
          Build log{logs.length === 1 ? "" : "s"} {logs.length > 0 ? `(${logs.length} lines)` : ""}
        </h3>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="xs" onClick={copyLogs} disabled={!logs.length}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => onToggleAutoScroll(e.target.checked)}
              className="size-4 rounded accent-amber-400"
            />
            Auto-scroll
          </label>
        </div>
      </div>
      <div
        ref={logRef}
        className="h-48 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-black/50 p-4 font-mono text-xs leading-relaxed text-muted-foreground shadow-inner"
      >
        {logs.length > 0 ? (
          logs.map((line, i) => (
            <div key={i} className="border-b border-foreground/5 py-0.5 last:border-0">
              <span className="select-none text-amber-400">[log]</span> {line}
            </div>
          ))
        ) : (
          <div className="italic text-muted-foreground/70">
            Waiting for build output from MOG2 + ffmpeg…
          </div>
        )}
      </div>
    </div>
  );
}