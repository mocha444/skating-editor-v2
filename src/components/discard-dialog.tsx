"use client";

import { Trash2, TriangleAlert } from "lucide-react";

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
 * result behind (Process another or uploading a new file). The whole dir goes
 * away — source video, clips, segments, logs.
 */
type Props = {
  open: boolean;
  /** Display name of the video at risk (original file name or dir). */
  name: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DiscardDialog({ open, name, busy, onCancel, onConfirm }: Props) {
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
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive ring-1 ring-destructive/25">
            <Trash2 className="size-5" aria-hidden />
          </div>

          <DialogHeader>
            <DialogTitle>Delete this video?</DialogTitle>
            <DialogDescription>
              <span className="font-semibold text-foreground">{name}</span> hasn&apos;t been
              downloaded. Moving on permanently deletes the source video, its clips and
              segments from the server.
              <span className="mt-2 flex items-center gap-1.5 font-medium text-foreground/80">
                <TriangleAlert className="size-3.5 shrink-0 text-primary" aria-hidden />
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
            variant="destructive"
            onClick={onConfirm}
            disabled={busy}
            className="sm:flex-none"
          >
            <Trash2 aria-hidden />
            Yes, delete it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
