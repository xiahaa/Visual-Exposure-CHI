import { describe, expect, it, vi } from 'vitest';
import {
  resolveGaussianAssetSource,
  selectGaussianPagesForView,
  type GaussianPageSource,
} from './gaussianAssets';

const manifest = {
  format: 'matrixcity-spark-tile-manifest-v1',
  version: 2,
  coordinate_frame: 'matrixcity_big_city_local_enu_m',
  study_origin_enu_m: [200, 3700, -4.3],
  total_splat_count: 1_250_000,
  total_asset_bytes: 32_000_000,
  context_concurrency: 2,
  tiles: [
    {
      id: 'block3_tile19',
      url: 'matrixcity-tile19.spz',
      preview_url: 'matrixcity-tile19-preview.spz',
      role: 'primary',
      origin_enu_m: [200, 3700, -4.3],
      bounds_enu_m: [0, 3500, 400, 3900],
      splat_count: 1_000_000,
      byte_length: 25_000_000,
      preview_splat_count: 250_000,
      preview_byte_length: 6_000_000,
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

    expect(result.kind).toBe('tiled');
    if (result.kind !== 'tiled') throw new Error('Expected tiled source');
    expect(result.tiles.map((tile) => tile.id)).toEqual(['block3_tile19', 'block3_tile20']);
    expect(result.tiles[1].resolvedUrl).toBe('https://assets.example.test/gs/matrixcity-tile20.spz');
    expect(result.tiles[0].resolvedPreviewUrl).toBe(
      'https://assets.example.test/gs/matrixcity-tile19-preview.spz',
    );
    expect(result.contextConcurrency).toBe(2);
  });

  it('validates paged SPZ v3 and safely encodes signed OSS cell paths', async () => {
    const page = createPage('e+00002_n+00037', [200, 3700, 300, 3800]);
    const pagedManifest = {
      format: 'matrixcity-3dgs-paged-spz-v1',
      completed: true,
      encoding: {
        library: 'Niantic SPZ',
        spz_version: 3,
        sh_degree: 3,
        quaternion_layout: 'XYZW',
      },
      coordinate_frame: {
        name: 'matrixcity_big_city_local_enu_m',
        units: 'metres',
        spz_api_coordinate_system: 'RUB (raw numeric array basis only)',
        coordinate_policy: 'native_RUB_array_order_interpreted_as_local_ENU',
        page_position_reconstruction: 'world = local + page origin',
        bounds_enu_m: [200, 3700, 300, 3800],
      },
      paging: {
        recommended_query_margin_m: 30,
        page_count: 1,
        gaussian_count: page.gaussian_count,
      },
      totals: { spz_size_bytes: page.spz_size_bytes },
      tiles: [{ tile_id: 'block3_tile19', pages: [page] }],
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(pagedManifest), { status: 200 }));
    const result = await resolveGaussianAssetSource(
      'https://assets.example.test/vep/matrixcity/v3/renderer_manifest.json',
      fetcher as typeof fetch,
    );

    expect(result.kind).toBe('paged');
    if (result.kind !== 'paged') throw new Error('Expected paged source');
    expect(result.pages[0].resolvedUrl).toContain('e%2B00002_n%2B00037.spz');
    expect(result.totalGaussianCount).toBe(250_000);
  });

  it('selects only pages intersecting the active camera corridor', () => {
    const pages = [
      createRuntimePage('near', [200, 3700, 300, 3800]),
      createRuntimePage('north', [200, 3800, 300, 3900]),
      createRuntimePage('far', [600, 3100, 700, 3200]),
    ];
    const selected = selectGaussianPagesForView(
      pages,
      [210, 3720, 70],
      [280, 3770, 30],
      10,
      2,
    );
    expect(selected.map((page) => page.id)).toEqual(['block3_tile19/near']);
  });

  it('keeps legacy single-SPZ deployments compatible', async () => {
    const result = await resolveGaussianAssetSource('/gs-local/tile19.spz');
    if (result.kind !== 'tiled') throw new Error('Expected tiled source');
    expect(result.tiles).toHaveLength(1);
    expect(result.tiles[0].role).toBe('primary');
    expect(result.tiles[0].resolvedUrl).toContain('/gs-local/tile19.spz');
    expect(result.contextConcurrency).toBe(1);
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

  it('rejects incomplete progressive-preview metadata', async () => {
    const invalid = {
      ...manifest,
      tiles: manifest.tiles.map((tile, index) => (
        index === 0 ? { ...tile, preview_byte_length: undefined } : tile
      )),
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(invalid), { status: 200 }));
    await expect(resolveGaussianAssetSource(
      'https://assets.example.test/gs/neighborhood.json',
      fetcher as typeof fetch,
    )).rejects.toThrow('configured together');
  });
});

function createPage(cellId: string, bounds: [number, number, number, number]) {
  return {
    format: 'matrixcity-3dgs-spz-page-v1',
    completed: true,
    tile_id: 'block3_tile19',
    cell_id: cellId,
    bounds_enu_m: bounds,
    position_origin_enu_m: [250, 3750, -4],
    gaussian_count: 250_000,
    sh_degree: 3,
    antialiased: true,
    coordinate_policy: 'native_RUB_array_order_interpreted_as_local_ENU',
    spz_version: 3,
    spz_path: `block3_tile19/pages/${cellId}.spz`,
    spz_size_bytes: 10_000_000,
  };
}

function createRuntimePage(
  cellId: string,
  bounds: [number, number, number, number],
): GaussianPageSource {
  return {
    ...createPage(cellId, bounds),
    format: 'matrixcity-3dgs-spz-page-v1' as const,
    completed: true as const,
    position_origin_enu_m: [250, 3750, -4],
    sh_degree: 3 as const,
    coordinate_policy: 'native_RUB_array_order_interpreted_as_local_ENU' as const,
    spz_version: 3 as const,
    id: `block3_tile19/${cellId}`,
    resolvedUrl: `https://assets.example.test/${cellId}.spz`,
  };
}
