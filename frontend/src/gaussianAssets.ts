import { z } from 'zod';

const enuPointSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

const tileSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  role: z.enum(['primary', 'context']),
  origin_enu_m: enuPointSchema,
  bounds_enu_m: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]),
  splat_count: z.number().int().positive(),
  byte_length: z.number().int().positive(),
  load_order: z.number().int().nonnegative(),
});

const manifestSchema = z.object({
  format: z.literal('matrixcity-spark-tile-manifest-v1'),
  version: z.number().int().positive(),
  coordinate_frame: z.string().min(1),
  study_origin_enu_m: enuPointSchema,
  total_splat_count: z.number().int().positive(),
  total_asset_bytes: z.number().int().positive(),
  tiles: z.array(tileSchema).min(1),
});

export type GaussianTileSource = z.infer<typeof tileSchema> & { resolvedUrl: string };

export type GaussianAssetSource = {
  manifestUrl?: string;
  tiles: GaussianTileSource[];
};

/** Resolve either the legacy single-SPZ URL or a versioned tiled manifest. */
export async function resolveGaussianAssetSource(
  configuredUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<GaussianAssetSource> {
  const absoluteUrl = resolveUrl(configuredUrl, window.location.href);
  if (!new URL(absoluteUrl).pathname.toLowerCase().endsWith('.json')) {
    return {
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
    throw new Error(`Gaussian tile manifest returned HTTP ${response.status}`);
  }
  const manifest = manifestSchema.parse(await response.json());
  const primaryCount = manifest.tiles.filter((tile) => tile.role === 'primary').length;
  if (primaryCount !== 1) {
    throw new Error('Gaussian tile manifest must contain exactly one primary tile');
  }
  const ids = new Set(manifest.tiles.map((tile) => tile.id));
  if (ids.size !== manifest.tiles.length) {
    throw new Error('Gaussian tile manifest contains duplicate tile ids');
  }

  return {
    manifestUrl: absoluteUrl,
    tiles: manifest.tiles
      .map((tile) => ({
        ...tile,
        resolvedUrl: resolveUrl(tile.url, absoluteUrl),
      }))
      .sort((left, right) => left.load_order - right.load_order),
  };
}

function resolveUrl(value: string, base: string) {
  return new URL(value, base).toString();
}
