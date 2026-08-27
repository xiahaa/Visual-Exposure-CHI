# Hugging Face Spaces Backend Deployment

This project should deploy as two services:

```text
Frontend:
  Vercel static site, built from frontend/

Backend:
  Hugging Face Spaces Docker app, running FastAPI + Open3D
```

This avoids Vercel Hobby memory limits for the Open3D raycasting backend.

## 1. Create the Space

1. Open Hugging Face Spaces.
2. Create a new Space.
3. Select `Docker` as the Space SDK.
4. Connect or upload this repository.
5. Keep the repository root as the Docker build context.

The root `Dockerfile` starts the backend on port `7860`, which is the standard
port expected by Hugging Face Spaces.

## 2. Verify Backend Health

After the Space builds, open:

```text
https://<user-or-org>-<space-name>.hf.space/api/health
```

Expected response:

```json
{"status":"ok"}
```

Then verify a scenario:

```text
https://<user-or-org>-<space-name>.hf.space/api/scenarios/hong_kong_mong_kok_01
```

Verify the browser-ready MatrixCity asset without downloading it:

```text
HEAD https://<user-or-org>-<space-name>.hf.space/gs-assets/matrixcity-tile19-study-v1.spz
GET  https://<user-or-org>-<space-name>.hf.space/gs-assets/matrixcity-neighborhood-study-v2.json
```

The Space deployment repository stores the SPZ files under `assets/` using Git
LFS. `FileResponse` streams them without loading complete files into Python
memory and marks each versioned URL as immutable for browser caching. The JSON
manifest records tile origins, bounds, splat counts, byte sizes, and load order.

## 3. Connect Vercel Frontend To The Space

In the Vercel project settings, set:

```text
VITE_API_BASE_URL=https://<user-or-org>-<space-name>.hf.space
VITE_MATRIXCITY_GS_MANIFEST_URL=https://<user-or-org>-<space-name>.hf.space/gs-assets/matrixcity-neighborhood-study-v2.json
VITE_MATRIXCITY_GS_URL=https://<user-or-org>-<space-name>.hf.space/gs-assets/matrixcity-tile19-study-v1.spz
```

Then redeploy the Vercel frontend.

Do not set `VITE_API_BASE_URL` to `127.0.0.1` in production. The browser would
then try to call the viewer's own computer instead of the deployed backend.

## 4. CORS

The backend allows Vercel preview/production domains and the study custom
domain by default:

```text
https://*.vercel.app
https://aam-privacy-study.cn
https://www.aam-privacy-study.cn
```

To override the allowed origin regex in the Space settings, set:

```text
CORS_ALLOW_ORIGIN_REGEX=https://your-custom-domain\.com
```

For multiple domains, use a regular expression such as:

```text
CORS_ALLOW_ORIGIN_REGEX=https://(.*\.vercel\.app|visual-exposure\.example\.org)
```

## 5. Notes

- Free Hugging Face Spaces may sleep when idle, so the first request can be
  slow.
- Open3D is installed inside the Docker image instead of Vercel Functions.
- The Docker image installs system libraries required by Open3D, including
  `libgomp1` for OpenMP support.
- The backend keeps the same API paths, including `/api/exposure/compute` and
  `/api/planning/optimize`.
- The primary SPZ is 25.9 MB. Eight context tiles add 36.6 MB, for a maximum
  neighborhood transfer of 62.5 MB (59.6 MiB) and 2.4 million splats.
- Fixed S-condition views and UAV-camera views load only the primary tile. The
  additional context is requested sequentially only after `Explore scene` is
  selected in V, which bounds peak decode memory and simultaneous downloads.
- CPU Basic provides 2 vCPU, 16 GB RAM, and 50 GB ephemeral disk. This is ample
  for the 62.5 MB immutable asset set because GS decoding/rendering happens in
  the participant browser, not on the Space GPU. See the official
  [Spaces hardware table](https://huggingface.co/docs/hub/spaces-overview).
- The limiting factor for a simultaneous pilot is network egress and the
  Open3D API workload, not GS storage. One uncached participant may transfer up
  to 62.5 MB; 20 simultaneous V participants may request about 1.25 GB in the
  worst case. Do not run many 20-second Open3D jobs concurrently on 2 vCPU.
- HF hosting is suitable for development and a small laboratory pilot. For a
  larger or mainland-China study, move the manifest and SPZ files to OSS/COS
  plus a CDN and change only `VITE_MATRIXCITY_GS_MANIFEST_URL`; no frontend code
  change is required.
