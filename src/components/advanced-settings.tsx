"use client";

import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Info, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { DetectionSettings } from "@/lib/editor-types";
import { DEFAULT_SETTINGS } from "@/lib/editor-types";
import {
  Tooltip,
  TooltipPopup,
  TooltipPortal,
  TooltipPositioner,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const STORAGE_KEY = 'detection-settings-v2';
const STORAGE_KEY_LEGACY = 'detection-settings-v1';

type Props = {
  settings: DetectionSettings;
  onChange: (patch: Partial<DetectionSettings>) => void;
};

const HINTS: Record<string, string> = {
  threshold:
    "How much of the frame needs to be moving before it counts as skating (as a fraction, default 0.3%). Lower = more sensitive (may keep tiny movements), higher = less sensitive (may miss short clips).",
  minContour:
    "Smallest moving blob, in pixels, that still counts as motion. Raise it to ignore sensor noise and distant objects so they don't trigger cuts.",
  minMotionFrames:
    "How many moving frames in a row are needed before a clip starts. Prevents random flashes — a flash, a camera glitch, a bird flying by — from starting a clip.",
  bufferFrames:
    "Padding left before and after each clip so the cuts don't slice butts into the action — the start/end of the movement still gets kept.",
  history:
    "How many frames the background model 'remembers'. Higher = smoother but adapts slower to lighting changes; lower = adapts fast to changes like a shadow passing over the rink.",
  varThreshold:
    "Per-pixel sensitivity to brightness changes. Lower = catches smaller differences (more eager to detect motion), higher = only counts clear movement.",
  detectShadows:
    "Treat shadows as background instead of motion. Keeps your own shadow gliding across the rink from being counted as skating — slightly slower to compute.",
};

const labelMap: Record<string, string> = {
  Threshold: "threshold",
  "Min contour px": "minContour",
  "Min motion frames": "minMotionFrames",
  "Buffer frames": "bufferFrames",
  "MOG2 history": "history",
  "Var threshold": "varThreshold",
  "Detect shadows": "detectShadows",
};

function Hint({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setHover(false);
        setPinned(false);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHover(false);
        setPinned(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  return (
    <Tooltip open={open} onOpenChange={setHover}>
      <span ref={wrapRef} className="contents">
        <TooltipTrigger
          aria-label={`About ${label}`}
          onClick={() => setPinned((p) => !p)}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          className="group inline-flex cursor-help items-center gap-1 font-medium text-muted-foreground outline-none"
        >
          {children}
          <Info className="size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground" aria-hidden />
        </TooltipTrigger>
      </span>
      <TooltipPortal>
        <TooltipPositioner side="top" sideOffset={8}>
          <TooltipPopup>{hint}</TooltipPopup>
        </TooltipPositioner>
      </TooltipPortal>
    </Tooltip>
  );
}

function ResetButton({ label, onReset }: { label: string; onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={onReset}
      aria-label={`Reset ${label} to default`}
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 outline-none transition-colors hover:bg-muted hover:text-amber-400 focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <RotateCcw className="size-3" aria-hidden />
    </button>
  );
}

function NumberField({
  label,
  hint,
  value,
  step,
  min,
  onValue,
}: {
  label: string;
  hint: string;
  value: string;
  step: string;
  min: string;
  onValue: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="flex items-center gap-1">
        <Hint label={label} hint={hint}>{label}</Hint>
        <ResetButton label={label} onReset={() => onValue(DEFAULT_SETTINGS[labelMap[label] as keyof DetectionSettings])} />
      </span>
      <input
        type="number"
        aria-label={label}
        value={value}
        step={step}
        min={min}
        onChange={(e) => onValue(e.target.value)}
        className="h-8 rounded-md border border-border bg-input/40 px-2 font-mono text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
      />
    </div>
  );
}

// random rebuild trigger comment
export function AdvancedSettings({ settings, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const dirty = JSON.stringify(settings) !== JSON.stringify(DEFAULT_SETTINGS);

  useEffect(() => {
    try {
      // Migrate from legacy key so old stale settings are ignored
      const legacy = localStorage.getItem(STORAGE_KEY_LEGACY);
      const current = localStorage.getItem(STORAGE_KEY);
      if (legacy && !current) {
        localStorage.setItem(STORAGE_KEY, legacy);
      } else if (legacy && current) {
        localStorage.removeItem(STORAGE_KEY_LEGACY);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          onChange({ ...DEFAULT_SETTINGS, ...parsed });
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {}
  }, [settings]);

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
        <TooltipProvider>
          <div className="grid grid-cols-2 gap-3 border-t border-border px-4 py-4 sm:grid-cols-3 md:grid-cols-4">
            <NumberField
              label="Threshold" value={settings.threshold} step="0.001" min="0"
              hint={HINTS.threshold}
              onValue={(v) => onChange({ threshold: v })}
            />
            <NumberField
              label="Min contour px" value={settings.minContour} step="1" min="0"
              hint={HINTS.minContour}
              onValue={(v) => onChange({ minContour: v })}
            />
            <NumberField
              label="Min motion frames" value={settings.minMotionFrames} step="1" min="1"
              hint={HINTS.minMotionFrames}
              onValue={(v) => onChange({ minMotionFrames: v })}
            />
            <NumberField
              label="Buffer frames" value={settings.bufferFrames} step="1" min="0"
              hint={HINTS.bufferFrames}
              onValue={(v) => onChange({ bufferFrames: v })}
            />
            <NumberField
              label="MOG2 history" value={settings.history} step="10" min="10"
              hint={HINTS.history}
              onValue={(v) => onChange({ history: v })}
            />
            <NumberField
              label="Var threshold" value={settings.varThreshold} step="1" min="1"
              hint={HINTS.varThreshold}
              onValue={(v) => onChange({ varThreshold: v })}
            />
            <div className="flex items-end gap-2 text-xs">
              <input
                id="detect-shadows"
                type="checkbox"
                checked={settings.detectShadows === "true"}
                onChange={(e) => onChange({ detectShadows: String(e.target.checked) })}
                className="size-4 accent-amber-400"
              />
              <label
                htmlFor="detect-shadows"
                className="flex cursor-pointer items-center gap-1 font-medium text-muted-foreground"
              >
              <Hint label="Detect shadows" hint={HINTS.detectShadows}>
                  Detect shadows
                </Hint>
                <button
                  type="button"
                  onClick={() => onChange({ detectShadows: DEFAULT_SETTINGS.detectShadows })}
                  aria-label="Reset Detect shadows to default"
                  className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 outline-none transition-colors hover:bg-muted hover:text-amber-400 focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <RotateCcw className="size-3" aria-hidden />
                </button>
              </label>
            </div>
          </div>
        </TooltipProvider>
      )}
    </section>
  );
}