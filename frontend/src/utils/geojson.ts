export type Position = number[];

export type PointGeometry = {
  type: 'Point';
  coordinates: Position;
};

export type LineStringGeometry = {
  type: 'LineString';
  coordinates: Position[];
};

export type MultiLineStringGeometry = {
  type: 'MultiLineString';
  coordinates: Position[][];
};

export type PolygonGeometry = {
  type: 'Polygon';
  coordinates: Position[][];
};

export type MultiPolygonGeometry = {
  type: 'MultiPolygon';
  coordinates: Position[][][];
};

export type Geometry =
  | PointGeometry
  | LineStringGeometry
  | MultiLineStringGeometry
  | PolygonGeometry
  | MultiPolygonGeometry;

export type Feature = {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: Geometry;
};

export type FeatureCollection = {
  type: 'FeatureCollection';
  features: Feature[];
};

export function routeToGeoJson(route: Array<{ lon: number; lat: number }>): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { kind: 'route' },
        geometry: {
          type: 'LineString',
          coordinates: route.map((point) => [point.lon, point.lat]),
        },
      },
    ],
  };
}
