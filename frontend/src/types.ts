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
};

export type Scenario = {
  scenario_id: string;
  name: string;
  origin: { lon: number; lat: number; alt: number };
  camera: CameraConfig;
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

export type UploadParseResult = {
  route: RoutePoint[];
  sourceFormat: 'GeoJSON' | 'WKT';
};

export type AppError = {
  title: string;
  message: string;
};

export type RouteGeometry = Geometry;

