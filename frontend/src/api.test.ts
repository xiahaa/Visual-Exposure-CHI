import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadScenario } from './api';
import { scenarioFixture } from './test/fixtures';

describe('api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to bundled static Hong Kong scenario data when the backend is unavailable', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('backend unavailable'))
      .mockResolvedValueOnce(jsonResponse(scenarioFixture))
      .mockResolvedValueOnce(jsonResponse(scenarioFixture.buildings))
      .mockResolvedValueOnce(jsonResponse(scenarioFixture.semantic_layers));

    const scenario = await loadScenario('hong_kong_mong_kok_01');

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[1][0])).toBe('/scenarios/hong_kong_mong_kok_01/scenario.json');
    expect(String(fetchMock.mock.calls[2][0])).toBe('/scenarios/hong_kong_mong_kok_01/osm_buildings.geojson');
    expect(String(fetchMock.mock.calls[3][0])).toBe('/scenarios/hong_kong_mong_kok_01/osm_semantic_areas.geojson');
    expect(scenario.scenario_id).toBe('residential_block_01');
    expect(scenario.default_camera_profile_id).toBe('inspection_balanced');
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
