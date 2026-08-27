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

The current pilot deployment stores a versioned 3 by 3 tile neighborhood in
the Hugging Face Space repository and serves it from `/gs-assets/` with
immutable caching. This keeps the Vercel bundle small and uses the
participant's browser GPU for rendering. The route is a deployment fallback,
not a server-side GS renderer; moving the same files to an object-storage CDN
requires only an environment-variable update.

## Progressive neighborhood

`assets/matrixcity-neighborhood-study-v2.json` expands the visible domain from
the 400 by 400 metre primary tile to its eight immediate neighbours. It does
not merge everything into one large SPZ:

| Tier | Tiles | Splats per tile | Compressed total |
| --- | --- | ---: | ---: |
| Primary | block3_tile19 | 1,000,000 | 25.9 MB |
| Cardinal | 13, 18, 20, 25 | 250,000 | 26.2 MB |
| Corner | 12, 14, 24, 26 | 100,000 | 10.4 MB |
| **Total** | **9 tiles** | **2,400,000** | **62.5 MB** |

The primary tile loads first for every MatrixCity view. The four cardinal tiles
then the four corners load sequentially only when a V-condition participant
selects `Explore scene`. Fixed S-condition views and the synchronized UAV camera
remain on the primary tile. Every tile retains its own export origin; the
frontend converts each origin through the shared MatrixCity ENU transform before
adding the `SplatMesh`, preventing per-view calibration offsets.

For local development, copy the manifest beside the generated SPZ files and
configure:

```text
VITE_MATRIXCITY_GS_MANIFEST_URL=/gs-local/matrixcity-neighborhood-study-v2.json
```

`VITE_MATRIXCITY_GS_URL` remains supported as a legacy single-tile fallback.

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
