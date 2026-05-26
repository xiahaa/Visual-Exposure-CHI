export const scenarioFixture = {
  scenario_id: 'residential_block_01',
  name: 'Residential Block Roof Inspection',
  origin: { lon: 113.93, lat: 22.54, alt: 0 },
  camera: {
    hfov_deg: 78,
    vfov_deg: 50,
    gimbal_pitch_deg: -45,
    ray_width: 80,
    ray_height: 45,
  },
  default_route: [
    { lon: 113.9297, lat: 22.5398, alt: 80, yaw: 45 },
    { lon: 113.9308, lat: 22.5407, alt: 80, yaw: 45 },
  ],
  summary: {
    task: 'Inspect residential rooftops after maintenance work.',
    notice: 'Estimated visual exposure is computed from the planned route and camera settings.',
  },
  buildings: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { building_id: 'B01', height_m: 24, semantic_type: 'residential' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [113.92985, 22.54005],
              [113.93015, 22.54005],
              [113.93015, 22.54032],
              [113.92985, 22.54032],
              [113.92985, 22.54005],
            ],
          ],
        },
      },
    ],
  },
  semantic_layers: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          surface_id: 'courtyard_01',
          surface_type: 'ground',
          semantic_type: 'residential_courtyard',
          sensitivity: 0.85,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [113.93022, 22.5402],
              [113.93048, 22.5402],
              [113.93048, 22.54045],
              [113.93022, 22.54045],
              [113.93022, 22.5402],
            ],
          ],
        },
      },
    ],
  },
};

export const exposureFixture = {
  exposure_surfaces: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          surface_id: 'courtyard_01',
          surface_type: 'ground',
          semantic_type: 'residential_courtyard',
          exposure: 42.2,
          sensitivity: 0.85,
        },
        geometry: scenarioFixture.semantic_layers.features[0].geometry,
      },
    ],
  },
  exposure_points: [
    {
      lon: 113.93035,
      lat: 22.54032,
      exposure: 42.2,
      surface_id: 'courtyard_01',
      surface_type: 'ground',
      semantic_type: 'residential_courtyard',
    },
  ],
  summary: {
    total_exposure: 128.4,
    sensitive_exposure: 42.2,
    max_exposure_area: 'residential_courtyard',
    route_length_m: 150.8,
    sampled_pose_count: 32,
    ray_count: 1280,
    estimated_task_coverage: 0.91,
    engine: 'open3d_raycasting',
    config: {
      max_range_m: 250,
      recognizability_d0_m: 80,
      route_sample_step_m: 5,
    },
  },
};

