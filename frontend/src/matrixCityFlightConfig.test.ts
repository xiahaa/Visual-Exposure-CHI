import { describe, expect, it } from 'vitest';
import {
  createDefaultMatrixCityFlightConfig,
  decodeMatrixCityFlightConfig,
  encodeMatrixCityFlightConfig,
  matrixCityFlightConfigSchema,
  verticalFovDegrees,
} from './matrixCityFlightConfig';

describe('MatrixCity flight configuration', () => {
  it('round-trips a validated configuration through a URL parameter', () => {
    const config = createDefaultMatrixCityFlightConfig('fast_tracking');
    expect(decodeMatrixCityFlightConfig(encodeMatrixCityFlightConfig(config))).toEqual(config);
  });

  it('rejects routes outside the validated GS flight envelope', () => {
    const config = createDefaultMatrixCityFlightConfig('slow_offset');
    config.trajectory.start_enu_m[0] = 500;
    expect(() => matrixCityFlightConfigSchema.parse(config)).toThrow();
  });

  it('requires a useful route length and ordered depth range', () => {
    const config = createDefaultMatrixCityFlightConfig('slow_offset');
    config.trajectory.end_enu_m = [...config.trajectory.start_enu_m];
    config.camera.max_depth_m = config.camera.min_depth_m;
    const result = matrixCityFlightConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
        'The route must be at least 20 metres long.',
        'Maximum depth must be greater than minimum depth.',
      ]));
    }
  });

  it('derives vertical FOV from horizontal FOV and image aspect ratio', () => {
    const config = createDefaultMatrixCityFlightConfig('fast_tracking');
    expect(verticalFovDegrees(config.camera)).toBeCloseTo(41.55, 1);
  });
});
