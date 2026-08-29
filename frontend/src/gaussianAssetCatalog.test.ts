import { describe, expect, it, vi } from 'vitest';
import {
  loadGaussianAssetCatalog,
  selectGaussianAssetProfile,
} from './gaussianAssetCatalog';

const catalog = {
  default_profile_id: 'standard_v2',
  profiles: [
    {
      id: 'standard_v2',
      label: 'Standard study scene',
      description: 'Current pilot asset.',
      manifest_url: 'https://assets.example.test/v2.json',
      format: 'tiled',
      fallback_profile_id: null,
      max_concurrent_requests: 2,
      max_resident_pages: 9,
      load_timeout_ms: 90000,
    },
    {
      id: 'paged_v3',
      label: 'High-quality paged scene',
      description: 'Optional high-quality asset.',
      manifest_url: 'https://assets.example.test/v3.json',
      format: 'paged',
      fallback_profile_id: 'standard_v2',
      max_concurrent_requests: 2,
      max_resident_pages: 6,
      load_timeout_ms: 90000,
    },
  ],
};

describe('Gaussian asset catalog', () => {
  it('loads backend profiles and connects the v3 fallback', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(catalog), { status: 200 }));
    const loaded = await loadGaussianAssetCatalog(fetcher as typeof fetch);
    const selection = selectGaussianAssetProfile(loaded, 'paged_v3');

    expect(selection.profile.id).toBe('paged_v3');
    expect(selection.fallbackProfile?.id).toBe('standard_v2');
    expect(selection.profile.max_resident_pages).toBe(6);
  });

  it('uses the configured default for an unknown query profile', () => {
    const selection = selectGaussianAssetProfile(catalog as never, 'not-present');
    expect(selection.profile.id).toBe('standard_v2');
  });
});
