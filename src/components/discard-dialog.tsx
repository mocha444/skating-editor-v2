"use client";

import { RefreshCw, Trash2, TriangleAlert } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Destructive confirm shown when the user leaves a finished, NOT-yet-downloaded
 * result behind (Process another, uploading a new file, or re-processing the
 * same video). Two flavours:
 *
 *  - "discard": the whole dir goes away — source video, clips, segments, logs.
 *  - "replace": re-processing the same source — input kept, old output deleted
 *    once the new edit lands.
 */
type DiscardMode = "discard" | "replace";

type Props = {
  open: boolean;
  mode: DiscardMode;
  /** Display name of the video at risk (original file name or dir). */
  name: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const TITLES: Record<DiscardMode, string> = {
  discard: "Delete this video?",
  replace: "Replace this edit?",
};

export function DiscardDialog({ open, mode, name, busy, onCancel, onConfirm }: Props) {
  const replace = mode === "replace";
  return (
    <Dialog
      open={open}
      // Force an explicit choice: backdrop clicks / Esc won't silently dismiss a
      // destructive prompt.
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      disablePointerDismissal
    >
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <div className="flex flex-col items-center gap-4 py-1 sm:items-start">
          <div
            className={`flex size-11 shrink-0 items-center justify-center rounded-full ring-1 ${
              replace
                ? "bg-amber-400/10 text-amber-400 ring-amber-400/30"
                : "bg-destructive/10 text-destructive ring-destructive/25"
            }`}
          >
            {replace ? (
              <RefreshCw className="size-5" aria-hidden />
            ) : (
              <Trash2 className="size-5" aria-hidden />
            )}
          </div>

          <DialogHeader>
            <DialogTitle>{TITLES[mode]}</DialogTitle>
            <DialogDescription>
              {replace ? (
                <>
                  <span className="font-semibold text-foreground">{name}</span> hasn&apos;t been
                  downloaded. Re-processing replaces it with a fresh edit — the old clips and
                  segments are permanently deleted.
                </>
              ) : (
                <>
                  <span className="font-semibold text-foreground">{name}</span> hasn&apos;t been
                  downloaded. Moving on permanently deletes the source video, its clips and
                  segments from the server.
                </>
              )}
              <span className="mt-2 flex items-center gap-1.5 font-medium text-foreground/80">
                <TriangleAlert className="size-3.5 shrink-0 text-amber-400" aria-hidden />
                There&apos;s no going back.
              </span>
            </DialogDescription>
          </DialogHeader>
        </div>

        <DialogFooter className="mt-5">
          <Button variant="ghost" onClick={onCancel} disabled={busy} className="sm:flex-none">
            Cancel
          </Button>
          <Button
            variant={replace ? "default" : "destructive"}
            onClick={onConfirm}
            disabled={busy}
            className="sm:flex-none"
          >
            {replace ? (
              <>
                <RefreshCw aria-hidden />
                Yes, re-process
              </>
            ) : (
              <>
                <Trash2 aria-hidden />
                Yes, delete it
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
