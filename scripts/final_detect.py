#!/usr/bin/env python3
import cv2, sys, os, json, time

video_path = sys.argv[1]
cap = cv2.VideoCapture(video_path)
if not cap.isOpened():
    print(json.dumps({"error": f"cannot open {video_path}"}))
    sys.exit(1)

fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
duration = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) / fps
W, H = 320, 180
prev = None
frames_data = []  # (t, max_diff)

print(f"[final] fps={fps:.1f} duration={duration:.1f}s", file=sys.stderr)

# ── Pass 1: collect max-diff per frame ──
while True:
    ret, frame = cap.read()
    if not ret: break
    small = cv2.resize(frame, (W, H))
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
    if prev is not None:
        diff = cv2.absdiff(gray, prev)
        frames_data.append((t, float(diff.max())))
    prev = gray

if not frames_data:
    print(json.dumps({"segments": [], "count": 0}))
    sys.exit(0)

# ── Pass 2: auto-threshold using the 50th percentile (median) of diffs ──
# Reasoning: in a typical 30s clip, the skater is moving ~50% of the time.
# The median of frame-to-frame max diffs ≈ noise floor for "still" frames
# So threshold = median * 1.2 catches real motion vs codec artifacts.
all_max = sorted(s for _, s in frames_data)
median = all_max[len(all_max) // 2]
threshold = max(8.0, median * 1.2)  # 8.0 floor to avoid noise

segments = []
start = None
last_motion = 0.0
debounce = 1.5

for t, score in frames_data:
    if score > threshold:
        if start is None: start = t
        last_motion = t
    else:
        if start is not None and (t - last_motion) > debounce:
            segments.append((start, last_motion))
            start = None

if start is not None:
    segments.append((start, duration))

merged = []
for s, e in segments:
    if merged and (s - merged[-1][1]) < 4.0:
        merged[-1] = (merged[-1][0], e)
    else:
        merged.append((s, e))
segments = [(round(s,2), round(e,2)) for s,e in merged if (e - s) > 0.3]

total = sum(e - s for s, e in segments)
print(f"[final] median={median:.1f} thr={threshold:.1f} | {len(segments)} segs | {total:.1f}s", file=sys.stderr)
print(json.dumps({"segments": segments, "count": len(segments)}))
