import { z } from 'zod';

const enuPointSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

const enuBoundsSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

const tileSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  preview_url: z.string().min(1).optional(),
  role: z.enum(['primary', 'context']),
  origin_enu_m: enuPointSchema,
  bounds_enu_m: enuBoundsSchema,
  splat_count: z.number().int().positive(),
  byte_length: z.number().int().positive(),
  preview_splat_count: z.number().int().positive().optional(),
  preview_byte_length: z.number().int().positive().optional(),
  load_order: z.number().int().nonnegative(),
}).superRefine((tile, context) => {
  const previewFields = [
    tile.preview_url,
    tile.preview_splat_count,
    tile.preview_byte_length,
  ];
  const configuredFieldCount = previewFields.filter((value) => value !== undefined).length;
  if (configuredFieldCount > 0 && configuredFieldCount < previewFields.length) {
    context.addIssue({
      code: 'custom',
      message: 'Preview URL, splat count, and byte length must be configured together',
    });
  }
});

const tiledManifestSchema = z.object({
  format: z.literal('matrixcity-spark-tile-manifest-v1'),
  version: z.number().int().positive(),
  coordinate_frame: z.string().min(1),
  study_origin_enu_m: enuPointSchema,
  total_splat_count: z.number().int().positive(),
  total_asset_bytes: z.number().int().positive(),
  context_concurrency: z.number().int().min(1).max(4).default(2),
  tiles: z.array(tileSchema).min(1),
});

const pagedPageSchema = z.object({
  format: z.literal('matrixcity-3dgs-spz-page-v1'),
  completed: z.literal(true),
  tile_id: z.string().min(1),
  cell_id: z.string().min(1),
  bounds_enu_m: enuBoundsSchema,
  position_origin_enu_m: enuPointSchema,
  gaussian_count: z.number().int().positive(),
  sh_degree: z.literal(3),
  antialiased: z.boolean(),
  coordinate_policy: z.literal('native_RUB_array_order_interpreted_as_local_ENU'),
  spz_version: z.literal(3),
  spz_path: z.string().min(1),
  spz_size_bytes: z.number().int().positive(),
});

const pagedManifestSchema = z.object({
  format: z.literal('matrixcity-3dgs-paged-spz-v1'),
  completed: z.literal(true),
  encoding: z.object({
    library: z.literal('Niantic SPZ'),
    spz_version: z.literal(3),
    sh_degree: z.literal(3),
    quaternion_layout: z.literal('XYZW'),
  }),
  coordinate_frame: z.object({
    name: z.literal('matrixcity_big_city_local_enu_m'),
    units: z.literal('metres'),
    spz_api_coordinate_system: z.literal('RUB (raw numeric array basis only)'),
    coordinate_policy: z.literal('native_RUB_array_order_interpreted_as_local_ENU'),
    page_position_reconstruction: z.string().min(1),
    bounds_enu_m: enuBoundsSchema,
  }),
  paging: z.object({
    recommended_query_margin_m: z.number().finite().nonnegative(),
    page_count: z.number().int().positive(),
    gaussian_count: z.number().int().positive(),
  }),
  totals: z.object({
    spz_size_bytes: z.number().int().positive(),
  }),
  tiles: z.array(z.object({
    tile_id: z.string().min(1),
    pages: z.array(pagedPageSchema).min(1),
  })).min(1),
});

export type EnuPoint = z.infer<typeof enuPointSchema>;
export type EnuBounds = z.infer<typeof enuBoundsSchema>;

export type GaussianTileSource = z.infer<typeof tileSchema> & {
  resolvedUrl: string;
  resolvedPreviewUrl?: string;
};

export type GaussianPageSource = z.infer<typeof pagedPageSchema> & {
  id: string;
  resolvedUrl: string;
};

export type GaussianTiledAssetSource = {
  kind: 'tiled';
  manifestUrl?: string;
  contextConcurrency: number;
  tiles: GaussianTileSource[];
};

export type GaussianPagedAssetSource = {
  kind: 'paged';
  manifestUrl: string;
  queryMarginM: number;
  totalAssetBytes: number;
  totalGaussianCount: number;
  pages: GaussianPageSource[];
};

export type GaussianAssetSource = GaussianTiledAssetSource | GaussianPagedAssetSource;

/** Resolve a legacy SPZ, the established tiled manifest, or the paged SPZ v3 manifest. */
export async function resolveGaussianAssetSource(
  configuredUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<GaussianAssetSource> {
  const absoluteUrl = resolveUrl(configuredUrl, window.location.href);
  if (!new URL(absoluteUrl).pathname.toLowerCase().endsWith('.json')) {
    return {
      kind: 'tiled',
      contextConcurrency: 1,
      tiles: [{
        id: 'legacy-primary',
        url: absoluteUrl,
        resolvedUrl: absoluteUrl,
        role: 'primary',
        origin_enu_m: [0, 0, 0],
        bounds_enu_m: [0, 0, 0, 0],
        splat_count: 1,
        byte_length: 1,
        load_order: 0,
      }],
    };
  }

  const response = await fetcher(absoluteUrl, { mode: 'cors' });
  if (!response.ok) {
    throw new Error(`Gaussian asset manifest returned HTTP ${response.status}`);
  }
  const payload: unknown = await response.json();
  const format = z.object({ format: z.string() }).parse(payload).format;
  if (format === 'matrixcity-3dgs-paged-spz-v1') {
    return resolvePagedManifest(payload, absoluteUrl);
  }
  return resolveTiledManifest(payload, absoluteUrl);
}

function resolveTiledManifest(payload: unknown, absoluteUrl: string): GaussianTiledAssetSource {
  const manifest = tiledManifestSchema.parse(payload);
  const primaryCount = manifest.tiles.filter((tile) => tile.role === 'primary').length;
  if (primaryCount !== 1) {
    throw new Error('Gaussian tile manifest must contain exactly one primary tile');
  }
  const ids = new Set(manifest.tiles.map((tile) => tile.id));
  if (ids.size !== manifest.tiles.length) {
    throw new Error('Gaussian tile manifest contains duplicate tile ids');
  }

  return {
    kind: 'tiled',
    manifestUrl: absoluteUrl,
    contextConcurrency: manifest.context_concurrency,
    tiles: manifest.tiles
      .map((tile) => ({
        ...tile,
        resolvedUrl: resolveAssetPath(tile.url, absoluteUrl),
        resolvedPreviewUrl: tile.preview_url
          ? resolveAssetPath(tile.preview_url, absoluteUrl)
          : undefined,
      }))
      .sort((left, right) => left.load_order - right.load_order),
  };
}

function resolvePagedManifest(payload: unknown, absoluteUrl: string): GaussianPagedAssetSource {
  const manifest = pagedManifestSchema.parse(payload);
  if (manifest.tiles.some((tile) => (
    tile.pages.some((page) => page.tile_id !== tile.tile_id)
  ))) {
    throw new Error('Gaussian page tile ids do not match their manifest groups');
  }
  const pages = manifest.tiles.flatMap((tile) => tile.pages.map((page) => ({
    ...page,
    id: `${tile.tile_id}/${page.cell_id}`,
    // OSS treats a raw '+' in a path as a space. Encoding each path segment
    // keeps signed MatrixCity cell IDs addressable (for example n+00031).
    resolvedUrl: resolveAssetPath(page.spz_path, absoluteUrl),
  })));
  const ids = new Set(pages.map((page) => page.id));
  const paths = new Set(pages.map((page) => page.resolvedUrl));
  if (ids.size !== pages.length || paths.size !== pages.length) {
    throw new Error('Gaussian page manifest contains duplicate page ids or paths');
  }
  const gaussianCount = pages.reduce((sum, page) => sum + page.gaussian_count, 0);
  const assetBytes = pages.reduce((sum, page) => sum + page.spz_size_bytes, 0);
  if (
    pages.length !== manifest.paging.page_count
    || gaussianCount !== manifest.paging.gaussian_count
    || assetBytes !== manifest.totals.spz_size_bytes
  ) {
    throw new Error('Gaussian page manifest totals do not match its pages');
  }

  return {
    kind: 'paged',
    manifestUrl: absoluteUrl,
    queryMarginM: manifest.paging.recommended_query_margin_m,
    totalAssetBytes: assetBytes,
    totalGaussianCount: gaussianCount,
    pages,
  };
}

/**
 * Select only pages intersecting the camera-to-target corridor.
 *
 * The selector works in MatrixCity ENU metres and is deliberately independent
 * of Three.js/WebGL, so paging behavior can be validated without loading SPZ.
 */
export function selectGaussianPagesForView(
  pages: GaussianPageSource[],
  cameraEnu: EnuPoint,
  targetEnu: EnuPoint,
  marginM: number,
  limit: number,
): GaussianPageSource[] {
  const desired = pages.filter((page) => segmentIntersectsExpandedBounds(
    cameraEnu,
    targetEnu,
    page.bounds_enu_m,
    marginM,
  ));
  const candidates = desired.length > 0 ? desired : pages;
  return candidates
    .map((page) => ({
      page,
      distance: distanceFromBoundsCenterToSegment(
        page.bounds_enu_m,
        cameraEnu,
        targetEnu,
      ),
    }))
    .sort((left, right) => left.distance - right.distance || left.page.id.localeCompare(right.page.id))
    .slice(0, Math.max(1, limit))
    .map(({ page }) => page);
}

function segmentIntersectsExpandedBounds(
  start: EnuPoint,
  end: EnuPoint,
  bounds: EnuBounds,
  margin: number,
) {
  const minX = bounds[0] - margin;
  const minY = bounds[1] - margin;
  const maxX = bounds[2] + margin;
  const maxY = bounds[3] + margin;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  let minimumT = 0;
  let maximumT = 1;
  const constraints: Array<[number, number]> = [
    [-dx, start[0] - minX],
    [dx, maxX - start[0]],
    [-dy, start[1] - minY],
    [dy, maxY - start[1]],
  ];
  for (const [direction, distance] of constraints) {
    if (Math.abs(direction) < 1e-9) {
      if (distance < 0) return false;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) minimumT = Math.max(minimumT, ratio);
    else maximumT = Math.min(maximumT, ratio);
    if (minimumT > maximumT) return false;
  }
  return true;
}

function distanceFromBoundsCenterToSegment(
  bounds: EnuBounds,
  start: EnuPoint,
  end: EnuPoint,
) {
  const centreX = (bounds[0] + bounds[2]) / 2;
  const centreY = (bounds[1] + bounds[3]) / 2;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-9) return Math.hypot(centreX - start[0], centreY - start[1]);
  const t = Math.max(0, Math.min(1, (
    (centreX - start[0]) * dx + (centreY - start[1]) * dy
  ) / lengthSquared));
  return Math.hypot(centreX - (start[0] + t * dx), centreY - (start[1] + t * dy));
}

function resolveAssetPath(value: string, base: string) {
  const resolved = new URL(value, base);
  resolved.pathname = resolved.pathname
    .split('/')
    .map((segment) => encodeURIComponent(safeDecodeURIComponent(segment)))
    .join('/');
  return resolved.toString();
}

function resolveUrl(value: string, base: string) {
  return new URL(value, base).toString();
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
