# Feature Note — Single-Active-Job Storage + Cleanup

## Model
Files live only inside the Docker named volume `media_data` → `/app/data` (shared by app + 2 workers):

```
/app/data/uploads/skate-<id>/input.mp4, hash.md5, list.txt, segments/seg-*.mp4
/app/data/results/skating_final_<id>.mp4
/app/data/progress/<jobId>.json + <jobId>.log
```

PostgreSQL keeps only metadata rows (`videos` / `jobs`) — byte-level files are never persisted long-term.

## Cleanup triggers
1. **New upload** (`POST /api/upload`): after the duplicate check, all existing files under
   `/app/data/{uploads,results,progress}` are wiped before the new video is saved. Only the
   current job's files exist at any time.
2. **Download** (`GET /api/download/<jobId>`): streams the result mp4, then deletes the job's
   upload dir, result file, and progress meta/log.

## Serving
Next.js's production server caches `public/` at boot, so runtime files are served by route
handlers, never from `public/`:
- `GET /results/[file]` and `GET /uploads/[...path]` — streaming with Range support
- `/api/download/<jobId>` — attachment, streams then cleans up
- URLs in the frontend (`result.finalUrl`, segment `Play →`, recent list) are unchanged.

## Related
- `scripts/cleanup-progress.js` sweeps stale progress files (host cron: weekly)
- `scripts/cleanup_startup.sh` validates leftover upload dirs at host boot (legacy, host-side)
- External `/mnt/external/skating_videos/` mount **removed** — files no longer leave Docker