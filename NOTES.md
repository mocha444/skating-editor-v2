# Feature Note — Auto-Cleanup After Download

## Goal
When user clicks a video result and hits "Download", clean up server-side files afterward.

## What to clean
- `public/uploads/skate-*/input.mp4`
- `public/uploads/skate-*/input_720p.mp4`
- `public/uploads/skate-*/segments/*.mp4`
- `public/uploads/skate-*/hash.md5`
- `public/uploads/skate-*/list.txt`
- `public/uploads/skate-*/results/*.mp4` (if any)
- `public/uploads/progress/*.json` + `*.log` for that job

## Trigger
- After `Download` button click in result panel
- Or optionally after 24h automatic retention period (see cleanup script)

## Implementation
1. `/api/download/[dir]` endpoint returns the file + schedules cleanup
2. After download completes (or immediately), call `rm -rf` on the upload dir
3. Delete progress meta/log for the same `jobId`
4. Optionally delete from PostgreSQL `videos` and `jobs` tables

## Related
- `scripts/cleanup-progress.js` handles progress file cleanup (cron: weekly)
- Docker uses `/mnt/external/skating_videos/` — cleanup frees 7TB storage
