import { z } from 'zod';

const positionSchema = z
  .array(z.number())
  .min(2)
  .max(4)
  .refine(([lon]) => lon >= -180 && lon <= 180, 'longitude must be between -180 and 180')
  .refine(([, lat]) => lat >= -90 && lat <= 90, 'latitude must be between -90 and 90');

const geometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: positionSchema }),
  z.object({ type: z.literal('LineString'), coordinates: z.array(positionSchema).min(2) }),
  z.object({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(positionSchema).min(2)).min(1) }),
  z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(positionSchema).min(4)).min(1) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(z.array(positionSchema).min(4)).min(1)).min(1) }),
]);

export const featureSchema = z.object({
  type: z.literal('Feature'),
  properties: z.record(z.string(), z.unknown()).default({}),
  geometry: geometrySchema,
});

export const featureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(featureSchema),
});

export const routePointSchema = z.object({
  lon: z.number().gte(-180).lte(180),
  lat: z.number().gte(-90).lte(90),
  alt: z.number(),
  yaw: z.number(),
});

export const cameraConfigSchema = z.object({
  hfov_deg: z.number().gt(0).lte(180),
  vfov_deg: z.number().gt(0).lte(180),
  gimbal_pitch_deg: z.number().gte(-180).lte(180),
  ray_width: z.number().int().gte(1).lte(640),
  ray_height: z.number().int().gte(1).lte(360),
});

export const scenarioSchema = z.object({
  scenario_id: z.string(),
  name: z.string(),
  origin: z.object({ lon: z.number(), lat: z.number(), alt: z.number() }),
  camera: cameraConfigSchema,
  default_route: z.array(routePointSchema).min(2),
  summary: z.object({ task: z.string(), notice: z.string() }),
  buildings: featureCollectionSchema,
  semantic_layers: featureCollectionSchema,
});

export const exposureSummarySchema = z.object({
  total_exposure: z.number(),
  sensitive_exposure: z.number(),
  max_exposure_area: z.string().nullable(),
  route_length_m: z.number(),
  sampled_pose_count: z.number().int(),
  ray_count: z.number().int(),
  estimated_task_coverage: z.number(),
  engine: z.string(),
  config: z.object({
    max_range_m: z.number(),
    recognizability_d0_m: z.number(),
    route_sample_step_m: z.number(),
  }),
});

export const exposureResponseSchema = z.object({
  exposure_surfaces: featureCollectionSchema,
  exposure_points: z.array(
    z.object({
      lon: z.number(),
      lat: z.number(),
      exposure: z.number(),
      surface_id: z.string(),
      surface_type: z.string(),
      semantic_type: z.string(),
    }),
  ),
  summary: exposureSummarySchema,
});

export const routeUploadGeoJsonSchema = z.union([
  z.object({ type: z.literal('LineString'), coordinates: z.array(positionSchema).min(2) }),
  z.object({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(positionSchema).min(2)).min(1) }),
  z.object({
    type: z.literal('Feature'),
    properties: z.record(z.string(), z.unknown()).default({}),
    geometry: z.union([
      z.object({ type: z.literal('LineString'), coordinates: z.array(positionSchema).min(2) }),
      z.object({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(positionSchema).min(2)).min(1) }),
    ]),
  }),
  z.object({
    type: z.literal('FeatureCollection'),
    features: z.array(
      z.object({
        type: z.literal('Feature'),
        properties: z.record(z.string(), z.unknown()).default({}),
        geometry: z.union([
          z.object({ type: z.literal('LineString'), coordinates: z.array(positionSchema).min(2) }),
          z.object({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(positionSchema).min(2)).min(1) }),
        ]),
      }),
    ).min(1),
  }),
]);

export type ScenarioSchema = z.infer<typeof scenarioSchema>;
export type ExposureResponseSchema = z.infer<typeof exposureResponseSchema>;

