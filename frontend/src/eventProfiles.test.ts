import { describe, expect, it } from 'vitest';
import { EVENT_PROFILES, pairedGeometryMatches, sampleEventPose } from './eventProfiles';

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
  });
});
