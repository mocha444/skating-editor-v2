import { NextResponse } from "next/server";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readInt(path: string): number | null {
  try {
    const raw = readFileSync(path, "utf8").trim();
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Resolve the coretemp hwmon dir (e.g. /sys/class/hwmon/hwmon0). */
function coretempDir(): string | null {
  try {
    for (const dir of readdirSync("/sys/class/hwmon")) {
      const name = readFileSync(`/sys/class/hwmon/${dir}/name`, "utf8").trim();
      if (name === "coretemp") return `/sys/class/hwmon/${dir}`;
    }
  } catch {
    /* not mounted / not present */
  }
  return null;
}

function readCpuTemps() {
  const dir = coretempDir();
  const cpu = { package: null as number | null, cores: [] as number[] };
  if (!dir) return cpu;
  try {
    for (const file of readdirSync(dir)) {
      const m = /^temp(\d+)_input$/.exec(file);
      if (!m) continue;
      const idx = m[1];
      let label = "";
      try {
        label = readFileSync(`${dir}/temp${idx}_label`, "utf8").trim();
      } catch {
        /* label file not present */
      }
      const value = readInt(`${dir}/${file}`);
      if (value == null) continue;
      const celsius = value / 1000;
      if (label.toLowerCase().includes("package")) {
        cpu.package = celsius;
      } else if (label.toLowerCase().includes("core")) {
        cpu.cores.push(celsius);
      }
    }
  } catch {
    /* ignore */
  }
  return cpu;
}

function readCpuTicks() {
  const line = readFileSync("/proc/stat", "utf8").split("\n")[0];
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = (parts[3] ?? 0) + (parts[4] ?? 0); // idle + iowait
  const total = parts.reduce((a, b) => a + (b || 0), 0);
  return { idle, total };
}

/** CPU utilization % measured over a short sampling window. */
async function readCpuLoad(): Promise<number> {
  try {
    const a = readCpuTicks();
    await sleep(500);
    const b = readCpuTicks();
    const total = b.total - a.total;
    const idle = b.idle - a.idle;
    if (total <= 0) return 0;
    const pct = ((total - idle) / total) * 100;
    return Math.round(Math.max(0, Math.min(100, pct)));
  } catch {
    return 0;
  }
}

function readGpuState() {
  const base = "/sys/class/drm/card0/gt/gt0";
  const freq = readInt(`${base}/rps_act_freq_mhz`);
  const max = readInt(`${base}/rps_max_freq_mhz`);
  // Intel iGPUs typically don't expose a temperature node; temp stays null.
  const temp = readInt("/sys/class/drm/card0/device/hwmon/hwmon1/temp1_input") ?? null;
  // rc6_residency_ms = cumulative ms the GPU spent in its deepest sleep state.
  // Deltas over a window give TRUE utilization (i915 docs recommend this).
  // Frequency (rps_act_freq_mhz) is NOT load: iGPU clocks top out below the
  // max bin under sustained media load, so freq/max reads ~83% forever even
  // when the GPU is 100% busy.
  const rc6ms = readInt(`${base}/rc6_residency_ms`);
  return { temp, freqMhz: freq, maxFreqMhz: max, rc6ms };
}

export async function GET() {
  // Sample CPU + GPU over ONE shared window so the metrics line up.
  const t0 = Date.now();
  const cpuA = readCpuTicks();
  const gpuA = readGpuState();
  await sleep(1000);
  const cpuB = readCpuTicks();
  const gpuB = readGpuState();

  // CPU utilization over the window.
  const cTotal = cpuB.total - cpuA.total;
  const cIdle = cpuB.idle - cpuA.idle;
  const cpuLoad =
    cTotal > 0 ? Math.round(Math.max(0, Math.min(100, ((cTotal - cIdle) / cTotal) * 100))) : 0;

  // GPU busy% = time NOT in rc6 over the window.
  const elapsed = Math.max(1, Date.now() - t0);
  const rc6Delta = gpuA.rc6ms != null && gpuB.rc6ms != null ? gpuB.rc6ms - gpuA.rc6ms : null;
  const gpuBusy =
    rc6Delta != null && rc6Delta >= 0 && rc6Delta < elapsed
      ? Math.round(Math.max(0, Math.min(100, 100 - (rc6Delta * 100) / elapsed)))
      : null; // rc6 unavailable or counter wrapped — treat as unknown

  return NextResponse.json({
    cpu: { ...readCpuTemps(), load: cpuLoad },
    gpu: {
      temp: gpuB.temp ?? gpuA.temp,
      freqMhz: gpuB.freqMhz,
      maxFreqMhz: gpuB.maxFreqMhz,
      busy: gpuBusy,
    },
  });
}
