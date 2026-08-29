import { describe, expect, it } from 'vitest';
import {
  enuDirectionToScene,
  enuToScene,
  MATRIX_CITY_STUDY_SCENE,
  sceneToEnu,
} from './matrixCityScene';

describe('MatrixCity study coordinates', () => {
  it('maps the exported asset origin to the Three.js scene origin', () => {
    const converted = enuToScene(MATRIX_CITY_STUDY_SCENE.asset_origin_enu_m);
    converted.forEach((value) => expect(value).toBeCloseTo(0, 8));
  });

  it('preserves metric distance while mapping ENU north to negative scene Z', () => {
    const origin = MATRIX_CITY_STUDY_SCENE.asset_origin_enu_m;
    const converted = enuToScene([
      origin[0] + 10,
      origin[1] + 5,
      origin[2] + 20,
    ]);

    expect(converted).toEqual([10, 20, -5]);
    expect(Math.hypot(...converted)).toBeCloseTo(Math.hypot(10, 5, 20), 8);
  });

  it('round-trips scene points without changing the MatrixCity coordinate basis', () => {
    const point: [number, number, number] = [238, 3720, 40];
    expect(sceneToEnu(enuToScene(point))).toEqual(point);
  });

  it('converts directions without applying the asset translation', () => {
    const converted = enuDirectionToScene([0, -1, 0]);
    expect(converted).toEqual([0, 0, 1]);
  });

  it('keeps every configured route and camera target inside the exported asset', () => {
    const [west, south, east, north] = MATRIX_CITY_STUDY_SCENE.asset_bounds_enu_m;
    const [safeWest, safeSouth, safeEast, safeNorth] =
      MATRIX_CITY_STUDY_SCENE.safe_flight_bounds_enu_m;

    for (const trajectory of Object.values(MATRIX_CITY_STUDY_SCENE.trajectories)) {
      for (const point of [trajectory.start_enu_m, trajectory.end_enu_m]) {
        expect(point[0]).toBeGreaterThanOrEqual(safeWest);
        expect(point[0]).toBeLessThanOrEqual(safeEast);
        expect(point[1]).toBeGreaterThanOrEqual(safeSouth);
        expect(point[1]).toBeLessThanOrEqual(safeNorth);
      }
      for (const point of [
        trajectory.camera_target_start_enu_m,
        trajectory.camera_target_end_enu_m,
      ]) {
        expect(point[0]).toBeGreaterThanOrEqual(west);
        expect(point[0]).toBeLessThanOrEqual(east);
        expect(point[1]).toBeGreaterThanOrEqual(south);
        expect(point[1]).toBeLessThanOrEqual(north);
      }
    }
  });

  it('uses all sixteen pages in the selected 400 metre tile', () => {
    expect(MATRIX_CITY_STUDY_SCENE.page_ids).toHaveLength(16);
    expect(MATRIX_CITY_STUDY_SCENE.asset_bounds_enu_m).toEqual([
      0,
      3500,
      400,
      3900,
    ]);
  });
});
