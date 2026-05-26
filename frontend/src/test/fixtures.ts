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
    min_depth_m: 0,
    max_depth_m: 250,
  },
  camera_profiles: [
    {
      id: 'wide_survey',
      label: 'Wide Survey',
      description: 'Wider context view for public notice and broad situational awareness.',
      camera: {
        hfov_deg: 92,
        vfov_deg: 58,
        gimbal_pitch_deg: -42,
        ray_width: 72,
        ray_height: 40,
        min_depth_m: 0,
        max_depth_m: 220,
      },
    },
    {
      id: 'inspection_balanced',
      label: 'Balanced Inspection',
      description: 'Default study camera balancing coverage, detail, and interactive speed.',
      camera: {
        hfov_deg: 78,
        vfov_deg: 50,
        gimbal_pitch_deg: -45,
        ray_width: 80,
        ray_height: 45,
        min_depth_m: 0,
        max_depth_m: 250,
      },
    },
    {
      id: 'focused_detail',
      label: 'Focused Detail',
      description: 'Narrower detail view for closer inspection with a shorter effective depth.',
      camera: {
        hfov_deg: 56,
        vfov_deg: 36,
        gimbal_pitch_deg: -50,
        ray_width: 120,
        ray_height: 68,
        min_depth_m: 5,
        max_depth_m: 140,
      },
    },
  ],
  default_camera_profile_id: 'inspection_balanced',
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
          source_id: 'courtyard_01',
        },
        geometry: scenarioFixture.semantic_layers.features[0].geometry,
      },
      {
        type: 'Feature',
        properties: {
          surface_id: 'B01_roof',
          surface_type: 'roof',
          semantic_type: 'residential',
          exposure: 18.6,
          sensitivity: 0.45,
          source_id: 'B01',
        },
        geometry: scenarioFixture.buildings.features[0].geometry,
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
    {
      lon: 113.93,
      lat: 22.54018,
      exposure: 18.6,
      surface_id: 'B01_roof',
      surface_type: 'roof',
      semantic_type: 'residential',
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
      min_range_m: 0,
      max_range_m: 250,
      recognizability_d0_m: 80,
      route_sample_step_m: 5,
    },
  },
};

export const compareFixture = {
  before: exposureFixture.summary,
  after: {
    ...exposureFixture.summary,
    total_exposure: 150,
    sensitive_exposure: 55,
  },
  delta: {
    exposure_reduction_percent: -30.33,
    route_length_increase_percent: 0,
    coverage_loss_percent: 0,
  },
  explanation: 'The modified condition increases estimated sensitive visual exposure based on first-hit raycasting.',
};

export const planningFixture = {
  baseline_summary: exposureFixture.summary,
  options: [
    {
      id: 'privacy_combo',
      label: 'Privacy-first',
      strategy: 'combined',
      modified_route: [
        { lon: 113.92965, lat: 22.53975, alt: 96, yaw: 38 },
        { lon: 113.93088, lat: 22.54082, alt: 98, yaw: 38 },
      ],
      modified_camera: {
        hfov_deg: 78,
        vfov_deg: 50,
        gimbal_pitch_deg: -68,
        ray_width: 80,
        ray_height: 45,
        min_depth_m: 0,
        max_depth_m: 162.5,
      },
      summary: {
        ...exposureFixture.summary,
        total_exposure: 80,
        sensitive_exposure: 20,
        route_length_m: 168,
        estimated_task_coverage: 0.86,
      },
      delta: {
        sensitive_exposure_reduction_percent: 52.61,
        total_exposure_reduction_percent: 37.69,
        route_length_increase_percent: 11.41,
        coverage_loss_percent: 5.49,
      },
      objective_terms: {
        privacy: 20,
        route_length: 17.2,
        smoothness: 0,
        altitude: 17,
        gimbal: 23,
        task: 0.86,
        objective: -12.4,
      },
      explanation: 'Combines route offset, altitude increase, and camera adjustment for a stronger privacy response.',
    },
    {
      id: 'balanced_combo',
      label: 'Balanced',
      strategy: 'combined',
      modified_route: [
        { lon: 113.92968, lat: 22.53978, alt: 88, yaw: 40 },
        { lon: 113.93084, lat: 22.54076, alt: 90, yaw: 40 },
      ],
      modified_camera: {
        hfov_deg: 78,
        vfov_deg: 50,
        gimbal_pitch_deg: -58,
        ray_width: 80,
        ray_height: 45,
        min_depth_m: 0,
        max_depth_m: 212.5,
      },
      summary: {
        ...exposureFixture.summary,
        total_exposure: 92,
        sensitive_exposure: 28,
        route_length_m: 160,
        estimated_task_coverage: 0.89,
      },
      delta: {
        sensitive_exposure_reduction_percent: 33.65,
        total_exposure_reduction_percent: 28.35,
        route_length_increase_percent: 6.1,
        coverage_loss_percent: 2.2,
      },
      objective_terms: {
        privacy: 28,
        route_length: 9.2,
        smoothness: 0,
        altitude: 9,
        gimbal: 13,
        task: 0.89,
        objective: -4.1,
      },
      explanation: 'Combines route offset, altitude increase, and camera adjustment for a stronger privacy response.',
    },
  ],
};
