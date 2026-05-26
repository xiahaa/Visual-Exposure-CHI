import { exposureResponseSchema, scenarioSchema } from './schemas';
import type { CameraConfig, ExposureResponse, RoutePoint, Scenario } from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8011';

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

export async function loadScenario(scenarioId = 'residential_block_01'): Promise<Scenario> {
  const data = await fetchJson(`${API_BASE_URL}/api/scenarios/${scenarioId}`);
  return scenarioSchema.parse(data) as Scenario;
}

export async function computeExposure(
  scenarioId: string,
  route: RoutePoint[],
  camera: CameraConfig,
): Promise<ExposureResponse> {
  const data = await fetchJson(`${API_BASE_URL}/api/exposure/compute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scenario_id: scenarioId,
      route,
      camera,
      user_preferences: { acceptable_conditions: [] },
    }),
  });
  return exposureResponseSchema.parse(data) as ExposureResponse;
}
