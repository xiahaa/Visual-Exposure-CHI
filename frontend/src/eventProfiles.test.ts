import { describe, expect, it } from 'vitest';
import { EVENT_PROFILES, pairedGeometryMatches, sampleEventPose } from './eventProfiles';
import { enuToScene, MATRIX_CITY_STUDY_SCENE } from './matrixCityScene';

describe('event profiles', () => {
  it('keeps paired flight geometries identical', () => {
    expect(pairedGeometryMatches('A', 'B')).toBe(true);
    expect(pairedGeometryMatches('C', 'D')).toBe(true);
  });

  it('keeps the resident outside the low-exposure camera view', () => {
    for (let time = 0; time <= 24; time += 1) {
      const pose = sampleEventPose(EVENT_PROFILES.A, time);
      expect(pose.residentVisible).toBe(false);
      expect(pose.exposure).toBe(0);
    }
  });

  it('places the resident in view during the middle of a high-exposure event', () => {
    const middle = sampleEventPose(EVENT_PROFILES.C, 12);
    expect(middle.residentVisible).toBe(true);
    expect(middle.exposure).toBeGreaterThan(0.9);
    expect(middle.gimbalPitchDeg).toBeLessThan(-55);
  });

  it('keeps both MatrixCity trajectories in a high-oblique aerial camera envelope', () => {
    expect(sampleEventPose(EVENT_PROFILES.A, 12).gimbalPitchDeg).toBeLessThan(-48);
    expect(sampleEventPose(EVENT_PROFILES.C, 12).gimbalPitchDeg).toBeLessThan(-55);
  });

  it('uses the configured MatrixCity trajectory endpoints without calibration offsets', () => {
    for (const profile of [EVENT_PROFILES.A, EVENT_PROFILES.C]) {
      const trajectory = MATRIX_CITY_STUDY_SCENE.trajectories[profile.trajectoryId];
      const start = sampleEventPose(profile, 0);
      const end = sampleEventPose(profile, profile.durationSeconds);
      expect(start.drone).toEqual(enuToScene(trajectory.start_enu_m));
      expect(end.drone).toEqual(enuToScene(trajectory.end_enu_m));
      expect(start.cameraTarget).toEqual(enuToScene(trajectory.camera_target_start_enu_m));
      expect(end.cameraTarget).toEqual(enuToScene(trajectory.camera_target_end_enu_m));
    }
  });

  it('animates camera position and viewing direction across an extended route', () => {
    for (const profile of [EVENT_PROFILES.A, EVENT_PROFILES.C]) {
      const start = sampleEventPose(profile, 0);
      const end = sampleEventPose(profile, profile.durationSeconds);
      expect(Math.hypot(
        end.drone[0] - start.drone[0],
        end.drone[2] - start.drone[2],
      )).toBeGreaterThan(350);
      const startAim = start.cameraTarget.map((value, index) => value - start.drone[index]);
      const endAim = end.cameraTarget.map((value, index) => value - end.drone[index]);
      expect(endAim).not.toEqual(startAim);
    }
  });
});
