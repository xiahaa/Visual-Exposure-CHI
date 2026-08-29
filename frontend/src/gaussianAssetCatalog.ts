import { z } from 'zod';
import { API_BASE_URL } from './api';

const gaussianAssetProfileSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  // Backend profiles use HTTPS; deploy-time/local compatibility may use a
  // same-origin relative URL such as /gs-assets/tile19.spz.
  manifest_url: z.string().min(1),
  format: z.enum(['tiled', 'paged']),
  fallback_profile_id: z.string().min(1).nullable(),
  max_concurrent_requests: z.number().int().min(1).max(4),
  max_resident_pages: z.number().int().min(1).max(16),
  load_timeout_ms: z.number().int().min(5000).max(180000),
});

const gaussianAssetCatalogSchema = z.object({
  default_profile_id: z.string().min(1),
  profiles: z.array(gaussianAssetProfileSchema).min(1),
}).superRefine((catalog, context) => {
  const ids = new Set(catalog.profiles.map((profile) => profile.id));
  if (!ids.has(catalog.default_profile_id)) {
    context.addIssue({ code: 'custom', message: 'Default Gaussian profile is missing' });
  }
  catalog.profiles.forEach((profile) => {
    if (profile.fallback_profile_id && !ids.has(profile.fallback_profile_id)) {
      context.addIssue({ code: 'custom', message: `Missing fallback ${profile.fallback_profile_id}` });
    }
  });
});

export type GaussianAssetProfile = z.infer<typeof gaussianAssetProfileSchema>;
export type GaussianAssetCatalog = z.infer<typeof gaussianAssetCatalogSchema>;

export type GaussianAssetSelection = {
  requestedProfileId: string;
  profile: GaussianAssetProfile;
  fallbackProfile?: GaussianAssetProfile;
  source: 'backend' | 'environment';
};

const STANDARD_PROFILE_ID = 'standard_v2';
const PAGED_PROFILE_ID = 'paged_v3';

/**
 * Build a deploy-time catalog so the current study remains usable while the
 * HF backend wakes up. The backend catalog replaces these values once loaded.
 */
export function environmentGaussianAssetCatalog(): GaussianAssetCatalog | null {
  const standardUrl = readEnvironmentUrl(
    'VITE_MATRIXCITY_GS_MANIFEST_URL',
    'VITE_MATRIXCITY_GS_URL',
  );
  if (!standardUrl) return null;
  const profiles: GaussianAssetProfile[] = [{
    id: STANDARD_PROFILE_ID,
    label: 'Standard study scene',
    description: 'Established progressive MatrixCity scene used by the current pilot.',
    manifest_url: standardUrl,
    format: 'tiled',
    fallback_profile_id: null,
    max_concurrent_requests: 2,
    max_resident_pages: 9,
    load_timeout_ms: 90000,
  }];
  const pagedUrl = readEnvironmentUrl('VITE_MATRIXCITY_GS_PAGED_MANIFEST_URL');
  if (pagedUrl) {
    profiles.push({
      id: PAGED_PROFILE_ID,
      label: 'High-quality paged scene',
      description: 'SH3 MatrixCity pages streamed around the active camera corridor.',
      manifest_url: pagedUrl,
      format: 'paged',
      fallback_profile_id: STANDARD_PROFILE_ID,
      max_concurrent_requests: 2,
      max_resident_pages: 6,
      load_timeout_ms: 90000,
    });
  }
  return gaussianAssetCatalogSchema.parse({
    default_profile_id: STANDARD_PROFILE_ID,
    profiles,
  });
}

export async function loadGaussianAssetCatalog(
  fetcher: typeof fetch = fetch,
): Promise<GaussianAssetCatalog> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetcher(`${API_BASE_URL}/api/gaussian-assets`, {
      mode: 'cors',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Gaussian asset catalog returned HTTP ${response.status}`);
    return gaussianAssetCatalogSchema.parse(await response.json());
  } catch (error) {
    const fallback = environmentGaussianAssetCatalog();
    if (fallback) return fallback;
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function selectGaussianAssetProfile(
  catalog: GaussianAssetCatalog,
  requestedProfileId: string | null | undefined,
  source: GaussianAssetSelection['source'] = 'backend',
): GaussianAssetSelection {
  const requested = requestedProfileId?.trim() || catalog.default_profile_id;
  const profile = catalog.profiles.find((candidate) => candidate.id === requested)
    ?? catalog.profiles.find((candidate) => candidate.id === catalog.default_profile_id)
    ?? catalog.profiles[0];
  const fallbackProfile = profile.fallback_profile_id
    ? catalog.profiles.find((candidate) => candidate.id === profile.fallback_profile_id)
    : undefined;
  return {
    requestedProfileId: requested,
    profile,
    fallbackProfile,
    source,
  };
}

export function initialGaussianAssetSelection(
  requestedProfileId: string | null | undefined,
): GaussianAssetSelection | undefined {
  const catalog = environmentGaussianAssetCatalog();
  return catalog
    ? selectGaussianAssetProfile(catalog, requestedProfileId, 'environment')
    : undefined;
}

function readEnvironmentUrl(...keys: string[]) {
  for (const key of keys) {
    const value = import.meta.env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}
