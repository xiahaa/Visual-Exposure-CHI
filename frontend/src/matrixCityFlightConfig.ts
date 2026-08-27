import { z } from 'zod';
import { MATRIX_CITY_STUDY_SCENE } from './matrixCityScene';

export type MatrixCityTrajectoryId = keyof typeof MATRIX_CITY_STUDY_SCENE.trajectories;

/**
 * Runtime configuration shared by the trajectory sampler, camera view,
 * frustum, and physical-clarity overlay. Coordinates use the MatrixCity ENU
 * frame in metres so a saved configuration remains independent of Three.js.
 */
export type MatrixCityFlightConfig = {
  version: 1;
  trajectory: {
    start_enu_m: [number, number, number];
    end_enu_m: [number, number, number];
    camera_target_start_enu_m: [number, number, number];
    camera_target_end_enu_m: [number, number, number];
  };
  camera: {
    hfov_deg: number;
    image_width_px: number;
    image_height_px: number;
    min_depth_m: number;
    max_depth_m: number;
  };
};

export const MATRIX_CITY_CONFIG_LIMITS = {
  drone: {
    east_m: { min: 60, max: 340, recommended: '70-330' },
    north_m: { min: 3560, max: 3840, recommended: '3570-3830' },
    altitude_m: { min: 40, max: 180, recommended: '90-140' },
  },
  target: {
    east_m: { min: 0, max: 400, recommended: '80-320' },
    north_m: { min: 3500, max: 3900, recommended: '3560-3840' },
    altitude_m: { min: 0, max: 120, recommended: '15-80' },
  },
  camera: {
    hfov_deg: { min: 30, max: 100, recommended: '55-80' },
    image_width_px: { min: 640, max: 3840, recommended: '1280-1920' },
    image_height_px: { min: 360, max: 2160, recommended: '720-1080' },
    min_depth_m: { min: 0.1, max: 25, recommended: '1-5' },
    max_depth_m: { min: 20, max: 250, recommended: '80-160' },
  },
} as const;

const finiteNumber = z.number().finite();

function pointSchema(
  east: { min: number; max: number },
  north: { min: number; max: number },
  altitude: { min: number; max: number },
) {
  return z.tuple([
    finiteNumber.min(east.min).max(east.max),
    finiteNumber.min(north.min).max(north.max),
    finiteNumber.min(altitude.min).max(altitude.max),
  ]);
}

const dronePointSchema = pointSchema(
  MATRIX_CITY_CONFIG_LIMITS.drone.east_m,
  MATRIX_CITY_CONFIG_LIMITS.drone.north_m,
  MATRIX_CITY_CONFIG_LIMITS.drone.altitude_m,
);

const cameraTargetPointSchema = pointSchema(
  MATRIX_CITY_CONFIG_LIMITS.target.east_m,
  MATRIX_CITY_CONFIG_LIMITS.target.north_m,
  MATRIX_CITY_CONFIG_LIMITS.target.altitude_m,
);

export const matrixCityFlightConfigSchema: z.ZodType<MatrixCityFlightConfig> = z.object({
  version: z.literal(1),
  trajectory: z.object({
    start_enu_m: dronePointSchema,
    end_enu_m: dronePointSchema,
    camera_target_start_enu_m: cameraTargetPointSchema,
    camera_target_end_enu_m: cameraTargetPointSchema,
  }),
  camera: z.object({
    hfov_deg: finiteNumber
      .min(MATRIX_CITY_CONFIG_LIMITS.camera.hfov_deg.min)
      .max(MATRIX_CITY_CONFIG_LIMITS.camera.hfov_deg.max),
    image_width_px: z.number().int()
      .min(MATRIX_CITY_CONFIG_LIMITS.camera.image_width_px.min)
      .max(MATRIX_CITY_CONFIG_LIMITS.camera.image_width_px.max),
    image_height_px: z.number().int()
      .min(MATRIX_CITY_CONFIG_LIMITS.camera.image_height_px.min)
      .max(MATRIX_CITY_CONFIG_LIMITS.camera.image_height_px.max),
    min_depth_m: finiteNumber
      .min(MATRIX_CITY_CONFIG_LIMITS.camera.min_depth_m.min)
      .max(MATRIX_CITY_CONFIG_LIMITS.camera.min_depth_m.max),
    max_depth_m: finiteNumber
      .min(MATRIX_CITY_CONFIG_LIMITS.camera.max_depth_m.min)
      .max(MATRIX_CITY_CONFIG_LIMITS.camera.max_depth_m.max),
  }),
}).superRefine((config, context) => {
  if (config.camera.max_depth_m <= config.camera.min_depth_m) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['camera', 'max_depth_m'],
      message: 'Maximum depth must be greater than minimum depth.',
    });
  }

  const [startEast, startNorth, startAltitude] = config.trajectory.start_enu_m;
  const [endEast, endNorth, endAltitude] = config.trajectory.end_enu_m;
  const routeLength = Math.hypot(
    endEast - startEast,
    endNorth - startNorth,
    endAltitude - startAltitude,
  );
  if (routeLength < 20) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['trajectory', 'end_enu_m'],
      message: 'The route must be at least 20 metres long.',
    });
  }
});

export function createDefaultMatrixCityFlightConfig(
  trajectoryId: MatrixCityTrajectoryId,
): MatrixCityFlightConfig {
  const trajectory = MATRIX_CITY_STUDY_SCENE.trajectories[trajectoryId];
  const camera = MATRIX_CITY_STUDY_SCENE.camera;
  return matrixCityFlightConfigSchema.parse({
    version: 1,
    trajectory: {
      start_enu_m: [...trajectory.start_enu_m],
      end_enu_m: [...trajectory.end_enu_m],
      camera_target_start_enu_m: [...trajectory.camera_target_start_enu_m],
      camera_target_end_enu_m: [...trajectory.camera_target_end_enu_m],
    },
    camera: {
      hfov_deg: camera.hfov_deg,
      image_width_px: camera.image_width_px,
      image_height_px: camera.image_height_px,
      min_depth_m: camera.min_depth_m,
      max_depth_m: camera.max_depth_m,
    },
  });
}

/** Serializes a validated config into an ASCII-safe URL parameter. */
export function encodeMatrixCityFlightConfig(config: MatrixCityFlightConfig): string {
  const validated = matrixCityFlightConfigSchema.parse(config);
  const binary = new TextEncoder().encode(JSON.stringify(validated))
    .reduce((value, byte) => value + String.fromCharCode(byte), '');
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Reads a URL parameter and rejects malformed or out-of-range configurations. */
export function decodeMatrixCityFlightConfig(value: string): MatrixCityFlightConfig {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return matrixCityFlightConfigSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}

export function verticalFovDegrees(camera: MatrixCityFlightConfig['camera']): number {
  const aspect = camera.image_width_px / camera.image_height_px;
  return 2 * Math.atan(Math.tan(camera.hfov_deg * Math.PI / 360) / aspect) * 180 / Math.PI;
}
