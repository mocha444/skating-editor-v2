"use client";

import { useDropzone } from "react-dropzone";
import { CloudUpload, FileVideo, X } from "lucide-react";
import { fmtBytes } from "@/lib/editor-types";

type Props = {
  file: File | null;
  busy: boolean;
  hashing: boolean;
  onFileSelected: (f: File) => void;
  onClear: () => void;
};

export function UploadZone({ file, busy, hashing, onFileSelected, onClear }: Props) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "video/mp4": [".mp4"] },
    multiple: false,
    noClick: busy || hashing,
    noKeyboard: busy || hashing,
    onDropAccepted: (files) => {
      if (files[0]) onFileSelected(files[0]);
    },
  });

  return (
    <section
      {...getRootProps()}
      aria-label="Video upload dropzone"
      className={`relative flex w-full flex-col items-center rounded-3xl border-2 border-dashed p-10 text-center transition-colors outline-none sm:p-16 ${
        isDragActive
          ? "border-amber-400 bg-amber-400/10"
          : "border-border bg-card hover:border-input hover:bg-muted/40"
      } ${busy || hashing ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
    >
      <input {...getInputProps()} />

      {file ? (
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-3">
            <FileVideo className="size-8 shrink-0 text-amber-400" aria-hidden />
            <p className="max-w-xs truncate text-lg font-semibold">{file.name}</p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              tabIndex={-1}
              aria-label={`Remove ${file.name}`}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <p className="text-xs font-mono text-muted-foreground">
            {file.type || "unknown"} · {fmtBytes(file.size)} · .{file.name.split(".").pop()}
          </p>
          {hashing && <p className="text-xs text-amber-400">Checking for duplicates…</p>}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <CloudUpload className="size-10 text-amber-400" aria-hidden />
          <p className="text-xl font-semibold">
            {isDragActive ? "Drop to upload" : "Drag & drop your .mp4"}
          </p>
          <p className="text-sm text-muted-foreground">
            or click to browse — we&apos;ll cut out the dead air
          </p>
        </div>
      )}
    </section>
  );
}