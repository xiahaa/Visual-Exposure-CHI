import wellknown from 'wellknown';
import { routeUploadGeoJsonSchema } from './schemas';
import type { RoutePoint, UploadParseResult } from './types';
import type { Geometry, LineStringGeometry, MultiLineStringGeometry, Position } from './utils/geojson';

const DEFAULT_ALT = 80;
const DEFAULT_YAW = 0;

export function parseRouteFileContent(content: string, fileName = 'route'): UploadParseResult {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('Route file is empty.');
  }

  if (looksLikeJson(trimmed)) {
    const parsed = safeJsonParse(trimmed);
    const geojson = routeUploadGeoJsonSchema.parse(parsed);
    return { route: routeFromGeoJson(geojson), sourceFormat: 'GeoJSON' };
  }

  const geometry = wellknown.parse(trimmed) as Geometry | null;
  if (!geometry) {
    throw new Error(`${fileName} is not valid GeoJSON or WKT.`);
  }
  return { route: routeFromGeometry(geometry), sourceFormat: 'WKT' };
}

function safeJsonParse(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Malformed GeoJSON: ${(error as Error).message}`);
  }
}

function looksLikeJson(content: string): boolean {
  return content.startsWith('{') || content.startsWith('[');
}

function routeFromGeoJson(value: ReturnType<typeof routeUploadGeoJsonSchema.parse>): RoutePoint[] {
  if (value.type === 'Feature') {
    return routeFromGeometry(value.geometry as Geometry);
  }
  if (value.type === 'FeatureCollection') {
    const routes = value.features.flatMap((feature) => routeFromGeometry(feature.geometry as Geometry));
    return validateRoute(routes);
  }
  return routeFromGeometry(value as Geometry);
}

function routeFromGeometry(geometry: Geometry): RoutePoint[] {
  if (geometry.type === 'LineString') {
    return validateRoute(routeFromLineString(geometry));
  }
  if (geometry.type === 'MultiLineString') {
    return validateRoute(routeFromMultiLineString(geometry));
  }
  throw new Error(`Unsupported route geometry type: ${geometry.type}. Use LineString or MultiLineString.`);
}

function routeFromLineString(geometry: LineStringGeometry): RoutePoint[] {
  return geometry.coordinates.map(positionToRoutePoint);
}

function routeFromMultiLineString(geometry: MultiLineStringGeometry): RoutePoint[] {
  return geometry.coordinates.flatMap((line, lineIndex) => {
    const points = line.map(positionToRoutePoint);
    return lineIndex === 0 ? points : points.slice(1);
  });
}

function positionToRoutePoint(position: Position): RoutePoint {
  const [lon, lat, alt = DEFAULT_ALT] = position;
  return { lon, lat, alt, yaw: DEFAULT_YAW };
}

function validateRoute(route: RoutePoint[]): RoutePoint[] {
  if (route.length < 2) {
    throw new Error('Route must contain at least two coordinates.');
  }
  for (const point of route) {
    if (point.lon < -180 || point.lon > 180) {
      throw new Error(`Invalid longitude ${point.lon}; expected -180 to 180.`);
    }
    if (point.lat < -90 || point.lat > 90) {
      throw new Error(`Invalid latitude ${point.lat}; expected -90 to 90.`);
    }
  }
  return route;
}
