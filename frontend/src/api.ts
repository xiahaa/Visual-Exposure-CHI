import { compareResponseSchema, exposureResponseSchema, planningResponseSchema, scenarioSchema } from './schemas';
import type { CameraConfig, CompareResponse, ExposureResponse, PlanningResponse, RoutePoint, Scenario, UserPreferences } from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://127.0.0.1:8011' : '');
const STATIC_SCENARIO_BASE = '/scenarios';

const STATIC_CAMERA_PROFILES = [
  {
    id: 'wide_survey',
    label: 'Wide Survey',
    description: 'Wider context view for public notice and broad situational awareness.',
    camera: {
      hfov_deg: 92,
      vfov_deg: 58,
      gimbal_pitch_deg: -42,
      ray_width: 72,
      ray_height: 40,
      min_depth_m: 0,
      max_depth_m: 220,
    },
  },
  {
    id: 'inspection_balanced',
    label: 'Balanced Inspection',
    description: 'Default study camera balancing coverage, detail, and interactive speed.',
    camera: {
      hfov_deg: 78,
      vfov_deg: 50,
      gimbal_pitch_deg: -45,
      ray_width: 80,
      ray_height: 45,
      min_depth_m: 0,
      max_depth_m: 250,
    },
  },
  {
    id: 'focused_detail',
    label: 'Focused Detail',
    description: 'Narrower detail view for closer inspection with a shorter effective depth.',
    camera: {
      hfov_deg: 56,
      vfov_deg: 36,
      gimbal_pitch_deg: -50,
      ray_width: 120,
      ray_height: 68,
      min_depth_m: 5,
      max_depth_m: 140,
    },
  },
];

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

export async function loadScenario(scenarioId = 'hong_kong_mong_kok_01'): Promise<Scenario> {
  try {
    const data = await fetchJson(`${API_BASE_URL}/api/scenarios/${scenarioId}`);
    return scenarioSchema.parse(data) as Scenario;
  } catch (reason) {
    if (scenarioId !== 'hong_kong_mong_kok_01') {
      throw reason;
    }
    return loadStaticScenario(scenarioId);
  }
}

async function loadStaticScenario(scenarioId: string): Promise<Scenario> {
  const base = `${STATIC_SCENARIO_BASE}/${scenarioId}`;
  const [scenario, buildings, semanticLayers] = await Promise.all([
    fetchJson(`${base}/scenario.json`),
    fetchJson(`${base}/osm_buildings.geojson`),
    fetchJson(`${base}/osm_semantic_areas.geojson`),
  ]);
  return scenarioSchema.parse({
    ...(scenario as Record<string, unknown>),
    buildings,
    semantic_layers: semanticLayers,
    camera_profiles: STATIC_CAMERA_PROFILES,
    default_camera_profile_id: 'inspection_balanced',
    camera: STATIC_CAMERA_PROFILES[1].camera,
  }) as Scenario;
}

export async function computeExposure(
  scenarioId: string,
  route: RoutePoint[],
  camera: CameraConfig,
  userPreferences: UserPreferences = { acceptable_conditions: [] },
): Promise<ExposureResponse> {
  const data = await fetchJson(`${API_BASE_URL}/api/exposure/compute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scenario_id: scenarioId,
      route,
      camera,
      user_preferences: userPreferences,
    }),
  });
  return exposureResponseSchema.parse(data) as ExposureResponse;
}

export async function compareExposure(
  scenarioId: string,
  route: RoutePoint[],
  camera: CameraConfig,
  userPreferences: UserPreferences,
): Promise<CompareResponse> {
  const before = {
    scenario_id: scenarioId,
    route,
    camera,
    user_preferences: { acceptable_conditions: [] },
  };
  const after = {
    scenario_id: scenarioId,
    route,
    camera,
    user_preferences: userPreferences,
  };
  const data = await fetchJson(`${API_BASE_URL}/api/exposure/compare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario_id: scenarioId, before, after }),
  });
  return compareResponseSchema.parse(data) as CompareResponse;
}

export async function optimizePlanning(
  scenarioId: string,
  route: RoutePoint[],
  camera: CameraConfig,
  userPreferences: UserPreferences,
): Promise<PlanningResponse> {
  const data = await fetchJson(`${API_BASE_URL}/api/planning/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scenario_id: scenarioId,
      route,
      camera,
      user_preferences: userPreferences,
      planner_config: {
        max_options: 3,
        max_candidates: 8,
        evaluation_ray_width: 32,
        evaluation_ray_height: 18,
        influence_radius_m: 120,
      },
    }),
  });
  return planningResponseSchema.parse(data) as PlanningResponse;
}
