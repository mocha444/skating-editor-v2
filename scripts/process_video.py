#!/usr/bin/env python3
"""
MOG2 + morphology + contour filtering — best-practice motion detection.

Frames are piped straight from ffmpeg as raw grayscale at a low resolution and
a capped frame rate, so the expensive intermediate proxy re-encode is removed:
ffmpeg decodes + scales once, Python classifies. Frame-rate-sensitive parameters
(min-motion-frames / buffer-frames) are scaled from the source frame rate to the
detection frame rate so their time-based meaning is preserved.

When an Intel iGPU is available (/dev/dri/renderD128), ffmpeg decodes and
downscales on the GPU (vaapi + scale_vaapi) and only the tiny 320x180 frames
cross back — a large win on high-bitrate 4K HEVC. It falls back to CPU
automatically if the GPU path fails.
"""
import cv2, sys, os, json, argparse, subprocess
import numpy as np
from collections import deque

# --- Tunables (parse from CLI) ---
parser = argparse.ArgumentParser()
parser.add_argument('video_path', help='path to input video')
parser.add_argument('output_dir', nargs='?', default='/tmp/segments', help='where to write segment files')
parser.add_argument('--threshold', type=float, default=0.003, help='motion threshold (fraction of frame)')
parser.add_argument('--min-contour', type=int, default=50, help='minimum contour area')
parser.add_argument('--min-motion-frames', type=int, default=8, help='sustained motion frames (in source frames)')
parser.add_argument('--buffer-frames', type=int, default=60, help='pre/post-roll buffer in frames (in source frames)')
parser.add_argument('--history', type=int, default=300, help='MOG2 history length')
parser.add_argument('--var-threshold', type=int, default=25, help='MOG2 variance threshold')
parser.add_argument('--detect-shadows', action='store_true', default=False, help='detect shadow pixels')
parser.add_argument('--max-fps', type=float, default=30.0, help='cap on detection frame rate')
args = parser.parse_args()

video_path = args.video_path
output_dir = args.output_dir
min_contour_area = args.min_contour
motion_threshold = args.threshold
min_motion_frames = args.min_motion_frames
buffer_frames = args.buffer_frames
history = args.history
var_threshold = args.var_threshold
detect_shadows = args.detect_shadows
max_fps = args.max_fps

# --- Detection resolution (downscaled for speed) ---
W, H = 320, 180

VAAPI_DEVICE = "/dev/dri/renderD128"
GPU_AVAILABLE = os.path.exists(VAAPI_DEVICE)

def probe_fps(path: str) -> float:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error",
             "-select_streams", "v:0",
             "-show_entries", "stream=r_frame_rate",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True, timeout=15,
        )
        val = out.stdout.strip()
        if "/" in val:
            num, _, den = val.partition("/")
            num, den = float(num), float(den)
            if num > 0 and den > 0:
                return num / den
        elif val:
            fps = float(val)
            if fps > 0:
                return fps
    except Exception:
        pass
    return 30.0

src_fps = probe_fps(video_path)
det_fps = min(src_fps, max_fps) if src_fps > 0 else max_fps
rate_scale = det_fps / src_fps if src_fps > 0 else 1.0

# Scale frame-based tunables from source fps to detection fps (same wall-clock meaning)
min_motion_frames_eff = max(1, round(min_motion_frames * rate_scale))
buffer_frames_eff = round(buffer_frames * rate_scale)

print(
    f"[pipe] {os.path.basename(video_path)} src_fps={src_fps:.2f} det_fps={det_fps:.2f} "
    f"scale={W}x{H} min_motion_frames={min_motion_frames}->{min_motion_frames_eff} "
    f"buffer_frames={buffer_frames}->{buffer_frames_eff}",
    file=sys.stderr,
)

os.makedirs(output_dir, exist_ok=True)

def build_ffmpeg_cmd(use_gpu: bool):
    vf = f"scale_vaapi=w={W}:h={H},fps={det_fps:.3f},hwdownload,format=gray"
    if use_gpu:
        return ["ffmpeg", "-y", "-v", "error",
                "-hwaccel", "vaapi", "-hwaccel_device", VAAPI_DEVICE,
                "-hwaccel_output_format", "vaapi", "-extra_hw_frames", "48",
                "-i", video_path, "-vf", vf, "-f", "rawvideo", "-"]
    vf = f"scale={W}:{H},fps={det_fps:.3f}"
    return ["ffmpeg", "-y", "-v", "error", "-i", video_path,
            "-vf", vf, "-pix_fmt", "gray", "-f", "rawvideo", "-"]

def run_detection(cmd, gpu: bool):
    """Consume raw gray frames from ffmpeg; returns (starts, ends, frames, rc, err)."""
    fgbg = cv2.createBackgroundSubtractorMOG2(
        history=history, varThreshold=var_threshold, detectShadows=detect_shadows
    )
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

    frame_size = W * H
    motion_history = deque(maxlen=min_motion_frames_eff + 5)
    clip_starts = []
    clip_ends = []
    in_motion = False
    current_start = None
    frame_idx = 0
    frames_read = 0
    err_tail = ""

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=frame_size)

    try:
        while True:
            raw = proc.stdout.read(frame_size)
            if len(raw) < frame_size:
                break

            frame = np.frombuffer(raw, dtype=np.uint8).reshape((H, W))
            fgmask = fgbg.apply(frame)

            if detect_shadows:
                fgmask[fgmask == 127] = 0

            # Clean noise
            fgmask = cv2.morphologyEx(fgmask, cv2.MORPH_OPEN, kernel)
            fgmask = cv2.morphologyEx(fgmask, cv2.MORPH_CLOSE, kernel)

            # Contour filter — count only meaningful blobs
            contours, _ = cv2.findContours(fgmask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            motion_pixels = sum(cv2.contourArea(c) for c in contours if cv2.contourArea(c) > min_contour_area)
            has_motion = (motion_pixels / (W * H)) > motion_threshold
            motion_history.append(has_motion)

            if not in_motion and sum(motion_history) >= min_motion_frames_eff:
                in_motion = True
                current_start = max(0, frame_idx - buffer_frames_eff - min_motion_frames_eff)
            elif in_motion and sum(list(motion_history)[-min_motion_frames_eff:]) == 0:
                in_motion = False
                clip_ends.append(frame_idx + buffer_frames_eff)
                clip_starts.append(current_start)
                current_start = None

            frame_idx += 1
            frames_read = frame_idx
    finally:
        proc.stdout.close()
        err_tail = proc.stderr.read().decode(errors="replace")[-300:]
        proc.stderr.close()
        proc.wait()

    if in_motion and current_start is not None:
        clip_ends.append(frames_read - 1)
        clip_starts.append(current_start)
    clip_ends = [min(e, frames_read - 1) for e in clip_ends]
    return clip_starts, clip_ends, frames_read, proc.returncode, err_tail

starts, ends, frames_read, rc, err_tail = [], [], 0, 1, ""

commands = [build_ffmpeg_cmd(True)] if GPU_AVAILABLE else []
commands.append(build_ffmpeg_cmd(False))

for use_gpu, cmd in zip([True, False] if GPU_AVAILABLE else [False], commands):
    if not use_gpu:
        print("[gpu] /dev/dri/renderD128 not available — CPU decode", file=sys.stderr)
    starts, ends, frames_read, rc, err_tail = run_detection(cmd, use_gpu)
    if frames_read == 0 or rc != 0:
        if use_gpu:
            print(f"[gpu] vaapi decode failed (rc={rc}), falling back to CPU", file=sys.stderr)
            continue
        print(json.dumps({"error": f"ffmpeg pipe failed: {err_tail or 'no frames'}"}), file=sys.stderr)
        sys.exit(1)
    if use_gpu:
        print("[gpu] vaapi decode + scale_vaapi OK", file=sys.stderr)
    break

if frames_read == 0:
    print(json.dumps({"error": "no frames read"}), file=sys.stderr)
    sys.exit(1)

# Convert frame indices to seconds
segments = []
for s, e in zip(starts, ends):
    if e <= s:
        continue
    segments.append((round(s / det_fps, 2), round(e / det_fps, 2)))

# Merge segments <5s apart
merged = []
for s, e in segments:
    if merged and (s - merged[-1][1]) < 5.0:
        merged[-1] = (merged[-1][0], e)
    else:
        merged.append((s, e))
segments = [(round(s, 2), round(e, 2)) for s, e in merged if (e - s) > 0.5]

total = sum(e - s for s, e in segments)
print(f"[mog2+contour] {len(segments)} segs | {total:.1f}s total", file=sys.stderr)

print(json.dumps({"segments": segments, "count": len(segments)}))