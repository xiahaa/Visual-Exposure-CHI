import { describe, expect, it, vi } from 'vitest';
import { resolveGaussianAssetSource } from './gaussianAssets';

const manifest = {
  format: 'matrixcity-spark-tile-manifest-v1',
  version: 2,
  coordinate_frame: 'matrixcity_big_city_local_enu_m',
  study_origin_enu_m: [200, 3700, -4.3],
  total_splat_count: 1_250_000,
  total_asset_bytes: 32_000_000,
  tiles: [
    {
      id: 'block3_tile19',
      url: 'matrixcity-tile19.spz',
      role: 'primary',
      origin_enu_m: [200, 3700, -4.3],
      bounds_enu_m: [0, 3500, 400, 3900],
      splat_count: 1_000_000,
      byte_length: 25_000_000,
      load_order: 0,
    },
    {
      id: 'block3_tile20',
      url: 'matrixcity-tile20.spz',
      role: 'context',
      origin_enu_m: [600, 3700, -9.4],
      bounds_enu_m: [400, 3500, 800, 3900],
      splat_count: 250_000,
      byte_length: 7_000_000,
      load_order: 1,
    },
  ],
};

describe('resolveGaussianAssetSource', () => {
  it('resolves manifest-relative tile URLs in load order', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(manifest), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await resolveGaussianAssetSource(
      'https://assets.example.test/gs/neighborhood.json',
      fetcher as typeof fetch,
    );

    expect(result.tiles.map((tile) => tile.id)).toEqual(['block3_tile19', 'block3_tile20']);
    expect(result.tiles[1].resolvedUrl).toBe('https://assets.example.test/gs/matrixcity-tile20.spz');
  });

  it('keeps legacy single-SPZ deployments compatible', async () => {
    const result = await resolveGaussianAssetSource('/gs-local/tile19.spz');
    expect(result.tiles).toHaveLength(1);
    expect(result.tiles[0].role).toBe('primary');
    expect(result.tiles[0].resolvedUrl).toContain('/gs-local/tile19.spz');
  });

  it('rejects a manifest without exactly one primary tile', async () => {
    const invalid = {
      ...manifest,
      tiles: manifest.tiles.map((tile) => ({ ...tile, role: 'context' })),
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(invalid), { status: 200 }));
    await expect(resolveGaussianAssetSource(
      'https://assets.example.test/gs/neighborhood.json',
      fetcher as typeof fetch,
    )).rejects.toThrow('exactly one primary');
  });
});
