import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { compareFixture, exposureFixture, planningFixture, scenarioFixture } from './test/fixtures';

const mapClickCoordinates = [
  [113.9303, 22.5403],
  [113.9305, 22.5403],
  [113.9305, 22.5405],
  [113.9308, 22.5408],
  [113.931, 22.5408],
  [113.931, 22.541],
];
let mapClickIndex = 0;

vi.mock('@deck.gl/react', () => ({
  default: ({ children, onClick }: { children?: React.ReactNode; onClick?: (info: unknown) => void }) => (
    <div
      data-testid="deckgl"
      onClick={() => {
        const coordinate = mapClickCoordinates[mapClickIndex % mapClickCoordinates.length];
        mapClickIndex += 1;
        onClick?.({ coordinate });
      }}
    >
      {children}
    </div>
  ),
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
    mapClickIndex = 0;
  });

  it('loads scenario data and renders the default route context', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(scenarioFixture));

    render(<App />);

    expect(await screen.findByText('Residential Block Roof Inspection')).toBeInTheDocument();
    expect(metricValue('Waypoints')).toBe('2');
    expect(metricValue('Frustums')).toBe('2');
    expect(screen.getByText('Default route loaded from scenario.')).toBeInTheDocument();
    expect(screen.getByText('User Guide / 使用指南')).toBeInTheDocument();
    expect(screen.getByText('Prepare a route by uploading a file or selecting waypoints on the map.')).toBeInTheDocument();
    expect(screen.getByText('通过上传文件或在地图上选点来准备航线。')).toBeInTheDocument();
    expect(screen.getByText('可上传 GeoJSON/WKT，也可手动在地图上选择航点。')).toBeInTheDocument();
    expect(screen.getByText('Camera Mode')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Balanced Inspection/ })).toBeInTheDocument();
    expect(document.querySelector('.advanced-camera')).not.toHaveAttribute('open');
  });

  it('collapses the bilingual guide and updates steps by study condition', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(scenarioFixture));

    render(<App />);
    await screen.findByText('Residential Block Roof Inspection');

    const guide = document.querySelector('.step-guide');
    expect(guide).toHaveAttribute('open');
    await userEvent.click(screen.getByText('User Guide / 使用指南'));
    expect(guide).not.toHaveAttribute('open');

    await userEvent.click(screen.getByRole('button', { name: 'C2 Route + Footprint' }));
    expect(screen.getByText('Use the footprint to judge which places may enter the camera view.')).toBeInTheDocument();
    expect(screen.getByText('根据相机覆盖范围判断哪些地点可能进入画面。')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'C1 Basic Notice' }));
    expect(screen.getByText('Review the flight notice, route, altitude, and task purpose.')).toBeInTheDocument();
    expect(screen.getByText('查看飞行通知、航线、高度和任务目的。')).toBeInTheDocument();
    expect(screen.queryByText('Show Preference-Weighted Exposure')).not.toBeInTheDocument();
  });

  it('computes exposure using an uploaded GeoJSON route and selected camera preset', async () => {
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
    await userEvent.click(screen.getByRole('button', { name: /Focused Detail/ }));

    await userEvent.click(screen.getByRole('button', { name: 'Compute Exposure' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(requestBody.route).toHaveLength(3);
    expect(requestBody.route[0]).toEqual({ lon: 113.93, lat: 22.54, alt: 80, yaw: 0 });
    expect(requestBody.camera.max_depth_m).toBe(140);
    expect(requestBody.camera.ray_width).toBe(120);
    expect(requestBody.user_preferences.sensitive_areas.features).toHaveLength(0);
    expect(requestBody.user_preferences.do_not_capture.features).toHaveLength(0);
    expect(await screen.findByText('Sensitive Exposure')).toBeInTheDocument();
    expect(screen.getByText('42.2')).toBeInTheDocument();
    expect(screen.getByText('Affected Buildings')).toBeInTheDocument();
    expect(screen.getByText('Affected Areas')).toBeInTheDocument();
    expect(screen.getByText('What This Means / 含义说明')).toBeInTheDocument();
    expect(screen.getByText('Orange outlines and halos show buildings and areas with non-zero estimated exposure.')).toBeInTheDocument();
    expect(screen.getByText('橙色轮廓和光环表示估计暴露值不为零的建筑和区域。')).toBeInTheDocument();
  });

  it('marks the camera profile as custom after advanced edits', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(scenarioFixture))
      .mockResolvedValueOnce(jsonResponse(exposureFixture));

    render(<App />);
    await screen.findByText('Residential Block Roof Inspection');

    expect(document.querySelector('.advanced-camera')).not.toHaveAttribute('open');
    await userEvent.click(screen.getByText('Advanced Camera'));
    await userEvent.clear(screen.getByLabelText('Max Depth'));
    await userEvent.type(screen.getByLabelText('Max Depth'), '130');

    expect(screen.getByText('Custom')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Compute Exposure' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(requestBody.camera.max_depth_m).toBe(130);
  });

  it('lets users create a manual waypoint route before computing exposure', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(scenarioFixture))
      .mockResolvedValueOnce(jsonResponse(exposureFixture));

    render(<App />);
    await screen.findByText('Residential Block Roof Inspection');

    await userEvent.click(screen.getByRole('button', { name: 'New Manual Route' }));
    await userEvent.click(screen.getByTestId('deckgl'));
    await userEvent.click(screen.getByTestId('deckgl'));
    await userEvent.click(screen.getByTestId('deckgl'));

    expect(metricValue('Waypoints')).toBe('3');
    await userEvent.click(screen.getByRole('button', { name: 'Finish Route' }));
    expect(await screen.findByText('Manual route ready: 3 waypoints.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Compute Exposure' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(requestBody.route).toHaveLength(3);
    expect(requestBody.route[0]).toMatchObject({ lon: 113.9303, lat: 22.5403, alt: 80 });
    expect(typeof requestBody.route[0].yaw).toBe('number');
  });

  it('draws preferences and sends them in compare requests', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(scenarioFixture))
      .mockResolvedValueOnce(jsonResponse(compareFixture));

    render(<App />);
    await screen.findByText('Residential Block Roof Inspection');

    await userEvent.click(screen.getByRole('button', { name: 'Sensitive' }));
    await userEvent.click(screen.getByTestId('deckgl'));
    await userEvent.click(screen.getByTestId('deckgl'));
    await userEvent.click(screen.getByTestId('deckgl'));
    await userEvent.click(screen.getByRole('button', { name: 'Close Polygon' }));
    await userEvent.click(screen.getByRole('button', { name: 'Do Not Capture' }));
    await userEvent.click(screen.getByTestId('deckgl'));
    await userEvent.click(screen.getByTestId('deckgl'));
    await userEvent.click(screen.getByTestId('deckgl'));
    await userEvent.click(screen.getByRole('button', { name: 'Close Polygon' }));
    await userEvent.click(screen.getByRole('button', { name: 'Show Preference-Weighted Exposure' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(requestBody.after.user_preferences.sensitive_areas.features).toHaveLength(1);
    expect(requestBody.after.user_preferences.do_not_capture.features).toHaveLength(1);
    expect(await screen.findByText('Before Sensitive')).toBeInTheDocument();
    expect(screen.getByText('Exposure Delta')).toBeInTheDocument();
    expect(screen.getByText('这些数值概括了应用用户隐私偏好后的取舍关系。')).toBeInTheDocument();
  });

  it('draws preference vertices before surface inspection while in preference mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(scenarioFixture));

    render(<App />);
    await screen.findByText('Residential Block Roof Inspection');

    await userEvent.click(screen.getByRole('button', { name: 'Sensitive' }));
    await userEvent.click(screen.getByTestId('deckgl'));
    await userEvent.click(screen.getByTestId('deckgl'));
    await userEvent.click(screen.getByTestId('deckgl'));

    expect(screen.getByRole('button', { name: 'Close Polygon' })).toBeEnabled();
  });

  it('optimizes privacy options and applies a selected planning route', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(scenarioFixture))
      .mockResolvedValueOnce(jsonResponse(planningFixture));

    render(<App />);
    await screen.findByText('Residential Block Roof Inspection');

    await userEvent.click(screen.getByRole('button', { name: 'Sensitive' }));
    await userEvent.click(screen.getByTestId('deckgl'));
    await userEvent.click(screen.getByTestId('deckgl'));
    await userEvent.click(screen.getByTestId('deckgl'));
    await userEvent.click(screen.getByRole('button', { name: 'Close Polygon' }));
    await userEvent.click(screen.getByRole('button', { name: 'Generate Privacy Options' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/planning/optimize');
    expect(requestBody.user_preferences.sensitive_areas.features).toHaveLength(1);
    expect(requestBody.planner_config.evaluation_ray_width).toBe(32);
    expect(requestBody.planner_config.evaluation_ray_height).toBe(18);
    expect(await screen.findByText('Suggested Alternatives')).toBeInTheDocument();
    expect(screen.getByText('Privacy-first')).toBeInTheDocument();
    expect(screen.getAllByText('Sensitive Down')).toHaveLength(2);
    expect(screen.getByText('Suggested alternatives generated: previewing Privacy-first.')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Apply' })[0]);
    expect(
      screen.getByText('Applied suggested alternative: Privacy-first. Recompute exposure to verify the final route at full fidelity.'),
    ).toBeInTheDocument();
  });

  it('switches study conditions and hides visual-exposure controls in C1', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(scenarioFixture));

    render(<App />);
    await screen.findByText('Residential Block Roof Inspection');

    expect(screen.getByRole('button', { name: 'Show Preference-Weighted Exposure' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'C1 Basic Notice' }));

    expect(screen.queryByRole('button', { name: 'Compute Exposure' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show Preference-Weighted Exposure' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate Privacy Options' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Route file')).not.toBeInTheDocument();
    expect(screen.queryByText('HFOV')).not.toBeInTheDocument();
  });

  it('keeps C2 focused on route and frustum without exposure or planning controls', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(scenarioFixture));

    render(<App />);
    await screen.findByText('Residential Block Roof Inspection');

    await userEvent.click(screen.getByRole('button', { name: 'C2 Route + Footprint' }));

    expect(screen.getByLabelText('Route file')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Manual Route' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compute Exposure' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show Preference-Weighted Exposure' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate Privacy Options' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sensitive' })).not.toBeInTheDocument();
    expect(screen.queryByText('HFOV')).not.toBeInTheDocument();
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
