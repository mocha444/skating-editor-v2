# Self-Hosted + VPS Deployment (Home GPU + Cheap Front Door)

**Goal:** a set-and-forget deployment that serves ~10 users for **~$13/mo**, hides your
home IP, gives full-speed video serving (no Cloudflare throttle, no home-upload cap),
and scales simply later. Heavy GPU processing runs free on your home PC; a small
DigitalOcean droplet is the public front door + queue; Cloudflare R2 serves the
finished videos for **$0 egress**.

```
visitor ──▶ yourdomain.com ──▶ DO droplet (Caddy + Next.js app + Postgres queue)
                                      │  (WireGuard tunnel)
                                      ▼
                              home beast PC (worker: ffmpeg GPU decode + MOG2)
                                      │  (uploads input, serves nothing)
                                      ▼
                              Cloudflare R2 (serves finals — free, full speed)
```

**Monthly cost (start):**
| Item | Purpose | ~$/mo |
|------|---------|-------|
| DO droplet 2 vCPU / 2 GB | app + Postgres queue + Caddy | $12 |
| Home beast PC | GPU/CPU processing | $0 (+ small power) |
| Cloudflare R2 (free tier) | serve finals, $0 egress | $0 |
| Domain (optional DuckDNS = $0) | yourname.com | ~$1 |
| **Total** | | **~$13/mo** |

---

## 0. What already works in this repo vs. what must be wired
| Capability | Status |
|-----------|--------|
| Resumable chunked upload | ✅ built |
| Fast duplicate pre-screen + server MD5 dedupe | ✅ built |
| GPU decode + CPU fallback | ✅ (Intel VAAPI); AMD swap below |
| Trailing dead-air trim | ✅ built |
| Progress via SSE | ✅ built |
| Queue | ⚠️ local SQLite → must point at shared queue (Part 5) |
| Media storage | ⚠️ local disk → must move read/write to R2 (Part 5) |

---

## Part 1 — Create the DigitalOcean droplet (front door)
1. Create a droplet: **Ubuntu 24.04**, **Basic, 2 vCPU / 2 GB ($12/mo)**.
   - *Cheaper:* Basic **1 vCPU / 1 GB ($6/mo)** works but is memory-tight.
2. Reserve a **static/floating IP** (keeps the address stable) — optional but nice.
3. SSH in, install Docker + Compose:
```bash
curl -fsSL https://get.docker.com | sh
sudo apt-get update && sudo apt-get install -y docker-compose-plugin
```

---

## Part 2 — WireGuard: home → droplet (hide your home IP)
Install WireGuard on **both** machines.

**Droplet (server).** Create keys and a config:
```bash
sudo apt-get install -y wireguard
wg genkey | tee /etc/wireguard/private.key | wg pubkey > /etc/wireguard/public.key
# /etc/wireguard/wg0.conf
[Interface]
Address = 10.0.0.1/24
ListenPort = 51820
PrivateKey = <droplet private key>

[Peer]                 # home PC
PublicKey = <home public key>
AllowedIPs = 10.0.0.2/32
```
```bash
sudo systemctl enable wg-quick@wg0 && sudo systemctl start wg-quick@wg0
```
Open UDP 51820 in the droplet firewall.

**Home beast PC (client).**
```bash
sudo apt-get install -y wireguard
# /etc/wireguard/wg0.conf
[Interface]
Address = 10.0.0.2/24
PrivateKey = <home private key>

[Peer]                 # droplet
PublicKey = <droplet public key>
Endpoint = <droplet-public-ip>:51820
AllowedIPs = 10.0.0.1/32
PersistentKeepalive = 25
```
```bash
sudo systemctl enable wg-quick@wg0 && sudo systemctl start wg-quick@wg0
```
**Verify:** from home, `ping 10.0.0.1` succeeds. The droplet can now reach the home
worker at `10.0.0.2`. Your real home IP is never exposed to visitors.

---

## Part 3 — Cloudflare R2 (free, full-speed video serving)
1. Cloudflare dashboard → **R2** → create a bucket, e.g. `skate-finals`.
2. Get an **Access Key ID + Secret** (R2 → Manage R2 API Tokens). Note the **Account ID**.
3. Give the worker + app env:
```
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=skate-finals
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

---

## Part 4 — The beast PC worker (AMD GPU)

### 4a. Swap VAAPI from Intel → AMD
Your repo's GPU path uses Intel VAAPI (`/dev/dri/card0`). For the AMD **6700 XT (Radeon)**:

Dockerfile: add AMD VAAPI driver (works alongside Intel):
```dockerfile
intel-media-va-driver libva2 vainfo mesa-va-drivers
```

`process_video.py`: auto-detect the VAAPI device (prefer `renderD128`, fall back to
`card0`, overridable):
```python
import os
VAAPI_DEVICE = os.environ.get("VAAPI_DEVICE") or (
    "/dev/dri/renderD128" if os.path.exists("/dev/dri/renderD128") else "/dev/dri/card0"
)
GPU_AVAILABLE = os.path.exists(VAAPI_DEVICE)
```

`docker-compose.yml` (worker service): mount the render node + GPU groups:
```yaml
devices:
  - /dev/dri/card0:/dev/dri/card0
  - /dev/dri/renderD128:/dev/dri/renderD128
group_add:
  - video
  - render
```

Host setup (Ubuntu on the beast PC):
```bash
sudo apt-get install -y libva-utils mesa-va-drivers
sudo usermod -aG video,render $USER   # then log out & back in
vainfo   # should list VAProfileH264/HEVC … VLD from the radeonsi driver
```

> If this app's pipeline only *decodes + downscales* on the GPU and stream-copies
> (`-c copy`) for cuts, AMD VAAPI decode is enough — you don't need AMF encode.

### 4b. Run the worker on the beast PC
It must reach the **shared queue** (Part 5) and **R2** for media. Example `.env` on the PC:
```
DATA_DIR=/app/data
POSTGRES_URL=postgres://skate:pass@10.0.0.1:5432/skate
R2_ENDPOINT=...
R2_BUCKET=skate-finals
VAAPI_DEVICE=/dev/dri/renderD128
```
Run via the existing Docker worker image (`scripts/worker.js` entrypoint).

---

## Part 5 — Wiring: shared queue + R2 media (the code changes)
For multiple machines to cooperate, replace **local-only** pieces with network ones.

### 5a. Queue: SQLite → droplet Postgres (`graphile-worker`)
Your `scripts/jobs-db.cjs` is single-host. For distributed workers, use
**graphile-worker** against the droplet's Postgres (transactional, `LISTEN/NOTIFY`).

- Stand up Postgres on the droplet:
```bash
docker run -d --name pg \
  -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=skate POSTGRES_USER=skate \
  -p 5432:5432 postgres:16-alpine
```
- `scripts/worker.js` becomes a graphile-worker task handler that, per job, must:
  1. **`GET` the input.mp4 object from R2** (or from the droplet's object store),
  2. run the existing GPU detection/cut/concat,
  3. **`PUT` the final + segments to R2**,
  4. mark the job done (writes a small result row → SSE still works).
- The app (on the droplet) enqueues via graphile-worker instead of writing a local file.

### 5b. Media: local disk → R2
- Upload route streams input to **R2** (S3 `PUT` multipart) — drop-in for the local file
  write; dedupe still works off the server MD5.
- `serve-file`/`results` routes become either the R2 object (stream via the S3 client)
  or, better, a **presigned R2 URL** handed to the viewer so R2 serves it directly
  (keeps droplet outbound near zero).

> This is the one real refactor. The good news: upload dedup, resumability, progress,
> and the trailing-trim all stay identical — only the "where" of byte storage/queue
> changes.

---

## Part 6 — Caddy (TLS reverse proxy) + auth
Install Caddy on the droplet:
```bash
sudo apt-get install -y caddy
```
`/etc/caddy/Caddyfile`:
```
yourname.com {
    reverse_proxy localhost:3000
    # optional login gate for a public URL:
    basic_auth {
        you $2a$14$....   # `caddy hash-password` to generate
    }
}
```
`sudo systemctl enable --now caddy` → automatic Let's Encrypt cert.

DNS: point `yourname.com` (an **A** record) at the droplet's IP. If you use DuckDNS (free),
use `yourname.duckdns.org` and update it on a cron when your IP changes — though the
droplet has a fixed IP, so a normal A record is enough (no dynamic-IP problem).

---

## Part 7 — Run & verify
1. Upload a test video from the web UI.
2. Watch logs:
   - Droplet app: job enqueued.
   - Beast PC worker: `[gpu] vaapi decode + scale_vaapi OK` (Radeon) then `[done]`.
   - Final video present in **R2** (`rclone lsl :s3:skate-finals` or bucket UI).
3. Open the result URL in a browser — the video streams from **R2**, not your home.

---

## Scaling ladder (spend only when you grow)
| Situation | Action | Cost |
|-----------|--------|------|
| App/queue feels slow (~30 users) | Droplet 2GB → 4 vCPU/8GB | +~$35/mo |
| More concurrent processing | 2nd GPU/compute worker behind the same queue | +$0 (home) or GPU box |
| More storage | R2 beyond free tier | ~$0.015/GB/mo |
| Want zero home dependency | Move processing to a droplet/Dedicated box | +$30–48/mo |

---

## Troubleshooting / FAQ
- **`[gpu] vaapi decode failed (rc=234)` on the beast PC** → verify `vainfo` shows
  `radeonsi` and your user is in `video`/`render` (re-login after `usermod`).
- **Worker never sees jobs** → the queue must be network-reachable; confirm `POSTGRES_URL`
  points at `10.0.0.1` and WireGuard is up (`ping 10.0.0.1`).
- **Streaming slow** → make sure the viewer URL points at **R2**, not the droplet/home.
- **Home PC offline** → new jobs queue; already-finished videos still play from R2.