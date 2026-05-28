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

## 3. Connect Vercel Frontend To The Space

In the Vercel project settings, set:

```text
VITE_API_BASE_URL=https://<user-or-org>-<space-name>.hf.space
```

Then redeploy the Vercel frontend.

Do not set `VITE_API_BASE_URL` to `127.0.0.1` in production. The browser would
then try to call the viewer's own computer instead of the deployed backend.

## 4. CORS

The backend allows Vercel preview and production domains by default:

```text
https://*.vercel.app
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
