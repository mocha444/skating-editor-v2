# Skating Video Editor

A high-performance pipeline for processing skating videos, featuring intelligent motion detection, GPU-accelerated video rendering, and efficient file deduplication.

## Pipeline Highlights

*   **Fast Pre-Deduplication**: Client-side signature screening (1 MiB head/tail) ensures duplicate files are rejected instantly without uploading.
*   **GPU Acceleration**: Automated Intel VAAPI (video hardware acceleration) pipeline for motion detection, decoding, and scaling, providing 25–35× speedup.
*   **SQLite job queue**: Atomic, crash-safe, retrying queue (Node 24's built-in `node:sqlite`) shared by the app and every worker — no more file-based races, and safe to scale multiple workers.
*   **Resumable uploads**: Multi-GB clips upload in 8 MiB chunks that resume after a disconnect.
*   **Scalable Architecture**: Decoupled Next.js app and Node.js workers, horizontally scalable via Docker.

> **Node requirement**: `scripts/worker.js` and the API routes use Node 24's built-in `node:sqlite` (via `process.getBuiltinModule`), so Node **≥ 22.3** is required. The Docker image is `node:24-slim` and satisfies this.

## Getting Started with Docker

For local development and production, we use Docker to manage GPU dependencies (VAAPI) and scaling.

### Prerequisites
- Docker & Docker Compose
- Intel Integrated GPU (`/dev/dri/card0`)

### Running the Pipeline
The pipeline is managed via Docker Compose.

```bash
# Build and start the services (app + 1 worker)
docker compose up -d --build
```

### Scaling Workers
You can scale the processing power horizontally by spinning up additional worker instances. Each instance will automatically pick up jobs from the shared queue:

```bash
# Scale to 3 processing workers
docker compose up -d --scale worker=3
```

> **Note**: Workers are horizontally scalable and use atomic directory locking (`.lock`) to ensure that exactly one worker processes each job.

## Development

### Environment
Configuration is defined directly in `docker-compose.yml` (no `.env` file needed). Each service sets `DATA_DIR=/app/data` internally.

### Adding New Features
The application structure:
- `src/app/api/`: Next.js route handlers (upload/chunked/resumable, duplicate check, progress).
- `scripts/worker.js`: Job processor (claims jobs from SQLite via `scripts/jobs-db.cjs`).
- `scripts/jobs-db.cjs`: Shared SQLite store (jobs queue + recent list), used by both the worker and the app.
- `scripts/process_video.py`: Motion detection logic using OpenCV (MOG2).

### Testing
To run the test suite:
```bash
npm test
```
