import type { Feature, FeatureCollection, Position } from './utils/geojson';
import type { PreferenceKind, UserPreferences } from './types';

export type PreferencePolygon = {
  id: string;
  kind: PreferenceKind;
  coordinates: Array<[number, number]>;
};

export function createPreferencePolygon(
  coordinates: Array<[number, number]>,
  kind: PreferenceKind,
  id = `pref_${Date.now()}`,
): PreferencePolygon {
  if (coordinates.length < 3) {
    throw new Error('A preference polygon needs at least three vertices.');
  }
  return { id, kind, coordinates };
}

export function closeRing(coordinates: Array<[number, number]>): Position[] {
  if (coordinates.length === 0) return [];
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  const ring = coordinates.map((coordinate) => [coordinate[0], coordinate[1]] as Position);
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

export function preferencePolygonsToGeoJson(
  polygons: PreferencePolygon[],
  kind: PreferenceKind,
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: polygons
      .filter((polygon) => polygon.kind === kind)
      .map(
        (polygon): Feature => ({
          type: 'Feature',
          properties: { preference_id: polygon.id, preference_kind: polygon.kind },
          geometry: {
            type: 'Polygon',
            coordinates: [closeRing(polygon.coordinates)],
          },
        }),
      ),
  };
}

export function buildUserPreferences(polygons: PreferencePolygon[]): UserPreferences {
  return {
    sensitive_areas: preferencePolygonsToGeoJson(polygons, 'sensitive_area'),
    do_not_capture: preferencePolygonsToGeoJson(polygons, 'do_not_capture'),
    acceptable_conditions: [],
  };
}

export function preferenceCollection(polygons: PreferencePolygon[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: polygons.map(
      (polygon): Feature => ({
        type: 'Feature',
        properties: { preference_id: polygon.id, preference_kind: polygon.kind },
        geometry: {
          type: 'Polygon',
          coordinates: [closeRing(polygon.coordinates)],
        },
      }),
    ),
  };
}

