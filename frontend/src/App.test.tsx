import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { exposureFixture, scenarioFixture } from './test/fixtures';

vi.mock('@deck.gl/react', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div data-testid="deckgl">{children}</div>,
}));

vi.mock('deck.gl', () => ({
  GeoJsonLayer: class MockGeoJsonLayer {
    constructor(public props: unknown) {}
  },
  PathLayer: class MockPathLayer {
    constructor(public props: unknown) {}
  },
  PolygonLayer: class MockPolygonLayer {
    constructor(public props: unknown) {}
  },
  ScatterplotLayer: class MockScatterplotLayer {
    constructor(public props: unknown) {}
  },
  TextLayer: class MockTextLayer {
    constructor(public props: unknown) {}
  },
}));

vi.mock('@deck.gl/geo-layers', () => ({
  TileLayer: class MockTileLayer {
    constructor(public props: unknown) {}
  },
}));

vi.mock('@deck.gl/layers', () => ({
  BitmapLayer: class MockBitmapLayer {
    constructor(public props: unknown) {}
  },
}));

describe('App', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads scenario data and renders the default route context', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(scenarioFixture));

    render(<App />);

    expect(await screen.findByText('Residential Block Roof Inspection')).toBeInTheDocument();
    expect(metricValue('Waypoints')).toBe('2');
    expect(metricValue('Frustums')).toBe('2');
    expect(screen.getByText('Default route loaded from scenario.')).toBeInTheDocument();
  });

  it('computes exposure using an uploaded GeoJSON route', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(scenarioFixture))
      .mockResolvedValueOnce(jsonResponse(exposureFixture));

    render(<App />);
    await screen.findByText('Residential Block Roof Inspection');

    const routeFile = new File(
      [
        JSON.stringify({
          type: 'LineString',
          coordinates: [
            [113.93, 22.54, 80],
            [113.931, 22.541, 80],
            [113.932, 22.542, 80],
          ],
        }),
      ],
      'route.geojson',
      { type: 'application/geo+json' },
    );

    await userEvent.upload(screen.getByLabelText('Route file'), routeFile);
    expect(await screen.findByText('GeoJSON route loaded: 3 waypoints.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Compute Exposure' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(requestBody.route).toHaveLength(3);
    expect(requestBody.route[0]).toEqual({ lon: 113.93, lat: 22.54, alt: 80, yaw: 0 });
    expect(await screen.findByText('Sensitive Exposure')).toBeInTheDocument();
    expect(screen.getByText('42.2')).toBeInTheDocument();
  });
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as Response;
}

function metricValue(label: string): string {
  const labelNode = screen.getByText(label);
  const metric = labelNode.closest('.metric');
  if (!metric) {
    throw new Error(`Metric not found: ${label}`);
  }
  return metric.querySelector('strong')?.textContent ?? '';
}
