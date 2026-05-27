import type { FeatureCollection, Geometry } from './utils/geojson';

export type RoutePoint = {
  lon: number;
  lat: number;
  alt: number;
  yaw: number;
};

export type CameraConfig = {
  hfov_deg: number;
  vfov_deg: number;
  gimbal_pitch_deg: number;
  ray_width: number;
  ray_height: number;
  min_depth_m?: number;
  max_depth_m?: number;
};

export type CameraProfile = {
  id: string;
  label: string;
  description: string;
  camera: CameraConfig;
};

export type Scenario = {
  scenario_id: string;
  name: string;
  origin: { lon: number; lat: number; alt: number };
  camera: CameraConfig;
  camera_profiles: CameraProfile[];
  default_camera_profile_id: string;
  default_route: RoutePoint[];
  summary: { task: string; notice: string };
  buildings: FeatureCollection;
  semantic_layers: FeatureCollection;
};

export type ExposureSummary = {
  total_exposure: number;
  sensitive_exposure: number;
  max_exposure_area: string | null;
  route_length_m: number;
  sampled_pose_count: number;
  ray_count: number;
  estimated_task_coverage: number;
  engine: string;
  config: {
    min_range_m?: number;
    max_range_m: number;
    recognizability_d0_m: number;
    route_sample_step_m: number;
  };
};

export type ExposureResponse = {
  exposure_surfaces: FeatureCollection;
  exposure_points: Array<{
    lon: number;
    lat: number;
    exposure: number;
    surface_id: string;
    surface_type: string;
    semantic_type: string;
  }>;
  summary: ExposureSummary;
};

export type UserPreferences = {
  do_not_capture?: FeatureCollection | null;
  sensitive_areas?: FeatureCollection | null;
  acceptable_conditions: Array<Record<string, unknown>>;
};

export type CompareResponse = {
  before: ExposureSummary;
  after: ExposureSummary;
  delta: {
    exposure_reduction_percent: number;
    route_length_increase_percent: number;
    coverage_loss_percent: number;
  };
  explanation: string;
};

export type PlanningOption = {
  id: string;
  label: string;
  strategy: string;
  modified_route: RoutePoint[];
  modified_camera: CameraConfig;
  summary: ExposureSummary;
  delta: {
    sensitive_exposure_reduction_percent: number;
    total_exposure_reduction_percent: number;
    route_length_increase_percent: number;
    coverage_loss_percent: number;
  };
  objective_terms: {
    privacy: number;
    route_length: number;
    smoothness: number;
    altitude: number;
    gimbal: number;
    task: number;
    objective: number;
  };
  explanation: string;
};

export type PlanningResponse = {
  baseline_summary: ExposureSummary;
  options: PlanningOption[];
};

export type PreferenceKind = 'sensitive_area' | 'do_not_capture';

export type StudyCondition = 'basic_notice' | 'camera_footprint' | 'visual_exposure';

export type StudyRole = 'participant' | 'facilitator';

export type LayerToggles = {
  buildings: boolean;
  semanticRegions: boolean;
  uav: boolean;
  frustum: boolean;
  exposure: boolean;
  preferences: boolean;
};

export type UploadParseResult = {
  route: RoutePoint[];
  sourceFormat: 'GeoJSON' | 'WKT';
};

export type AppError = {
  title: string;
  message: string;
};

export type RouteGeometry = Geometry;
