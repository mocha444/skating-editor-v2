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

  const ext = (file?.name.split(".").pop() ?? "").toUpperCase() || file?.type || "FILE";

  return (
    <section
      {...getRootProps()}
      aria-label="Video upload dropzone"
      className={`relative flex w-full flex-col items-center rounded-3xl border-2 border-dashed p-8 text-center transition-colors outline-none sm:p-12 ${
        isDragActive
          ? "border-amber-400 bg-amber-400/10"
          : "border-border bg-card hover:border-input hover:bg-muted/40"
      } ${busy || hashing ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
    >
      <input {...getInputProps()} />

      {file ? (
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-3">
            <FileVideo className="size-8 shrink-0 text-amber-400" aria-hidden />
            <p className="max-w-xs truncate text-lg font-semibold">{file.name}</p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              aria-label={`Remove ${file.name}`}
              className="rounded-md p-1 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            {ext} · {fmtBytes(file.size)}
            {hashing && (
              <span className="ml-1.5 text-amber-400">· checking for duplicates…</span>
            )}
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <CloudUpload className="size-10 text-amber-400" aria-hidden />
          <p className="text-xl font-semibold">
            {isDragActive ? "Drop it!" : "Drag & drop your video"}
          </p>
          <p className="text-sm text-muted-foreground">
            or click to browse — MP4 works best
          </p>
        </div>
      )}
    </section>
  );
}