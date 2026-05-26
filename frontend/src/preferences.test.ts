import { describe, expect, it } from 'vitest';
import { buildUserPreferences, createPreferencePolygon, preferencePolygonsToGeoJson } from './preferences';

describe('preferences', () => {
  it('creates valid GeoJSON from drawn sensitive polygons', () => {
    const polygon = createPreferencePolygon(
      [
        [113.93, 22.54],
        [113.931, 22.54],
        [113.931, 22.541],
      ],
      'sensitive_area',
      'p1',
    );

    const geojson = preferencePolygonsToGeoJson([polygon], 'sensitive_area');

    expect(geojson.features).toHaveLength(1);
    expect(geojson.features[0].geometry.type).toBe('Polygon');
    expect((geojson.features[0].geometry as any).coordinates[0]).toHaveLength(4);
  });

  it('separates sensitive and do-not-capture preferences', () => {
    const sensitive = createPreferencePolygon(
      [
        [113.93, 22.54],
        [113.931, 22.54],
        [113.931, 22.541],
      ],
      'sensitive_area',
      's1',
    );
    const doNotCapture = createPreferencePolygon(
      [
        [113.932, 22.54],
        [113.933, 22.54],
        [113.933, 22.541],
      ],
      'do_not_capture',
      'd1',
    );

    const preferences = buildUserPreferences([sensitive, doNotCapture]);

    expect(preferences.sensitive_areas?.features).toHaveLength(1);
    expect(preferences.do_not_capture?.features).toHaveLength(1);
  });
});

