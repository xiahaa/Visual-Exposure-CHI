export type EventProfileId = 'A' | 'B' | 'C' | 'D';
export type DisclosureCondition = 'M' | 'S' | 'V';
export type ExposureLevel = 'low' | 'high';
export type DataPractice = 'extended' | 'restricted';
export type UavAppearance = 'civil' | 'police';

export type EventProfile = {
  id: EventProfileId;
  code: 'L-E' | 'L-R' | 'H-E' | 'H-R';
  exposureLevel: ExposureLevel;
  dataPractice: DataPractice;
  uavAppearance: UavAppearance;
  trajectoryId: 'slow_offset' | 'fast_tracking';
  durationSeconds: number;
  title: { en: string; zh: string };
  description: { en: string; zh: string };
};

export type EventPose = {
  time: number;
  progress: number;
  drone: [number, number, number];
  cameraTarget: [number, number, number];
  residentVisible: boolean;
  exposure: number;
  distanceToBalconyM: number;
  gimbalPitchDeg: number;
};

export const EVENT_DURATION_SECONDS = 24;
export const TARGET_BALCONY = { x: 0, y: 35.5, z: 0 } as const;

export const EVENT_PROFILES: Record<EventProfileId, EventProfile> = {
  A: {
    id: 'A',
    code: 'L-E',
    exposureLevel: 'low',
    dataPractice: 'extended',
    uavAppearance: 'civil',
    trajectoryId: 'slow_offset',
    durationSeconds: EVENT_DURATION_SECONDS,
    title: { en: 'Slow offset flight', zh: '慢速偏离飞行' },
    description: {
      en: 'An unmarked UAV passes near the balcony while its camera points away.',
      zh: '一架无明显标记的无人机从阳台附近经过，相机持续朝向阳台外侧。',
    },
  },
  B: {
    id: 'B',
    code: 'L-R',
    exposureLevel: 'low',
    dataPractice: 'restricted',
    uavAppearance: 'police',
    trajectoryId: 'slow_offset',
    durationSeconds: EVENT_DURATION_SECONDS,
    title: { en: 'Slow offset flight', zh: '慢速偏离飞行' },
    description: {
      en: 'A police-marked UAV follows the same path and camera motion as profile A.',
      zh: '一架带警用特征的无人机采用与档案 A 完全相同的航线和相机运动。',
    },
  },
  C: {
    id: 'C',
    code: 'H-E',
    exposureLevel: 'high',
    dataPractice: 'extended',
    uavAppearance: 'civil',
    trajectoryId: 'fast_tracking',
    durationSeconds: EVENT_DURATION_SECONDS,
    title: { en: 'Distant tracking flight', zh: '远距跟踪飞行' },
    description: {
      en: 'An unmarked UAV passes at distance while its camera tracks the target balcony.',
      zh: '一架无明显标记的无人机在远处掠过，相机持续跟踪目标阳台。',
    },
  },
  D: {
    id: 'D',
    code: 'H-R',
    exposureLevel: 'high',
    dataPractice: 'restricted',
    uavAppearance: 'police',
    trajectoryId: 'fast_tracking',
    durationSeconds: EVENT_DURATION_SECONDS,
    title: { en: 'Distant tracking flight', zh: '远距跟踪飞行' },
    description: {
      en: 'A police-marked UAV follows the same path and camera motion as profile C.',
      zh: '一架带警用特征的无人机采用与档案 C 完全相同的航线和相机运动。',
    },
  },
};

export function readEventProfile(value: string | null): EventProfile {
  const normalized = value?.toUpperCase() as EventProfileId | undefined;
  return EVENT_PROFILES[normalized && normalized in EVENT_PROFILES ? normalized : 'A'];
}

export function readDisclosureCondition(value: string | null): DisclosureCondition {
  const normalized = value?.toUpperCase();
  return normalized === 'M' || normalized === 'S' || normalized === 'V' ? normalized : 'V';
}

/**
 * Returns a deterministic camera pose for one event time. Paired profiles use
 * the same trajectory ID, so appearance and data-practice manipulations cannot
 * accidentally change flight geometry.
 */
export function sampleEventPose(profile: EventProfile, time: number): EventPose {
  const progress = clamp(time / profile.durationSeconds);
  if (profile.trajectoryId === 'slow_offset') {
    const x = lerp(-23, 23, easeInOut(progress));
    const y = TARGET_BALCONY.y + 7.5 + Math.sin(progress * Math.PI) * 0.8;
    const z = 13.5;
    // The camera points across the street toward the opposite facade. This is
    // still well away from the resident, but produces an intelligible UAV
    // first-person image instead of an empty sky/ground frame.
    const cameraTarget: [number, number, number] = [12, 27, 75];
    const cameraDistance = Math.hypot(
      cameraTarget[0] - x,
      cameraTarget[2] - z,
    );
    return {
      time,
      progress,
      drone: [x, y, z],
      cameraTarget,
      residentVisible: false,
      exposure: 0,
      distanceToBalconyM: distance3([x, y, z], [TARGET_BALCONY.x, TARGET_BALCONY.y, TARGET_BALCONY.z]),
      gimbalPitchDeg: -Math.atan2(y - cameraTarget[1], cameraDistance) * 180 / Math.PI,
    };
  }

  const x = lerp(-72, 72, easeInOut(progress));
  const y = TARGET_BALCONY.y + 10 + Math.sin(progress * Math.PI) * 1.2;
  // Keep the high-exposure pass 30% farther from the target facade than the
  // previous 40 m implementation while preserving target tracking.
  const z = 52;
  const inViewWeight = smoothWindow(progress, 0.24, 0.34, 0.68, 0.78);
  const cameraTarget: [number, number, number] = [
    TARGET_BALCONY.x,
    TARGET_BALCONY.y + 0.5,
    TARGET_BALCONY.z,
  ];
  const horizontalDistance = Math.hypot(x - TARGET_BALCONY.x, z - TARGET_BALCONY.z);
  return {
    time,
    progress,
    drone: [x, y, z],
    cameraTarget,
    residentVisible: inViewWeight > 0.35,
    exposure: inViewWeight,
    distanceToBalconyM: distance3([x, y, z], [TARGET_BALCONY.x, TARGET_BALCONY.y, TARGET_BALCONY.z]),
    gimbalPitchDeg: -Math.atan2(y - TARGET_BALCONY.y, horizontalDistance) * 180 / Math.PI,
  };
}

export function pairedGeometryMatches(first: EventProfileId, second: EventProfileId): boolean {
  const left = EVENT_PROFILES[first];
  const right = EVENT_PROFILES[second];
  if (left.trajectoryId !== right.trajectoryId) return false;
  for (let index = 0; index <= 24; index += 1) {
    const time = index * (EVENT_DURATION_SECONDS / 24);
    const a = sampleEventPose(left, time);
    const b = sampleEventPose(right, time);
    if (JSON.stringify(a.drone) !== JSON.stringify(b.drone)) return false;
    if (JSON.stringify(a.cameraTarget) !== JSON.stringify(b.cameraTarget)) return false;
  }
  return true;
}

function easeInOut(value: number) {
  return value < 0.5 ? 2 * value * value : 1 - ((-2 * value + 2) ** 2) / 2;
}

function smoothWindow(value: number, riseStart: number, riseEnd: number, fallStart: number, fallEnd: number) {
  return smoothstep(riseStart, riseEnd, value) * (1 - smoothstep(fallStart, fallEnd, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const normalized = clamp((value - edge0) / (edge1 - edge0));
  return normalized * normalized * (3 - 2 * normalized);
}

function distance3(a: [number, number, number], b: [number, number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function lerp(start: number, end: number, value: number) {
  return start + (end - start) * value;
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}
