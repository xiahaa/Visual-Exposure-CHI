import sceneData from './matrixCityStudyScene.json';

export type EnuPoint = [number, number, number];
export type ScenePoint = [number, number, number];

type MatrixCityStudyScene = {
  id: string;
  coordinate_frame: string;
  tile_id: string;
  page_ids: string[];
  asset_origin_enu_m: EnuPoint;
  asset_bounds_enu_m: [number, number, number, number];
  safe_flight_bounds_enu_m: [number, number, number, number];
  target: {
    facade_center_enu_m: EnuPoint;
    facade_normal_enu: EnuPoint;
    facade_width_m: number;
    facade_height_m: number;
    resident_feet_enu_m: EnuPoint;
    resident_eye_height_m: number;
  };
  camera: {
    hfov_deg: number;
    image_width_px: number;
    image_height_px: number;
    min_depth_m: number;
    max_depth_m: number;
  };
  trajectories: Record<'slow_offset' | 'fast_tracking' | 'warmup_calibration', {
    start_enu_m: EnuPoint;
    end_enu_m: EnuPoint;
    camera_target_start_enu_m: EnuPoint;
    camera_target_end_enu_m: EnuPoint;
  }>;
};

export const MATRIX_CITY_STUDY_SCENE = sceneData as MatrixCityStudyScene;

/** Converts MatrixCity East/North/Up metres into Three.js X/Y/Z metres. */
export function enuToScene(point: EnuPoint): ScenePoint {
  const origin = MATRIX_CITY_STUDY_SCENE.asset_origin_enu_m;
  const east = point[0] - origin[0];
  const north = point[1] - origin[1];
  const up = point[2] - origin[2];
  return [east, up, -north];
}

/** Converts Three.js X/Y/Z metres back into MatrixCity East/North/Up. */
export function sceneToEnu(point: ScenePoint): EnuPoint {
  const origin = MATRIX_CITY_STUDY_SCENE.asset_origin_enu_m;
  return [
    point[0] + origin[0],
    -point[2] + origin[1],
    point[1] + origin[2],
  ];
}

/** Direction conversion excludes translation and preserves metric length. */
export function enuDirectionToScene(direction: EnuPoint): ScenePoint {
  return [direction[0], direction[2], -direction[1]];
}

export const MATRIX_CITY_FACADE_CENTER = enuToScene(
  MATRIX_CITY_STUDY_SCENE.target.facade_center_enu_m,
);
export const MATRIX_CITY_FACADE_NORMAL = enuDirectionToScene(
  MATRIX_CITY_STUDY_SCENE.target.facade_normal_enu,
);
export const MATRIX_CITY_RESIDENT_FEET = enuToScene(
  MATRIX_CITY_STUDY_SCENE.target.resident_feet_enu_m,
);
