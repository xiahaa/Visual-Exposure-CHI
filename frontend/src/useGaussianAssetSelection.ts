import { useEffect, useState } from 'react';
import {
  initialGaussianAssetSelection,
  loadGaussianAssetCatalog,
  selectGaussianAssetProfile,
  type GaussianAssetSelection,
} from './gaussianAssetCatalog';

/** Resolve a query-selected GS profile while keeping deploy-time fallback fast. */
export function useGaussianAssetSelection(requestedProfileId: string | null | undefined) {
  const [selection, setSelection] = useState<GaussianAssetSelection | undefined>(
    () => initialGaussianAssetSelection(requestedProfileId),
  );

  useEffect(() => {
    let cancelled = false;
    void loadGaussianAssetCatalog().then((catalog) => {
      if (cancelled) return;
      const next = selectGaussianAssetProfile(catalog, requestedProfileId);
      setSelection((current) => (
        runtimeSelectionKey(current) === runtimeSelectionKey(next) ? current : next
      ));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [requestedProfileId]);

  return selection;
}

function runtimeSelectionKey(selection: GaussianAssetSelection | undefined) {
  if (!selection) return '';
  return JSON.stringify({
    requested: selection.requestedProfileId,
    profile: runtimeProfileKey(selection.profile),
    fallback: selection.fallbackProfile
      ? runtimeProfileKey(selection.fallbackProfile)
      : undefined,
  });
}

function runtimeProfileKey(profile: GaussianAssetSelection['profile']) {
  return {
    id: profile.id,
    manifestUrl: profile.manifest_url,
    format: profile.format,
    fallbackProfileId: profile.fallback_profile_id,
    maxConcurrentRequests: profile.max_concurrent_requests,
    maxResidentPages: profile.max_resident_pages,
    loadTimeoutMs: profile.load_timeout_ms,
  };
}
