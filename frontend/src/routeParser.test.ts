import { describe, expect, it } from 'vitest';
import { parseRouteFileContent } from './routeParser';

describe('parseRouteFileContent', () => {
  it('parses GeoJSON LineString routes', () => {
    const result = parseRouteFileContent(
      JSON.stringify({
        type: 'LineString',
        coordinates: [
          [113.93, 22.54, 80],
          [113.931, 22.541, 90],
        ],
      }),
    );

    expect(result.sourceFormat).toBe('GeoJSON');
    expect(result.route).toEqual([
      { lon: 113.93, lat: 22.54, alt: 80, yaw: 0 },
      { lon: 113.931, lat: 22.541, alt: 90, yaw: 0 },
    ]);
  });

  it('parses WKT LineString routes', () => {
    const result = parseRouteFileContent('LINESTRING (113.93 22.54, 113.931 22.541)');

    expect(result.sourceFormat).toBe('WKT');
    expect(result.route).toEqual([
      { lon: 113.93, lat: 22.54, alt: 80, yaw: 0 },
      { lon: 113.931, lat: 22.541, alt: 80, yaw: 0 },
    ]);
  });

  it('rejects single-point routes', () => {
    expect(() =>
      parseRouteFileContent(JSON.stringify({ type: 'LineString', coordinates: [[113.93, 22.54]] })),
    ).toThrow();
  });

  it('rejects invalid coordinates', () => {
    expect(() =>
      parseRouteFileContent(
        JSON.stringify({
          type: 'LineString',
          coordinates: [
            [220, 22.54],
            [113.931, 22.541],
          ],
        }),
      ),
    ).toThrow();
  });

  it('rejects malformed GeoJSON and WKT', () => {
    expect(() => parseRouteFileContent('{ nope')).toThrow('Malformed GeoJSON');
    expect(() => parseRouteFileContent('NOT_A_ROUTE')).toThrow('not valid GeoJSON or WKT');
  });
});

