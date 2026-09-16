"use client";

import { useEffect, useState } from "react";
import { Cpu, CircuitBoard } from "lucide-react";

type Temps = {
  cpu: { package: number | null; cores: number[]; load: number };
  gpu: { temp: number | null; freqMhz: number | null; maxFreqMhz: number | null; busy: number | null };
};

const HISTORY = 40; // ~2 minutes at a 3s poll

function tempColor(t: number | null): string {
  if (t == null) return "text-muted-foreground/70";
  if (t < 60) return "text-chart-2";
  if (t < 80) return "text-chart-3";
  return "text-destructive";
}

function loadColor(l: number): string {
  if (l < 40) return "text-primary";
  if (l < 75) return "text-chart-3";
  return "text-destructive";
}

function tempHex(t: number | null): string {
  if (t == null) return "var(--muted-foreground)";
  if (t < 60) return "var(--chart-2)";
  if (t < 80) return "var(--chart-3)";
  return "var(--destructive)";
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 56;
  const h = 14;
  if (data.length < 2) {
    return <span className="inline-block h-[14px] w-[56px]" />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * (w - 2) + 1;
      const y = h - 2 - ((v - min) / range) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible shrink-0" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function SystemTemps() {
  const [data, setData] = useState<Temps | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await fetch("/api/temps", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as Temps;
        if (!alive) return;
        setData(j);
        setUnavailable(false);
        if (j.cpu.package != null) {
          setHistory((prev) => [...prev, j.cpu.package!].slice(-HISTORY));
        }
      } catch {
        if (alive) setUnavailable(true);
      }
    }
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (unavailable) return null; // sensors not mounted — hide quietly

  const cpu = data?.cpu;
  const gpu = data?.gpu;
  const pkg = cpu?.package ?? null;
  const cpuLoad = cpu?.load ?? 0;
  const gpuBusy = gpu?.busy ?? null;

  return (
    <div className="flex w-full flex-wrap items-center gap-x-1 gap-y-0 rounded-lg border border-border bg-card/60 px-2 py-1 text-xs">
      <span className="tabular-nums text-muted-foreground">
        CPU <span className={`font-semibold ${loadColor(cpuLoad)}`}>{cpuLoad}%</span>
      </span>

      <span className="flex items-center gap-0.5" title="GPU busy % from rc6 residency">
        <CircuitBoard className="size-2.5 text-muted-foreground" aria-hidden />
        {gpuBusy == null ? (
          <span className="font-semibold text-muted-foreground/70">GPU n/a</span>
        ) : gpuBusy <= 0 ? (
          <span className="font-semibold text-muted-foreground/70">GPU idle</span>
        ) : (
          <span className={`font-semibold tabular-nums ${loadColor(gpuBusy)}`}>GPU {gpuBusy}%</span>
        )}
      </span>

      {/* Pinned right: the sparkline resizes/redraws as history fills in,
          so keeping it last stops it shoving the readings left of it. */}
      <span className="flex items-center gap-0.5" title="CPU package temperature">
        <Cpu className="size-2.5 text-muted-foreground" aria-hidden />
        <span className={`font-semibold tabular-nums ${tempColor(pkg)}`}>
          {pkg != null ? `${pkg}°C` : "–"}
        </span>
        {history.length > 0 && <Sparkline data={history} color={tempHex(pkg)} />}
      </span>
    </div>
  );
}
