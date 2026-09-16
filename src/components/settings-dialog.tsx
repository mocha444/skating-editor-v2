"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, SlidersHorizontal, Terminal } from "lucide-react";

import type { DetectionSettings } from "@/lib/editor-types";
import { DEFAULT_SETTINGS } from "@/lib/editor-types";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdvancedSettings } from "@/components/advanced-settings";
import { LogPanel } from "@/components/log-panel";
import { SystemTemps } from "@/components/system-temps";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: DetectionSettings;
  onSettingsChange: (patch: Partial<DetectionSettings>) => void;
  logs: string[];
  autoScroll: boolean;
  onToggleAutoScroll: (v: boolean) => void;
  onAppendLog: (line: string) => void;
};

type Section = "settings" | "logs";

/**
 * One home for everything you only glance at occasionally:
 * detection knobs and live build output (both collapsed by default),
 * with live hardware temps pinned at the bottom.
 */
export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
  logs,
  autoScroll,
  onToggleAutoScroll,
  onAppendLog,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<Section, boolean>>({
    settings: true,
    logs: true,
  });

  const customized = JSON.stringify(settings) !== JSON.stringify(DEFAULT_SETTINGS);

  const toggle = (s: Section) => setCollapsed((prev) => ({ ...prev, [s]: !prev[s] }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl flex-col gap-3 overflow-y-auto p-4 sm:p-5">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>Settings &amp; diagnostics</DialogTitle>
          <DialogDescription>
            Motion-detection tuning, live output, and hardware stats.
          </DialogDescription>
        </DialogHeader>

        {/* Detection Settings (the section header is the toggle — the knobs render bare inside) */}
        <SectionHeader label="Detection settings" icon={<SlidersHorizontal className="size-4" />} collapsed={collapsed.settings} onToggle={() => toggle("settings")} badge={customized && (
          <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
            customized
          </span>
        )} />
        {!collapsed.settings && (
          <AdvancedSettings settings={settings} onChange={onSettingsChange} />
        )}

        {/* Build Logs */}
        <SectionHeader label="Build log" icon={<Terminal className="size-4" />} collapsed={collapsed.logs} onToggle={() => toggle("logs")} />
        {!collapsed.logs && (
          <LogPanel
            logs={logs}
            autoScroll={autoScroll}
            onToggleAutoScroll={onToggleAutoScroll}
            onAppendLog={onAppendLog}
          />
        )}

        {/* Live hardware temps — always visible, no toggle */}
        <div className="border-t border-border/60 pt-2">
          <SystemTemps />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionHeader({
  label,
  icon,
  badge,
  collapsed,
  onToggle,
}: {
  label: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors hover:bg-muted/40"
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
        {badge}
      </span>
      {collapsed ? (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
    </button>
  );
}
