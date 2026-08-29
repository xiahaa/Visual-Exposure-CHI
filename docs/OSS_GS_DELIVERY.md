# MatrixCity GS Delivery Through OSS/CDN

Production participants download Gaussian assets directly from object storage;
Vercel serves the React application and Hugging Face serves only FastAPI/Open3D.

## Upload the standard progressive manifest

Upload these two new files beside the existing v2 assets:

```text
Local preview:
  D:\CHI\frontend\public\gs-local\block3_tile19-preview.spz

Local manifest:
  D:\CHI\assets\matrixcity-neighborhood-study-v3.json

OSS destination:
  oss://chi-privacy-study/vep/matrixcity/v2/block3_tile19-preview.spz
  oss://chi-privacy-study/vep/matrixcity/v2/matrixcity-neighborhood-study-v3.json
```

The v3 manifest deliberately remains under the existing v2 prefix, so its
relative URLs reuse all nine full/context SPZ files already online. Only the
preview and new manifest need uploading.

With `ossutil` configured, the essential commands are:

```powershell
ossutil cp `
  D:\CHI\frontend\public\gs-local\block3_tile19-preview.spz `
  oss://chi-privacy-study/vep/matrixcity/v2/block3_tile19-preview.spz

ossutil cp `
  D:\CHI\assets\matrixcity-neighborhood-study-v3.json `
  oss://chi-privacy-study/vep/matrixcity/v2/matrixcity-neighborhood-study-v3.json
```

## HTTP metadata

Apply these headers to every versioned `.spz` object:

```text
Content-Type: application/octet-stream
Cache-Control: public, max-age=31536000, immutable
```

The versioned manifest may use `public, max-age=300`; do not use `no-store`.
Keep byte-range requests enabled. `Content-Disposition` should be `inline` or
unset rather than `attachment`.

## CORS and HTTPS

Allow at least:

```text
https://www.aam-privacy-study.cn
https://aam-privacy-study.cn
```

Methods must include `GET` and `HEAD`; expose `ETag`, `Content-Length`,
`Accept-Ranges`, and `Content-Range`. Add preview Vercel origins only when a
facilitator needs to test preview deployments.

A custom asset hostname needs a certificate whose SAN covers that exact host.
A CNAME directly to the OSS bucket does not provide CDN acceleration. Configure
the hostname as an Alibaba Cloud CDN/ESA accelerated domain with the OSS bucket
as origin, enable HTTPS, range forwarding, and cache versioned SPZ files for one
year.

## Activate in Vercel

After every manifest-relative URL returns 200 with valid CORS, set Production
and Preview variables:

```text
VITE_MATRIXCITY_GS_MANIFEST_URL=https://<validated-cdn-host>/vep/matrixcity/v2/matrixcity-neighborhood-study-v3.json
VITE_MATRIXCITY_GS_URL=https://<validated-cdn-host>/vep/matrixcity/v2/matrixcity-tile19-study-v1.spz
```

Redeploy because Vite embeds these values during the build. Verify the browser
Network panel shows the preview first, then the full primary, and context assets
only after `Explore scene` is selected. The HF catalog is the runtime source of
truth, so update the matching `manifest_url` in `backend/config/backend.yaml`
and redeploy the Space whenever the standard manifest is changed. Vercel values
provide fast startup and backend-unavailable compatibility.

## Optional high-quality paged SPZ v3

The newer asset is a separate profile and does not replace the standard files:

```text
OSS prefix:
  oss://chi-privacy-study/vep/matrixcity/v3/

Manifest:
  renderer_manifest.json

Vercel variable:
  VITE_MATRIXCITY_GS_PAGED_MANIFEST_URL=https://chi-privacy-study.oss-cn-beijing.aliyuncs.com/vep/matrixcity/v3/renderer_manifest.json
```

Upload the directory recursively, preserving every tile/page path from the
manifest. Page filenames contain signed cell IDs such as `n+00031.spz`; do not
rename them. The viewer encodes `+` as `%2B` for OSS requests.

Apply immutable caching to every `.spz` page:

```text
Content-Type: application/octet-stream
Cache-Control: public, max-age=31536000, immutable
```

Use a short revalidation policy for `renderer_manifest.json`, for example:

```text
Cache-Control: public, max-age=60, must-revalidate
```

Activate `paged_v3` from `/setup` or append `?gs=paged_v3` to a facilitator
preview. Keep `standard_v2` as the backend YAML default until target-network
loading has been piloted. Do not verify by loading every page: inspect the
Network panel and confirm no more than the configured page budget is resident.
