"use client";

import { useEffect, useState } from "react";
import { Cpu, CircuitBoard } from "lucide-react";

type Temps = {
  cpu: { package: number | null; cores: number[]; load: number };
  gpu: { temp: number | null; freqMhz: number | null; maxFreqMhz: number | null; busy: number | null };
};

const HISTORY = 40; // ~2 minutes at a 3s poll

function tempColor(t: number | null): string {
  if (t == null) return "text-zinc-500";
  if (t < 60) return "text-emerald-400";
  if (t < 80) return "text-amber-400";
  return "text-red-400";
}

function loadColor(l: number): string {
  if (l < 40) return "text-sky-400";
  if (l < 75) return "text-amber-400";
  return "text-red-400";
}

function tempHex(t: number | null): string {
  if (t == null) return "#71717a";
  if (t < 60) return "#34d399"; // emerald-400
  if (t < 80) return "#fbbf24"; // amber-400
  return "#f87171"; // red-400
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 72;
  const h = 20;
  if (data.length < 2) {
    return <span className="inline-block h-[20px] w-[72px]" />;
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
  const freqLabel =
    gpu?.freqMhz != null && gpu?.maxFreqMhz != null ? `${gpu.freqMhz}/${gpu.maxFreqMhz} MHz` : null;

  return (
    <div className="flex w-full max-w-2xl flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-zinc-400" aria-hidden />
          <span className={`text-sm font-semibold tabular-nums ${tempColor(pkg)}`}>
            {pkg != null ? `${pkg}°C` : "–"}
          </span>
          {history.length > 0 && <Sparkline data={history} color={tempHex(pkg)} />}
        </div>

        {cpu && cpu.cores.length > 0 && (
          <div className="flex items-center gap-1.5" title="Per-core temperatures">
            {cpu.cores.map((c, i) => (
              <span key={i} className={`text-xs font-medium tabular-nums ${tempColor(c)}`} title={`Core ${i}`}>
                {c}°
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2" title="GPU busy % from rc6 residency · clock frequency">
          <CircuitBoard className="size-4 text-zinc-400" aria-hidden />
          {gpuBusy == null ? (
            <span className="text-sm font-semibold text-zinc-500">GPU n/a</span>
          ) : gpuBusy <= 0 ? (
            <span className="text-sm font-semibold text-zinc-500">GPU idle</span>
          ) : (
            <span className={`text-sm font-semibold tabular-nums ${loadColor(gpuBusy)}`}>GPU {gpuBusy}%</span>
          )}
          {freqLabel && (
            <span className="text-[10px] tabular-nums text-zinc-500" title="Actual / max clock (not load)">
              {freqLabel}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-zinc-500">
        <span className="tabular-nums">
          CPU <span className={`font-semibold ${loadColor(cpuLoad)}`}>{cpuLoad}%</span>
        </span>
      </div>
    </div>
  );
}
