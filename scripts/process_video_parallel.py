#!/usr/bin/env python3
"""Parallel version — frames processed in batches via ProcessPoolExecutor."""
import cv2, sys, os, json, statistics
from concurrent.futures import ProcessPoolExecutor

def process_batch(batch_args):
    """Process a chunk of frames; returns list of (t, score)"""
    cap_path, start_idx, count, W, H, LOW, HIGH = batch_args
    cap = cv2.VideoCapture(cap_path)
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_idx)
    results = []
    prev = None
    for _ in range(count):
        ret, frame = cap.read()
        if not ret: break
        small = cv2.resize(frame, (W, H))
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, LOW, HIGH)
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        if prev is not None:
            diff = cv2.absdiff(edges, prev)
            score = float(diff.sum() / 255)
            results.append((t, score))
        prev = edges
    cap.release()
    return results

video_path = sys.argv[1]
out_dir = sys.argv[2] if len(sys.argv) > 2 else "/tmp/segments"
os.makedirs(out_dir, exist_ok=True)

cap = cv2.VideoCapture(video_path)
if not cap.isOpened():
    print(json.dumps({"error": f"cannot open {video_path}"}))
    sys.exit(1)

total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
duration = total_frames / fps if fps else 0
W, H = 480, 270
LOW, HIGH = 50, 150

# Batch size: ~100 frames (~1.7s at 59fps) — good parallel chunk
batch_size = max(50, int(fps * 2))
batches = [(video_path, i, batch_size, W, H, LOW, HIGH) for i in range(0, total_frames - 1, batch_size)]

with ProcessPoolExecutor(max_workers=4) as ex:
    batch_results = list(ex.map(process_batch, batches))

# Merge in order
all_scores = []
for res in sorted(batch_results, key=lambda r: r[0][0] if r else 0):
    all_scores.extend(res)

scores = [s for _, s in all_scores]
baseline = min(s for s in scores if s > 0)
threshold = baseline * 3.0

# Second pass: reconstruct timing from scores (simplified — use first score's time + index)
segments = []
start = None
last_motion = 0.0
debounce = 1.5
for idx, (t, s) in enumerate(all_scores):
    if s > threshold:
        if start is None:
            start = t
        last_motion = t
    else:
        if start is not None and (t - last_motion) > debounce:
            segments.append((start, last_motion))
            start = None
if start is not None:
    end = duration
    if end > start:
        segments.append((start, end))

# Merge close
merged = []
for s, e in segments:
    if merged and (s - merged[-1][1]) < 4.0:
        merged[-1] = (merged[-1][0], e)
    else:
        merged.append((s, e))
segments = [(round(s, 2), round(e, 2)) for s, e in merged if (e - s) > 0.3]

total = sum(e - s for s, e in segments)
print(f"[parallel] {len(all_scores)} frames | {len(segments)} segs | {total:.1f}s | threshold={threshold:.0f}", file=sys.stderr)
with open(os.path.join("/home/b/skating-editor-v2/public/uploads/progress", os.path.basename(video_path).replace(".","_") + ".json"), "w") as f:
    f.write(json.dumps({"done": True, "count": len(segments), "step": "detect", "threshold": round(threshold, 2), "total": round(total, 2)}))
print(json.dumps({"segments": segments, "count": len(segments)}))
