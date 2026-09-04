#!/usr/bin/env python3
"""
MOG2 background subtraction for motion detection.
Uses a static initial frame as the scene baseline so the skater
never gets learned as background.
"""
import cv2, sys, os, json, time

video_path = sys.argv[1]
cap = cv2.VideoCapture(video_path)
if not cap.isOpened():
    print(json.dumps({"error": f"cannot open {video_path}"}))
    sys.exit(1)

fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
duration = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) / fps
W, H = 320, 180

# Read the FIRST frame as the scene baseline
ret, first = cap.read()
if not ret:
    print(json.dumps({"segments": [], "count": 0}))
    sys.exit(0)

first_small = cv2.resize(first, (W, H))
first_gray = cv2.cvtColor(first_small, cv2.COLOR_BGR2GRAY)

# Segment the very first frame to detect initial presence of a person
# (if skater is already in frame, treat them as part of "scene" initially)
# Then track anything that changes.

print(f"[mog2] fps={fps:.1f} duration={duration:.1f}s W={W}x{H}", file=sys.stderr)

# Process every frame, computing foreground vs the initial scene
segments = []
start = None
last_motion = 0.0
debounce = 1.5
prev_diff_score = 0.0
threshold = 0.025  # 2.5% of pixels different from initial frame = motion

while True:
    ret, frame = cap.read()
    if not ret: break
    small = cv2.resize(frame, (W, H))
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
    # Diff against the first frame (the "scene")
    diff = cv2.absdiff(gray, first_gray)
    # Gaussian blur to reduce noise (helps ignore codec artifacts)
    diff_blur = cv2.GaussianBlur(diff, (5, 5), 0)
    _, thresh_mask = cv2.threshold(diff_blur, 25, 255, cv2.THRESH_BINARY)
    # Morphological operations to clean up noise
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    thresh_mask = cv2.morphologyEx(thresh_mask, cv2.MORPH_OPEN, kernel)
    thresh_mask = cv2.morphologyEx(thresh_mask, cv2.MORPH_CLOSE, kernel)
    # Fraction of foreground pixels
    motion_pct = float((thresh_mask > 0).sum()) / thresh_mask.size

    if motion_pct > threshold:
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
print(f"[mog2] {len(segments)} segs | {total:.1f}s total | threshold={threshold}", file=sys.stderr)
print(json.dumps({"segments": segments, "count": len(segments)}))
