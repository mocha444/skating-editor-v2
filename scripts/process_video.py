#!/usr/bin/env python3
"""
MOG2 + morphology + contour filtering — best-practice motion detection.
Based on the proven pattern: learn background, clean mask, filter by contour size,
require sustained motion to start/end a clip.
"""
import cv2, sys, os, json, argparse
from collections import deque

# --- Tunables (parse from CLI) ---
parser = argparse.ArgumentParser()
parser.add_argument('video_path', help='path to input video')
parser.add_argument('output_dir', nargs='?', default='/tmp/segments', help='where to write segment files')
parser.add_argument('--threshold', type=float, default=0.003, help='motion threshold (fraction of frame)')
parser.add_argument('--min-contour', type=int, default=50, help='minimum contour area')
parser.add_argument('--min-motion-frames', type=int, default=8, help='sustained motion frames')
parser.add_argument('--buffer-frames', type=int, default=60, help='pre/post-roll buffer in frames')
parser.add_argument('--history', type=int, default=300, help='MOG2 history length')
parser.add_argument('--var-threshold', type=int, default=25, help='MOG2 variance threshold')
parser.add_argument('--detect-shadows', action='store_true', default=False, help='detect shadow pixels')
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

# --- Auto 720p proxy for 4K videos (huge speed boost on MOG2 + cutting) ---
proxy_path = video_path.replace(".mp4", "_720p.mp4")
if video_path.endswith(".mp4"):
    import subprocess
    if not os.path.exists(proxy_path):
        print(f"[proxy] Creating 720p proxy...", file=sys.stderr)
        subprocess.run([
            "ffmpeg", "-y", "-i", video_path,
            "-vf", "scale=1280:720",
            "-c:v", "libx264", "-crf", "23", "-preset", "fast",
            "-c:a", "aac", "-b:a", "128k",
            proxy_path
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if os.path.exists(proxy_path):
        use_path = proxy_path
    else:
        print(json.dumps({"error": f"proxy creation failed for {video_path}"}), file=sys.stderr)
        sys.exit(1)
else:
    use_path = video_path

os.makedirs(output_dir, exist_ok=True)
cap = cv2.VideoCapture(use_path)
if not cap.isOpened():
    print(json.dumps({"error": f"cannot open {video_path}"}))
    sys.exit(1)

fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
total_pixels = width * height

# Downscale for speed
W, H = 320, 180
total_pixels_small = W * H

fgbg = cv2.createBackgroundSubtractorMOG2(
    history=history, varThreshold=var_threshold, detectShadows=detect_shadows
)
kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

motion_history = deque(maxlen=min_motion_frames + 5)
clip_starts = []
clip_ends = []
in_motion = False
frame_idx = 0
current_start = None
fps_frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

print(f"[mog2+contour] fps={fps:.1f} {width}x{height} ({fps_frame_count}f) min_contour={min_contour_area} min_motion_frames={min_motion_frames}", file=sys.stderr)

while True:
    ret, frame = cap.read()
    if not ret: break

    # Downscale for speed
    small = cv2.resize(frame, (W, H))
    fgmask = fgbg.apply(small)

    if detect_shadows:
        fgmask[fgmask == 127] = 0

    # Clean noise
    fgmask = cv2.morphologyEx(fgmask, cv2.MORPH_OPEN, kernel)
    fgmask = cv2.morphologyEx(fgmask, cv2.MORPH_CLOSE, kernel)

    # Contour filter — count only meaningful blobs
    contours, _ = cv2.findContours(fgmask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    motion_pixels = sum(cv2.contourArea(c) for c in contours if cv2.contourArea(c) > min_contour_area)
    motion_ratio = motion_pixels / total_pixels_small
    has_motion = motion_ratio > motion_threshold
    motion_history.append(has_motion)

    if not in_motion and sum(motion_history) >= min_motion_frames:
        in_motion = True
        current_start = max(0, frame_idx - buffer_frames - min_motion_frames)
    elif in_motion and sum(list(motion_history)[-min_motion_frames:]) == 0:
        in_motion = False
        end = min(frame_idx + buffer_frames, fps_frame_count - 1)
        clip_starts.append(current_start)
        clip_ends.append(end)
        current_start = None

    frame_idx += 1

if in_motion and current_start is not None:
    clip_ends.append(frame_idx - 1)
    clip_starts.append(current_start)

cap.release()

# Convert frame indices to seconds
segments = []
for s, e in zip(clip_starts, clip_ends):
    segments.append((round(s / fps, 2), round(e / fps, 2)))

# Merge segments <4s apart
merged = []
for s, e in segments:
    if merged and (s - merged[-1][1]) < 5.0:
        merged[-1] = (merged[-1][0], e)
    else:
        merged.append((s, e))
segments = [(round(s,2), round(e,2)) for s,e in merged if (e - s) > 0.5]

total = sum(e - s for s, e in segments)
print(f"[mog2+contour] {len(segments)} segs | {total:.1f}s total", file=sys.stderr)

print(json.dumps({"segments": segments, "count": len(segments)}))
