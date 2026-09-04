#!/usr/bin/env python3
"""Fast pixel-diff motion detection with parallel batches."""
import cv2, sys, os, json
from concurrent.futures import ProcessPoolExecutor
import time

def process_batch(batch_args):
    cap_path, start_idx, count, W, H = batch_args
    cap = cv2.VideoCapture(cap_path)
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_idx)
    results = []
    prev = None
    for _ in range(count):
        ret, frame = cap.read()
        if not ret: break
        small = cv2.resize(frame, (W, H))
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        if prev is not None:
            diff = cv2.absdiff(gray, prev)
            score = float(diff.mean())
            results.append((t, score))
        prev = gray
    cap.release()
    return results

video_path = sys.argv[1]
out_dir = sys.argv[2] if len(sys.argv) > 2 else "/tmp/segments"
os.makedirs(out_dir, exist_ok=True)

t_start = time.time()

cap = cv2.VideoCapture(video_path)
if not cap.isOpened():
    print(json.dumps({"error": f"cannot open {video_path}"}))
    sys.exit(1)
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
duration = total_frames / fps if fps else 0
W, H = 320, 180  # smaller = faster
cap.release()

# Larger batches = less worker overhead
batch_size = max(100, int(fps * 4))
batches = [(video_path, i, batch_size, W, H) for i in range(0, total_frames - 1, batch_size)]

# Process batches in parallel
t0 = time.time()
with ProcessPoolExecutor(max_workers=4) as ex:
    batch_results = list(ex.map(process_batch, batches))
t_detect = time.time() - t0

# Merge
all_scores = []
for res in batch_results:
    all_scores.extend(res)

if not all_scores:
    print(json.dumps({"segments": [], "count": 0}))
    sys.exit(0)

scores = [s for _, s in all_scores]
baseline = min(s for s in scores if s > 0)
threshold = baseline * 3.0

# Detect segments
segments = []
start = None
last_motion = 0.0
debounce = 1.5
for t, s in all_scores:
    if s > threshold:
        if start is None: start = t
        last_motion = t
    else:
        if start is not None and (t - last_motion) > debounce:
            segments.append((start, last_motion))
            start = None
if start is not None:
    end = duration
    if end > start: segments.append((start, end))

# Merge close
merged = []
for s, e in segments:
    if merged and (s - merged[-1][1]) < 4.0:
        merged[-1] = (merged[-1][0], e)
    else:
        merged.append((s, e))
segments = [(round(s, 2), round(e, 2)) for s, e in merged if (e - s) > 0.3]

total = sum(e - s for s, e in segments)
t_total = time.time() - t_start

print(f"[fast] {len(all_scores)} frames | {len(segments)} segs | {total:.1f}s | detect={t_detect:.1f}s total={t_total:.1f}s threshold={threshold:.2f}", file=sys.stderr)
print(json.dumps({"segments": segments, "count": len(segments)}))
