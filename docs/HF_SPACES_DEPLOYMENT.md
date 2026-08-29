# Hugging Face Spaces Backend Deployment

This project should deploy as three services:

```text
Frontend:
  Vercel static site, built from frontend/

Backend:
  Hugging Face Spaces Docker app, running FastAPI + Open3D

GS assets:
  Alibaba Cloud OSS/CDN, fetched directly by participant browsers
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

Verify the browser asset catalog separately:

```text
https://<user-or-org>-<space-name>.hf.space/api/gaussian-assets
```

The response should keep `standard_v2` as `default_profile_id` and expose
`paged_v3` as an optional profile with `standard_v2` as its fallback.

The Space may retain the old GS routes for diagnostics:

```text
HEAD https://<user-or-org>-<space-name>.hf.space/gs-assets/matrixcity-tile19-study-v1.spz
GET  https://<user-or-org>-<space-name>.hf.space/gs-assets/matrixcity-neighborhood-study-v2.json
```

Do not use these routes for production participant delivery. HF egress from
mainland China is substantially slower than OSS/CDN and competes with Open3D API
traffic.

## 3. Connect Vercel Frontend To The Space

In the Vercel project settings, set:

```text
VITE_API_BASE_URL=https://<user-or-org>-<space-name>.hf.space
VITE_MATRIXCITY_GS_MANIFEST_URL=https://<oss-or-cdn-host>/vep/matrixcity/v2/matrixcity-neighborhood-study-v2.json
VITE_MATRIXCITY_GS_PAGED_MANIFEST_URL=https://<oss-or-cdn-host>/vep/matrixcity/v3/renderer_manifest.json
VITE_MATRIXCITY_GS_URL=https://<oss-or-cdn-host>/vep/matrixcity/v2/matrixcity-tile19-study-v1.spz
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
- The deployed standard profile starts with the 25.9 MB primary tile. Eight
  context tiles add 36.6 MB, for a final 2.4-million-splat scene.
- Fixed S-condition views and UAV-camera views load only the primary tile. The
  additional context uses manifest-controlled concurrency only after `Explore
  scene` is selected in V.
- CPU Basic provides 2 vCPU, 16 GB RAM, and 50 GB ephemeral disk. This is ample
  for the 62.5 MB immutable asset set because GS decoding/rendering happens in
  the participant browser, not on the Space GPU. See the official
  [Spaces hardware table](https://huggingface.co/docs/hub/spaces-overview).
- The limiting factor for a simultaneous pilot is network egress and the
  Open3D API workload, not GS storage. One uncached participant may transfer up
  to 62.5 MB; 20 simultaneous V participants may request about 1.25 GB in the
  worst case. Do not run many 20-second Open3D jobs concurrently on 2 vCPU.
- HF remains suitable for the API backend. Keep all production GS manifest,
  preview, full-quality, and context URLs on OSS/CDN.
- The optional paged profile is roughly 1.06 GB in total, but the browser never
  requests it all. It selects a maximum of six SPZ v3 pages per scene viewer
  around the active camera corridor. Decoding and rendering use the participant
  browser GPU; HF publishes only the small profile catalog.

See `OSS_GS_DELIVERY.md` for the production asset activation checklist.
