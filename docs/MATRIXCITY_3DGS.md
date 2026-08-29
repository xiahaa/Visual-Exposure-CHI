# MatrixCity 3DGS Study Scene

When configured, a small MatrixCity Gaussian Splatting subset is the shared
visual environment for the initial event and the M/S/V disclosure conditions.
S remains a fixed standard presentation; only V adds orbit/pan/zoom, frustum,
physical-clarity coloring, and timeline scrubbing. This preserves scene and pose
equivalence while isolating the disclosure interaction.

The source runtime packs under `F:\MatrixCity` are PyTorch `.pt` pages and
cannot be loaded directly by a browser. The study uses all 16 pages of
`block3_tile19`, covering 400 by 400 metres. This tile was selected after an
asset audit for complete page coverage, even Gaussian density, stable ground
height, and absence of extreme geometry ceilings. Export it from WSL:

```bash
cd /mnt/d/CHI
conda activate py310
python scripts/export_matrixcity_spark_ply.py \
  --asset-root /mnt/f/MatrixCity/render_assets_sh3_full \
  --tile-id block3_tile19 \
  --page-count 16 \
  --focus-page e+00001_n+00036 \
  --focus-page e+00001_n+00037 \
  --focus-page e+00002_n+00036 \
  --focus-page e+00002_n+00037 \
  --focus-weight 2 \
  --max-splats 1000000 \
  --min-opacity 0.005 \
  --max-scale-m 4 \
  --output frontend/public/gs-local/matrixcity-tile19-study.ply
```

Compress the browser asset from the frontend directory:

```bash
cd frontend
npm run gs:compress -- \
  public/gs-local/matrixcity-tile19-study.ply \
  public/gs-local/matrixcity-tile19-study.spz
```

Then create `frontend/.env.local`:

```text
VITE_MATRIXCITY_GS_URL=/gs-local/matrixcity-tile19-study.spz
VITE_MATRIXCITY_GS_SCALE=1
VITE_MATRIXCITY_GS_OFFSET_X=0
VITE_MATRIXCITY_GS_OFFSET_Y=0
VITE_MATRIXCITY_GS_OFFSET_Z=0
```

The generated directory and `.env.local` are ignored by Git. For deployment,
convert the subset once, place the PLY (or a compressed Spark-compatible format)
in object storage/CDN with CORS enabled, and set `VITE_MATRIXCITY_GS_URL` to the
public URL at build time. Do not publish the complete 148-tile asset.

The current pilot deployment serves the versioned 3 by 3 neighborhood from
Alibaba Cloud OSS/CDN. Hugging Face runs FastAPI and Open3D only; its legacy
`/gs-assets/` route is retained for diagnostics, not normal participant traffic.
The participant's browser downloads and renders every GS asset on its own GPU.

## Progressive neighborhood

`assets/matrixcity-neighborhood-study-v3.json` expands the visible domain from
the 400 by 400 metre primary tile to its eight immediate neighbours. It does
not merge everything into one large SPZ:

| Tier | Tiles | Splats per tile | Compressed total |
| --- | --- | ---: | ---: |
| Initial preview | block3_tile19 | 400,000 | 10.8 MB |
| Primary | block3_tile19 | 1,000,000 | 25.9 MB |
| Cardinal | 13, 18, 20, 25 | 250,000 | 26.2 MB |
| Corner | 12, 14, 24, 26 | 100,000 | 10.4 MB |
| **Final scene** | **9 tiles** | **2,400,000** | **62.5 MB** |

The preview becomes visible first. The full primary tile then loads in the
background and atomically replaces the preview. When a V-condition participant
selects `Explore scene`, the four cardinal tiles followed by the four corners
load with the manifest's bounded concurrency. While full-primary refinement is
active, only one context worker runs; the second starts after refinement. Fixed
S-condition views and the synchronized UAV camera remain on the primary tile.
Every tile retains its own export origin; the frontend converts each origin
through the shared MatrixCity ENU transform before adding the `SplatMesh`.

For local development, copy the manifest beside the generated SPZ files and
configure:

```text
VITE_MATRIXCITY_GS_MANIFEST_URL=/gs-local/matrixcity-neighborhood-study-v3.json
```

`VITE_MATRIXCITY_GS_URL` remains supported as a single-tile fallback. Production
must keep both variables on the same OSS/CDN origin.

MatrixCity is the complete visual environment for the event study. The UAV,
resident, camera frustum, routes, and physical-clarity overlays use the same
local ENU metre frame defined in `frontend/src/matrixCityStudyScene.json`.
Procedural buildings are used only when no Gaussian asset URL is configured.

The browser viewer renders this bounded subset without Spark's generated LoD.
Generating `Tiny LoD` for an already-small PLY merges nearby Gaussians and can
soften facade evidence. The export also keeps low-opacity detail while removing
axes larger than four metres, which reduces floating streaks without selecting
only large, high-opacity primitives. A modest two-times focus weight preserves
the central study area while every surrounding page retains context. SPZ
compression reduces the 248 MB intermediate PLY to 25.9 MB for browser delivery.

The study configuration records the exported page IDs, 400 by 400 metre asset
bounds, an inset safe-flight domain, asset origin, target facade, resident
position, camera model, and both trajectories. Each approximately 368 metre
route remains inside the safe domain for its complete duration. ENU coordinates
are transformed once by `frontend/src/matrixCityScene.ts`; there are no separate
per-view calibration offsets. This guarantees that the external, resident, and
UAV-camera panels observe the same simulated pose.

## Optional paged SPZ v3 profile

The high-quality profile is independent of the established progressive scene:

```text
OSS manifest:
  /vep/matrixcity/v3/renderer_manifest.json

Setup/query profile:
  gs=paged_v3

Automatic fallback:
  standard_v2
```

The manifest describes 108 official Niantic SPZ v3 pages with SH degree 3.
Their full compressed size is about 1.06 GB, so the viewer selects only pages
whose ENU bounds intersect the active camera-to-target corridor. Loading is
bounded by the profile values returned from `/api/gaussian-assets`; the current
pilot limit is two concurrent requests and six resident pages per scene viewer.

The manifest coordinate contract is strict: page data is decoded in the native
RUB numeric array order and interpreted as local ENU, then
`position_origin_enu_m` is added. The Three.js model transform maps those ENU
axes into renderer axes. It must not perform another RUB-to-RFU conversion or
re-quantize spherical harmonics. Signed page names contain `+`; the frontend
percent-encodes each URL path segment so OSS receives `%2B` rather than a space.

`standard_v2` remains the default until target devices and participant networks
have accepted paged loading time. Facilitators select either profile in
`/setup`; the choice is fixed in the generated URL and recorded with study
events. A v3 manifest/bootstrap/decode failure activates the standard profile
without changing the route, camera, or experimental cell.

## View-domain limitation

The supplied MatrixCity runtime packs were prepared for aerial, predominantly
nadir-facing cameras. They can provide strong city context from nearby aerial
poses, but horizontal facade and balcony views are outside that training-view
distribution. Blurred facades or elongated splats from those views are therefore
not a canvas-resolution problem and cannot be recovered by adding browser-side
sharpening. A study that requires inspectable resident-level imagery should use
an oblique/street-level Gaussian capture around the target, or restrict the live
MatrixCity camera to a validated aerial pose envelope and use a separate local
facade asset for the resident view.

Facilitator preview trajectories and camera settings can be configured through
`/setup`. See `docs/MATRIXCITY_FLIGHT_CONFIGURATION.md` for coordinate semantics,
hard limits, recommended ranges, JSON import/export, and pilot checks.
