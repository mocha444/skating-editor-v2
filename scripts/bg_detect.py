#!/usr/bin/env python3
"""
Motion detection using background subtraction.
Learns the static scene, only fires when something actually moves.
Much better than raw pixel diff — ignores codec noise, camera shake, lighting drift.
"""
import cv2, sys, os, json, time
from concurrent.futures import ProcessPoolExecutor

def process_batch(batch_args):
    cap_path, start_idx, count, W, H, init_frames = batch_args
    cap = cv2.VideoCapture(cap_path)
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_idx)
    results = []
    # Background subtractor (MOG2) — adapts to scene over time
    bg = cv2.createBackgroundSubtractorMOG2(history=50, varThreshold=25, detectShadows=False)
    # Pre-train on the first init_frames frames
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    warmup = min(init_frames, 30)
    for _ in range(warmup):
        ret, frame = cap.read()
        if not ret: break
        small = cv2.resize(frame, (W, H))
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        bg.apply(gray)
    # Now go to actual batch start
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_idx)
    for _ in range(count):
        ret, frame = cap.read()
        if not ret: break
        small = cv2.resize(frame, (W, H))
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        mask = bg.apply(gray)  # 255 where foreground (motion), 0 where background
        # Fraction of pixels that are foreground
        motion = float((mask > 0).sum()) / mask.size * 100
        results.append((t, motion))
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
W, H = 240, 135  # tiny — fast, motion still detectable
cap.release()

# Sample at 1/3 fps to massively speed up (1 of every 3 frames at 60fps = 20fps sampling)
sample_skip = 3
batch_size = max(100, int(fps / sample_skip * 4))
batches = [(video_path, i, batch_size, W, H, 30) for i in range(0, total_frames - 1, batch_size * sample_skip)]

t0 = time.time()
with ProcessPoolExecutor(max_workers=4) as ex:
    batch_results = list(ex.map(process_batch, batches))
t_detect = time.time() - t0

all_scores = []
for res in batch_results:
    all_scores.extend(res)
all_scores.sort(key=lambda x: x[0])

if not all_scores:
    print(json.dumps({"segments": [], "count": 0}))
    sys.exit(0)

scores = [s for _, s in all_scores]
# Threshold: any frame where >2% of pixels are foreground = motion
# MOG2 masks are 0-255, so we use a static threshold on the % of foreground pixels
threshold = 2.0  # percent of pixels

# Reconstruct: when did motion happen?
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
if start is not None and duration > start:
    segments.append((start, duration))

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
print(f"[bg] {len(all_scores)} samples | {len(segments)} segs | {total:.1f}s | detect={t_detect:.1f}s total={t_total:.1f}s", file=sys.stderr)
print(json.dumps({"segments": segments, "count": len(segments)}))
