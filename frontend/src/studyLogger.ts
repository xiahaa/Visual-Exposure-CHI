import type { CameraConfig, ExposureSummary, RoutePoint, StudyCondition, StudyRole } from './types';

export type StudyLogEvent = {
  timestamp: string;
  event: string;
  scenario_id?: string;
  condition: StudyCondition;
  role: StudyRole;
  route_length?: number;
  route_waypoints?: number;
  camera_profile_id?: string;
  option_id?: string;
  payload?: Record<string, unknown>;
  summary?: Partial<ExposureSummary>;
};

export function createStudyLogEvent(input: Omit<StudyLogEvent, 'timestamp'>): StudyLogEvent {
  return {
    timestamp: new Date().toISOString(),
    ...input,
  };
}

export function studyLogToJsonl(events: StudyLogEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n');
}

export function routeSnapshot(route: RoutePoint[]): Pick<StudyLogEvent, 'route_length' | 'route_waypoints'> {
  return {
    route_length: approximateRouteLengthM(route),
    route_waypoints: route.length,
  };
}

export function cameraSnapshot(camera: CameraConfig | null): Record<string, unknown> {
  if (!camera) return {};
  return {
    hfov_deg: camera.hfov_deg,
    vfov_deg: camera.vfov_deg,
    gimbal_pitch_deg: camera.gimbal_pitch_deg,
    ray_width: camera.ray_width,
    ray_height: camera.ray_height,
    min_depth_m: camera.min_depth_m,
    max_depth_m: camera.max_depth_m,
  };
}

function approximateRouteLengthM(route: RoutePoint[]): number {
  let length = 0;
  for (let index = 0; index < route.length - 1; index += 1) {
    const start = route[index];
    const end = route[index + 1];
    const avgLatRad = (((start.lat + end.lat) / 2) * Math.PI) / 180;
    const eastM = (end.lon - start.lon) * 111_320 * Math.cos(avgLatRad);
    const northM = (end.lat - start.lat) * 111_320;
    const upM = end.alt - start.alt;
    length += Math.sqrt(eastM * eastM + northM * northM + upM * upM);
  }
  return Math.round(length * 100) / 100;
}
