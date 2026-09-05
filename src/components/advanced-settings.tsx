"use client";

import { useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import type { DetectionSettings } from "@/lib/editor-types";
import { DEFAULT_SETTINGS } from "@/lib/editor-types";

type Props = {
  settings: DetectionSettings;
  onChange: (patch: Partial<DetectionSettings>) => void;
};

function NumberField({
  label,
  value,
  step,
  min,
  onValue,
}: {
  label: string;
  value: string;
  step: string;
  min: string;
  onValue: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={(e) => onValue(e.target.value)}
        className="h-8 rounded-md border border-border bg-input/40 px-2 font-mono text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
      />
    </label>
  );
}

export function AdvancedSettings({ settings, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const dirty = JSON.stringify(settings) !== JSON.stringify(DEFAULT_SETTINGS);

  return (
    <section className="w-full rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden />
          Detection settings
          {dirty && (
            <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">
              customized
            </span>
          )}
        </span>
        <ChevronDown
          className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="grid grid-cols-2 gap-3 border-t border-border px-4 py-4 sm:grid-cols-3 md:grid-cols-4">
          <NumberField
            label="Threshold" value={settings.threshold} step="0.001" min="0"
            onValue={(v) => onChange({ threshold: v })}
          />
          <NumberField
            label="Min contour px" value={settings.minContour} step="1" min="0"
            onValue={(v) => onChange({ minContour: v })}
          />
          <NumberField
            label="Min motion frames" value={settings.minMotionFrames} step="1" min="1"
            onValue={(v) => onChange({ minMotionFrames: v })}
          />
          <NumberField
            label="Buffer frames" value={settings.bufferFrames} step="1" min="0"
            onValue={(v) => onChange({ bufferFrames: v })}
          />
          <NumberField
            label="MOG2 history" value={settings.history} step="10" min="10"
            onValue={(v) => onChange({ history: v })}
          />
          <NumberField
            label="Var threshold" value={settings.varThreshold} step="1" min="1"
            onValue={(v) => onChange({ varThreshold: v })}
          />
          <label className="flex items-end gap-2 text-xs">
            <input
              type="checkbox"
              checked={settings.detectShadows === "true"}
              onChange={(e) => onChange({ detectShadows: String(e.target.checked) })}
              className="size-4 accent-amber-400"
            />
            <span className="font-medium text-muted-foreground">Detect shadows</span>
          </label>
        </div>
      )}
    </section>
  );
}