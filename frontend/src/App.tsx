import { GeoJsonLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from 'deck.gl';
import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';
import DeckGL from '@deck.gl/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { compareExposure, computeExposure, loadScenario, optimizePlanning } from './api';
import {
  buildUserPreferences,
  createPreferencePolygon,
  preferenceCollection,
  type PreferencePolygon,
} from './preferences';
import { parseRouteFileContent } from './routeParser';
import { cameraSnapshot, createStudyLogEvent, routeSnapshot, studyLogToJsonl, type StudyLogEvent } from './studyLogger';
import type {
  AppError,
  CameraConfig,
  CameraProfile,
  CompareResponse,
  ExposureResponse,
  LayerToggles,
  PreferenceKind,
  PlanningOption,
  PlanningResponse,
  RoutePoint,
  Scenario,
  StudyCondition,
  StudyRole,
} from './types';
import type { FeatureCollection } from './utils/geojson';

const INITIAL_VIEW_STATE = {
  longitude: 113.9305,
  latitude: 22.5405,
  zoom: 16,
  pitch: 45,
  bearing: 0,
};

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const DEFAULT_LAYER_TOGGLES: LayerToggles = {
  buildings: true,
  semanticRegions: true,
  uav: true,
  frustum: true,
  exposure: true,
  preferences: true,
};

const CONDITION_LABELS: Record<StudyCondition, string> = {
  basic_notice: 'C1 Basic Notice',
  camera_footprint: 'C2 Route + Footprint',
  visual_exposure: 'C3 Visual Exposure',
};

type InteractionMode = 'inspect' | 'route' | 'preference';
type BilingualCopy = { en: string; zh: string };

const GUIDE_STEPS: Record<StudyCondition, BilingualCopy[]> = {
  basic_notice: [
    {
      en: 'Review the flight notice, route, altitude, and task purpose.',
      zh: '查看飞行通知、航线、高度和任务目的。',
    },
    {
      en: 'Use the map to understand where the UAV plans to fly.',
      zh: '通过地图了解无人机计划经过的位置。',
    },
    {
      en: 'Decide whether the basic notice gives enough information.',
      zh: '判断基础通知是否提供了足够的信息。',
    },
  ],
  camera_footprint: [
    {
      en: 'Review the route and camera footprint before computing exposure.',
      zh: '在计算暴露前查看航线和相机覆盖范围。',
    },
    {
      en: 'Choose a camera mode if you want to compare wider or focused views.',
      zh: '如需比较广角或聚焦视角，可选择不同相机模式。',
    },
    {
      en: 'Use the footprint to judge which places may enter the camera view.',
      zh: '根据相机覆盖范围判断哪些地点可能进入画面。',
    },
  ],
  visual_exposure: [
    {
      en: 'Review the prepared route before computing estimated visual exposure.',
      zh: '查看已准备好的航线，然后计算估计的视觉暴露。',
    },
    {
      en: 'Choose a camera mode, then compute estimated visual exposure.',
      zh: '选择相机模式，然后计算估计的视觉暴露。',
    },
    {
      en: 'Inspect exposed surfaces, then show preference-weighted exposure for marked concerns.',
      zh: '查看暴露面片，并用偏好加权暴露理解已标注的关注区域。',
    },
    {
      en: 'Generate and preview suggested alternatives to understand privacy-task trade-offs.',
      zh: '生成并预览建议替代方案，理解隐私与任务之间的取舍。',
    },
  ],
};

const ROUTE_TIP: BilingualCopy = {
  en: 'Upload GeoJSON/WKT, or create a route by selecting waypoints manually.',
  zh: '可上传 GeoJSON/WKT，也可手动在地图上选择航点。',
};

const CAMERA_TIP: BilingualCopy = {
  en: 'Camera modes keep the interface simple; advanced parameters are optional.',
  zh: '相机模式让界面更简单；高级参数仅供需要时调整。',
};

const EXPOSURE_TIP: BilingualCopy = {
  en: 'Compute exposure after the route and camera mode are ready.',
  zh: '航线和相机模式准备好后，再计算视觉暴露。',
};

const PREFERENCE_TIP: BilingualCopy = {
  en: 'Choose a preference type, click polygon vertices, then close the polygon.',
  zh: '选择偏好类型，点击多边形顶点，然后闭合多边形。',
};

const COMPARE_TIP: BilingualCopy = {
  en: 'Preference-weighted exposure re-scores the current route using your marked concerns; it does not change the route.',
  zh: '对比结果展示用户标注的偏好如何改变敏感暴露。',
};

const PLANNING_TIP: BilingualCopy = {
  en: 'Generate suggested route, altitude, and camera alternatives for the marked privacy areas.',
  zh: '系统会为已标注的隐私区域生成航线、高度和相机替代方案。',
};

function getStudyRole(): StudyRole {
  if (typeof window === 'undefined') {
    return 'participant';
  }
  return new URLSearchParams(window.location.search).get('role') === 'facilitator'
    ? 'facilitator'
    : 'participant';
}

export function App() {
  const studyRole = getStudyRole();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [route, setRoute] = useState<RoutePoint[]>([]);
  const [camera, setCamera] = useState<CameraConfig | null>(null);
  const [exposure, setExposure] = useState<ExposureResponse | null>(null);
  const [comparison, setComparison] = useState<CompareResponse | null>(null);
  const [planning, setPlanning] = useState<PlanningResponse | null>(null);
  const [previewPlanningOptionId, setPreviewPlanningOptionId] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [uploadMessage, setUploadMessage] = useState('Default route loaded from scenario.');
  const [isScenarioLoading, setScenarioLoading] = useState(true);
  const [isComputing, setComputing] = useState(false);
  const [isComparing, setComparing] = useState(false);
  const [isOptimizing, setOptimizing] = useState(false);
  const [studyCondition, setStudyCondition] = useState<StudyCondition>('visual_exposure');
  const [layerToggles, setLayerToggles] = useState<LayerToggles>(DEFAULT_LAYER_TOGGLES);
  const [drawKind, setDrawKind] = useState<PreferenceKind>('sensitive_area');
  const [draftPolygon, setDraftPolygon] = useState<Array<[number, number]>>([]);
  const [preferencePolygons, setPreferencePolygons] = useState<PreferencePolygon[]>([]);
  const [selectedSurface, setSelectedSurface] = useState<Record<string, unknown> | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('inspect');
  const [activeCameraProfileId, setActiveCameraProfileId] = useState('custom');
  const [advancedCameraOpen, setAdvancedCameraOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(true);
  const [studyLog, setStudyLog] = useState<StudyLogEvent[]>([]);
  const canEditRoute = studyRole === 'facilitator' && studyCondition !== 'basic_notice';

  const logEvent = useCallback((event: string, payload: Record<string, unknown> = {}, summary?: Record<string, unknown>) => {
    setStudyLog((current) => [
      ...current,
      createStudyLogEvent({
        event,
        scenario_id: scenario?.scenario_id,
        condition: studyCondition,
        role: studyRole,
        camera_profile_id: activeCameraProfileId,
        option_id: typeof payload.option_id === 'string' ? payload.option_id : undefined,
        ...routeSnapshot(route),
        payload: {
          ...payload,
          camera: cameraSnapshot(camera),
        },
        summary,
      }),
    ]);
  }, [activeCameraProfileId, camera, route, scenario?.scenario_id, studyCondition, studyRole]);

  useEffect(() => {
    if (!canEditRoute && interactionMode === 'route') {
      setInteractionMode('inspect');
    }
  }, [canEditRoute, interactionMode]);

  useEffect(() => {
    let active = true;
    setScenarioLoading(true);
    loadScenario()
      .then((nextScenario) => {
        if (!active) return;
        setScenario(nextScenario);
        setRoute(nextScenario.default_route);
        setCamera(nextScenario.camera);
        setActiveCameraProfileId(nextScenario.default_camera_profile_id);
        setError(null);
      })
      .catch((reason) => {
        if (!active) return;
        setError({
          title: 'Scenario could not be loaded',
          message: reason instanceof Error ? reason.message : String(reason),
        });
      })
      .finally(() => {
        if (active) setScenarioLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleUpload = useCallback(async (file: File | null) => {
    if (!file) return;
    try {
      const content = await readFileText(file);
      const parsed = parseRouteFileContent(content, file.name);
      setRoute(parsed.route);
      setExposure(null);
      setComparison(null);
      setPlanning(null);
      setPreviewPlanningOptionId(null);
      setInteractionMode('inspect');
      setUploadMessage(`${parsed.sourceFormat} route loaded: ${parsed.route.length} waypoints.`);
      logEvent('route_upload', { source_format: parsed.sourceFormat, waypoint_count: parsed.route.length });
      setError(null);
    } catch (reason) {
      setError({
        title: 'Route upload rejected',
        message: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }, [logEvent]);

  const handleCompute = useCallback(async () => {
    if (!scenario || !camera) return;
    setComputing(true);
    try {
      const response = await computeExposure(
        scenario.scenario_id,
        route,
        camera,
        buildUserPreferences(preferencePolygons),
      );
      setExposure(response);
      setComparison(null);
      setPlanning(null);
      setPreviewPlanningOptionId(null);
      logEvent('compute_exposure', {}, response.summary);
      setError(null);
    } catch (reason) {
      setError({
        title: 'Exposure computation failed',
        message: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      setComputing(false);
    }
  }, [camera, logEvent, preferencePolygons, route, scenario]);

  const handleCompare = useCallback(async () => {
    if (!scenario || !camera) return;
    setComparing(true);
    try {
      const response = await compareExposure(
        scenario.scenario_id,
        route,
        camera,
        buildUserPreferences(preferencePolygons),
      );
      setComparison(response);
      setPlanning(null);
      setPreviewPlanningOptionId(null);
      logEvent('preference_weighted_exposure', {}, response.after);
      setError(null);
    } catch (reason) {
      setError({
        title: 'Comparison failed',
        message: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      setComparing(false);
    }
  }, [camera, logEvent, preferencePolygons, route, scenario]);

  const handleOptimizePlanning = useCallback(async () => {
    if (!scenario || !camera) return;
    setOptimizing(true);
    try {
      const response = await optimizePlanning(
        scenario.scenario_id,
        route,
        camera,
        buildUserPreferences(preferencePolygons),
      );
      setPlanning(response);
      setPreviewPlanningOptionId(response.options[0]?.id ?? null);
      setComparison(null);
      setUploadMessage(
        response.options.length > 0
          ? `Suggested alternatives generated: previewing ${response.options[0].label}.`
          : 'Suggestion generation finished, but no feasible alternative was returned.',
      );
      logEvent('generate_privacy_options', {
        option_count: response.options.length,
        first_option_id: response.options[0]?.id,
      }, response.baseline_summary);
      setError(null);
    } catch (reason) {
      setError({
        title: 'Privacy option generation failed',
        message: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      setOptimizing(false);
    }
  }, [camera, logEvent, preferencePolygons, route, scenario]);

  const applyPlanningOption = useCallback((option: PlanningOption) => {
    setRoute(option.modified_route);
    setCamera(option.modified_camera);
    setActiveCameraProfileId('custom');
    setExposure(null);
    setComparison(null);
    setPlanning(null);
    setPreviewPlanningOptionId(null);
    setUploadMessage(`Applied suggested alternative: ${option.label}. Recompute exposure to verify the final route at full fidelity.`);
    logEvent('apply_planning_option', { option_id: option.id, label: option.label, strategy: option.strategy }, option.summary);
  }, [logEvent]);

  const downloadStudyLog = useCallback(() => {
    const jsonl = studyLogToJsonl(studyLog);
    const blob = new Blob([jsonl ? `${jsonl}\n` : ''], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chi-study-log-${scenario?.scenario_id ?? 'scenario'}-${Date.now()}.jsonl`;
    link.click();
    URL.revokeObjectURL(url);
  }, [scenario?.scenario_id, studyLog]);

  const handleMapClick = useCallback((info: any) => {
    if (!info.coordinate) return;
    const [lon, lat] = info.coordinate;

    if (interactionMode === 'route') {
      setRoute((current) => appendManualWaypoint(current, lon, lat, defaultRouteAltitude(current, scenario)));
      setExposure(null);
      setComparison(null);
      setPlanning(null);
      setPreviewPlanningOptionId(null);
      logEvent('manual_route_add_waypoint', { lon, lat });
      setUploadMessage('Manual route in progress. Click the map to add more waypoints, then finish the route.');
      return;
    }

    if (interactionMode === 'preference' && studyCondition === 'visual_exposure') {
      setDraftPolygon((current) => [...current, [lon, lat]]);
      setSelectedSurface(null);
      return;
    }

    if (info.object?.properties?.surface_id) {
      setSelectedSurface(info.object.properties);
      logEvent('surface_inspect', { surface_id: info.object.properties.surface_id });
      return;
    }
  }, [interactionMode, logEvent, scenario, studyCondition]);

  const closePreferencePolygon = useCallback(() => {
    try {
      const polygon = createPreferencePolygon(
        draftPolygon,
        drawKind,
        `${drawKind}_${preferencePolygons.length + 1}`,
      );
      setPreferencePolygons((current) => [...current, polygon]);
      setDraftPolygon([]);
      setInteractionMode('inspect');
      setExposure(null);
      setComparison(null);
      setPlanning(null);
      setPreviewPlanningOptionId(null);
      logEvent('preference_polygon_close', { kind: drawKind, vertex_count: draftPolygon.length });
      setError(null);
    } catch (reason) {
      setError({
        title: 'Preference polygon incomplete',
        message: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }, [draftPolygon, drawKind, logEvent, preferencePolygons.length]);

  const previewPlanningOption = planning?.options.find((option) => option.id === previewPlanningOptionId) ?? null;

  const layers = useMemo(() => {
    const effectiveToggles = togglesForCondition(studyCondition, layerToggles);
    const nextLayers = [
      new TileLayer({
        id: 'osm-tiles',
        data: OSM_TILE_URL,
        minZoom: 0,
        maxZoom: 19,
        tileSize: 256,
        renderSubLayers: (props) => {
          const { west, south, east, north } = props.tile.bbox as {
            west: number;
            south: number;
            east: number;
            north: number;
          };
          return new BitmapLayer(props, {
            data: undefined,
            image: props.data,
            bounds: [west, south, east, north],
          });
        },
      }),
    ];

    if (scenario && effectiveToggles.buildings) {
      nextLayers.push(
        new GeoJsonLayer({
          id: 'buildings',
          data: scenario.buildings,
          extruded: true,
          filled: true,
          stroked: true,
          wireframe: false,
          getElevation: (feature: any) => Number(feature.properties.height_m ?? 0),
          getFillColor: [126, 141, 150, 190],
          getLineColor: [68, 82, 91, 230],
          getLineWidth: 1,
          pickable: true,
        }) as any,
      );
    }

    if (scenario && effectiveToggles.semanticRegions) {
      nextLayers.push(
        new GeoJsonLayer({
          id: 'semantic-regions',
          data: scenario.semantic_layers,
          filled: true,
          stroked: true,
          getFillColor: [242, 184, 77, 115],
          getLineColor: [166, 99, 18, 240],
          getLineWidth: 2,
          pickable: true,
        }) as any,
      );
    }

    if (exposure && effectiveToggles.exposure) {
      const affectedBuildings = scenario ? buildAffectedBuildingCollection(scenario, exposure) : emptyFeatureCollection();
      const affectedSemanticAreas = scenario ? buildAffectedSemanticCollection(scenario, exposure) : emptyFeatureCollection();
      const affectedPoints = exposure.exposure_points.filter((point) => point.exposure > 0);
      const maxPointExposure = Math.max(1, ...affectedPoints.map((point) => point.exposure));

      nextLayers.push(
        new GeoJsonLayer({
          id: 'exposure-surfaces',
          data: exposure.exposure_surfaces,
          filled: true,
          stroked: true,
          lineWidthMinPixels: 1,
          getFillColor: (feature: any) => exposureColor(Number(feature.properties.exposure ?? 0)),
          getLineColor: [108, 32, 18, 230],
          getLineWidth: 2,
          onClick: (info: any) => {
            if (info.object?.properties) setSelectedSurface(info.object.properties);
          },
          pickable: true,
        }) as any,
      );

      if (affectedBuildings.features.length > 0) {
        nextLayers.push(
          new GeoJsonLayer({
            id: 'affected-buildings',
            data: affectedBuildings,
            extruded: true,
            filled: true,
            stroked: true,
            getElevation: (feature: any) => Number(feature.properties.height_m ?? 0) + 2,
            getFillColor: [255, 91, 48, 88],
            getLineColor: [214, 38, 20, 255],
            getLineWidth: 5,
            lineWidthMinPixels: 2,
            pickable: true,
          }) as any,
        );
      }

      if (affectedSemanticAreas.features.length > 0) {
        nextLayers.push(
          new GeoJsonLayer({
            id: 'affected-semantic-areas',
            data: affectedSemanticAreas,
            filled: true,
            stroked: true,
            getFillColor: [178, 71, 171, 105],
            getLineColor: [125, 35, 130, 255],
            getLineWidth: 5,
            lineWidthMinPixels: 2,
            pickable: true,
          }) as any,
        );
      }

      if (affectedPoints.length > 0) {
        nextLayers.push(
          new ScatterplotLayer({
            id: 'affected-exposure-halos',
            data: affectedPoints,
            getPosition: (point: { lon: number; lat: number }) => [point.lon, point.lat, 8],
            getFillColor: (point: { exposure: number }) => exposureHaloColor(point.exposure, maxPointExposure),
            getLineColor: [255, 255, 255, 230],
            getRadius: (point: { exposure: number }) => exposureHaloRadius(point.exposure, maxPointExposure),
            radiusUnits: 'pixels',
            lineWidthMinPixels: 1,
            stroked: true,
            pickable: true,
            onClick: (info: any) => {
              if (info.object) setSelectedSurface(info.object);
            },
          }) as any,
        );
      }
    }

    if (effectiveToggles.preferences && preferencePolygons.length > 0) {
      nextLayers.push(
        new GeoJsonLayer({
          id: 'user-preferences',
          data: preferenceCollection(preferencePolygons),
          filled: true,
          stroked: true,
          getFillColor: (feature: any) =>
            feature.properties.preference_kind === 'do_not_capture'
              ? [189, 45, 32, 112]
              : [139, 86, 196, 105],
          getLineColor: (feature: any) =>
            feature.properties.preference_kind === 'do_not_capture'
              ? [150, 21, 16, 255]
              : [95, 54, 158, 255],
          getLineWidth: 3,
          lineWidthMinPixels: 2,
          pickable: true,
        }) as any,
      );
    }

    if (effectiveToggles.preferences && draftPolygon.length > 0) {
      nextLayers.push(
        new PathLayer({
          id: 'draft-preference-path',
          data: [{ path: draftPolygon.map(([lon, lat]) => [lon, lat, 0]) }],
          getPath: (item: { path: number[][] }) => item.path as any,
          getColor: drawKind === 'do_not_capture' ? [180, 28, 22, 255] : [93, 56, 150, 255],
          getWidth: 4,
          widthUnits: 'pixels',
          pickable: false,
        }) as any,
        new ScatterplotLayer({
          id: 'draft-preference-vertices',
          data: draftPolygon,
          getPosition: ([lon, lat]: [number, number]) => [lon, lat, 0],
          getFillColor: drawKind === 'do_not_capture' ? [180, 28, 22, 255] : [93, 56, 150, 255],
          getRadius: 6,
          radiusUnits: 'pixels',
          pickable: false,
        }) as any,
      );
    }

    if (route.length >= 2) {
      const frustums = camera ? buildCameraFrustums(route, camera) : emptyFeatureCollection();
      const droneGlyphs = buildDroneGlyphs(route);
      const frustumRays = camera ? buildFrustumRays(route, camera) : [];
      nextLayers.push(
        ...(effectiveToggles.frustum
          ? [
        new GeoJsonLayer({
          id: 'camera-frustums',
          data: frustums,
          filled: true,
          stroked: true,
          getFillColor: [46, 144, 210, 88],
          getLineColor: [8, 81, 132, 245],
          getLineWidth: 3,
          lineWidthMinPixels: 1,
          pickable: true,
        }) as any,
        new PathLayer({
          id: 'camera-frustum-rays',
          data: frustumRays,
          getPath: (item: { path: number[][] }) => item.path as any,
          getColor: (item: { kind: string }) => (item.kind === 'center' ? [255, 196, 61, 255] : [12, 106, 170, 235]),
          getWidth: (item: { kind: string }) => (item.kind === 'center' ? 5 : 3),
          widthUnits: 'pixels',
          pickable: false,
        }) as any,
            ]
          : []),
        new PathLayer({
          id: 'route-path',
          data: [{ path: route.map((point) => [point.lon, point.lat, point.alt]) }],
          getPath: (item: { path: number[][] }) => item.path as any,
          getColor: [22, 107, 185, 255],
          getWidth: 5,
          widthUnits: 'pixels',
          pickable: true,
        }) as any,
        ...(effectiveToggles.uav
          ? [
        new PathLayer({
          id: 'uav-model-arms',
          data: droneGlyphs.armPaths,
          getPath: (item: { path: number[][] }) => item.path as any,
          getColor: [20, 31, 36, 245],
          getWidth: 3,
          widthUnits: 'pixels',
          pickable: false,
        }) as any,
        new PolygonLayer({
          id: 'uav-3d-bodies',
          data: droneGlyphs.bodyPolygons,
          getPolygon: (item: { polygon: number[][] }) => item.polygon,
          getFillColor: [245, 250, 252, 245],
          getLineColor: [7, 25, 34, 255],
          getLineWidth: 2,
          lineWidthMinPixels: 1,
          pickable: true,
        }) as any,
        new ScatterplotLayer({
          id: 'uav-rotors',
          data: droneGlyphs.rotors,
          getPosition: (item: { position: number[] }) => item.position as any,
          getFillColor: [255, 255, 255, 230],
          getLineColor: [8, 40, 55, 255],
          getRadius: 9,
          radiusUnits: 'pixels',
          lineWidthMinPixels: 2,
          stroked: true,
          pickable: false,
        }) as any,
        new PathLayer({
          id: 'uav-heading-noses',
          data: droneGlyphs.nosePaths,
          getPath: (item: { path: number[][] }) => item.path as any,
          getColor: [16, 92, 154, 255],
          getWidth: 4,
          widthUnits: 'pixels',
          pickable: false,
        }) as any,
        new PathLayer({
          id: 'uav-altitude-masts',
          data: droneGlyphs.masts,
          getPath: (item: { path: number[][] }) => item.path as any,
          getColor: [30, 45, 52, 150],
          getWidth: 2,
          widthUnits: 'pixels',
          pickable: false,
        }) as any,
        new TextLayer({
          id: 'uav-altitude-labels',
          data: route,
          getPosition: (point: RoutePoint) => [point.lon, point.lat, point.alt + 8],
          getText: (point: RoutePoint, info: { index: number }) => `UAV ${info.index + 1}\n${Math.round(point.alt)}m`,
          getColor: [8, 31, 42, 255],
          getSize: 13,
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'bottom',
          background: true,
          getBackgroundColor: [255, 255, 255, 220],
          backgroundPadding: [4, 3],
          pickable: false,
        }) as any,
        new ScatterplotLayer({
          id: 'uav-bodies',
          data: route,
          getPosition: (point: RoutePoint) => [point.lon, point.lat, point.alt],
          getFillColor: [21, 93, 138, 255],
          getLineColor: [255, 255, 255, 255],
          getRadius: 7,
          radiusUnits: 'pixels',
          lineWidthMinPixels: 2,
          stroked: true,
          pickable: true,
        }) as any,
            ]
          : []),
      );
    }

    if (previewPlanningOption && previewPlanningOption.modified_route.length >= 2) {
      const previewRoute = previewPlanningOption.modified_route;
      const previewFrustums = buildCameraFrustums(previewRoute, previewPlanningOption.modified_camera);
      nextLayers.push(
        new PathLayer({
          id: 'planning-preview-route',
          data: [{ path: previewRoute.map((point) => [point.lon, point.lat, point.alt]) }],
          getPath: (item: { path: number[][] }) => item.path as any,
          getColor: [185, 54, 157, 255],
          getWidth: 7,
          widthUnits: 'pixels',
          pickable: false,
        }) as any,
      );
      if (effectiveToggles.frustum) {
        nextLayers.push(
          new GeoJsonLayer({
            id: 'planning-preview-frustums',
            data: previewFrustums,
            filled: true,
            stroked: true,
            getFillColor: [185, 54, 157, 72],
            getLineColor: [148, 35, 128, 245],
            getLineWidth: 3,
            lineWidthMinPixels: 1,
            pickable: false,
          }) as any,
        );
      }
    }

    if (route.length > 0) {
      nextLayers.push(
        new ScatterplotLayer({
          id: 'route-waypoints',
          data: route,
          getPosition: (point: RoutePoint) => [point.lon, point.lat, point.alt],
          getFillColor: interactionMode === 'route' ? [37, 166, 105, 255] : [21, 93, 138, 255],
          getLineColor: [255, 255, 255, 255],
          getRadius: interactionMode === 'route' ? 7 : 4,
          radiusUnits: 'pixels',
          lineWidthMinPixels: 2,
          stroked: true,
          pickable: true,
        }) as any,
      );
    }

    return nextLayers;
  }, [camera, draftPolygon, drawKind, exposure, interactionMode, layerToggles, preferencePolygons, previewPlanningOption, route, scenario, studyCondition]);

  return (
    <main className="app-shell">
      <DeckGL
        controller
        initialViewState={scenario ? { ...INITIAL_VIEW_STATE, longitude: scenario.origin.lon, latitude: scenario.origin.lat } : INITIAL_VIEW_STATE}
        layers={layers}
        onClick={handleMapClick}
      />

      <section className="control-panel" aria-label="Scenario controls">
        <div className="panel-header">
          <p className="eyebrow">Research Prototype</p>
          <h1>Drone Visual Exposure</h1>
        </div>

        <div className="status-block">
          <span className={isScenarioLoading ? 'status-dot loading' : 'status-dot ready'} />
          <div>
            <strong>{scenario?.name ?? 'Loading scenario'}</strong>
            <p>{scenario?.summary.task ?? 'Fetching live backend data...'}</p>
            <p className="role-note">Study role: {studyRole}</p>
          </div>
        </div>

        <StepGuide
          condition={studyCondition}
          open={guideOpen}
          onToggle={setGuideOpen}
        />

        <div className="segmented" aria-label="Study condition">
          {Object.entries(CONDITION_LABELS).map(([condition, label]) => (
            <button
              key={condition}
              className={studyCondition === condition ? 'active' : ''}
              type="button"
              onClick={() => {
                setStudyCondition(condition as StudyCondition);
                logEvent('condition_switch', { next_condition: condition });
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <button className="log-download" type="button" onClick={downloadStudyLog}>
          Download Study Log ({studyLog.length})
        </button>

        {error && (
          <div className="error-box" role="alert">
            <strong>{error.title}</strong>
            <p>{error.message}</p>
          </div>
        )}

        <p className="hint">{uploadMessage}</p>

        {canEditRoute && (
          <>
        <label className="field">
          <span>Route file</span>
          <input
            aria-label="Route file"
            type="file"
            accept=".json,.geojson,.wkt,.txt,application/geo+json,application/json,text/plain"
            onChange={(event) => void handleUpload(event.target.files?.[0] ?? null)}
          />
        </label>
        <ContextTip copy={ROUTE_TIP} />

        <div className="route-tools" aria-label="Manual route tools">
          <div className="tool-row">
            <button
              className={interactionMode === 'route' ? 'tool-button active' : 'tool-button'}
              type="button"
              onClick={() => {
                setRoute([]);
                setExposure(null);
                setComparison(null);
                setPlanning(null);
                setPreviewPlanningOptionId(null);
                setDraftPolygon([]);
                setInteractionMode('route');
                setUploadMessage('Manual route mode: click the map to place waypoints.');
                logEvent('manual_route_start');
              }}
            >
              New Manual Route
            </button>
            <button
              className="tool-button"
              type="button"
              disabled={interactionMode !== 'route'}
              onClick={() => {
                setInteractionMode('inspect');
                setUploadMessage(
                  route.length >= 2
                    ? `Manual route ready: ${route.length} waypoints.`
                    : 'Manual route needs at least two waypoints before exposure can be computed.',
                );
                logEvent('manual_route_finish', { waypoint_count: route.length });
              }}
            >
              Finish Route
            </button>
          </div>
          <div className="tool-row">
            <button
              className="tool-button"
              type="button"
              disabled={route.length === 0}
              onClick={() => {
                setRoute([]);
                setExposure(null);
                setComparison(null);
                setPlanning(null);
                setPreviewPlanningOptionId(null);
                setInteractionMode('inspect');
                setUploadMessage('Route cleared. Upload a route or create a new manual route.');
                logEvent('route_clear');
              }}
            >
              Clear Route
            </button>
            <button
              className="tool-button"
              type="button"
              disabled={!scenario}
              onClick={() => {
                setRoute(scenario?.default_route ?? []);
                setExposure(null);
                setComparison(null);
                setPlanning(null);
                setPreviewPlanningOptionId(null);
                setInteractionMode('inspect');
                setUploadMessage('Default route restored from scenario.');
                logEvent('route_restore_default');
              }}
            >
              Restore Default
            </button>
          </div>
          <p className="hint">
            {interactionMode === 'route'
              ? 'Route drawing is active. Each map click adds one UAV waypoint.'
              : 'Manual waypoint selection uses the same route model as uploaded WKT and GeoJSON files.'}
          </p>
        </div>
          </>
        )}

        {studyCondition === 'visual_exposure' && (
          <>
        <CameraProfilePicker
          profiles={scenario?.camera_profiles ?? []}
          activeProfileId={activeCameraProfileId}
          onSelect={(profile) => {
            setCamera(profile.camera);
            setActiveCameraProfileId(profile.id);
            setExposure(null);
            setComparison(null);
            setPlanning(null);
            setPreviewPlanningOptionId(null);
            logEvent('camera_profile_select', { profile_id: profile.id });
          }}
        />
        <ContextTip copy={CAMERA_TIP} />

        <details
          className="advanced-camera"
          open={advancedCameraOpen}
          onToggle={(event) => setAdvancedCameraOpen(event.currentTarget.open)}
        >
          <summary>Advanced Camera</summary>
          <p className="hint">Researcher/operator settings for reproducible raycasting runs.</p>
          <div className="camera-grid">
            <NumberField label="HFOV" value={camera?.hfov_deg ?? 0} suffix="deg" onChange={(value) => setAdvancedCameraValue(setCamera, setActiveCameraProfileId, 'hfov_deg', value)} />
            <NumberField label="VFOV" value={camera?.vfov_deg ?? 0} suffix="deg" onChange={(value) => setAdvancedCameraValue(setCamera, setActiveCameraProfileId, 'vfov_deg', value)} />
            <NumberField label="Pitch" value={camera?.gimbal_pitch_deg ?? 0} suffix="deg" onChange={(value) => setAdvancedCameraValue(setCamera, setActiveCameraProfileId, 'gimbal_pitch_deg', value)} />
            <NumberField label="Rays W" value={camera?.ray_width ?? 0} onChange={(value) => setAdvancedCameraValue(setCamera, setActiveCameraProfileId, 'ray_width', Math.round(value))} />
            <NumberField label="Rays H" value={camera?.ray_height ?? 0} onChange={(value) => setAdvancedCameraValue(setCamera, setActiveCameraProfileId, 'ray_height', Math.round(value))} />
            <NumberField label="Min Depth" value={camera?.min_depth_m ?? 0} suffix="m" onChange={(value) => setAdvancedCameraValue(setCamera, setActiveCameraProfileId, 'min_depth_m', value)} />
            <NumberField label="Max Depth" value={camera?.max_depth_m ?? 0} suffix="m" onChange={(value) => setAdvancedCameraValue(setCamera, setActiveCameraProfileId, 'max_depth_m', value)} />
          </div>
        </details>

        <div className="toggle-grid" aria-label="Layer toggles">
          {Object.keys(layerToggles).map((key) => (
            <label key={key} className="toggle-field">
              <input
                type="checkbox"
                checked={layerToggles[key as keyof LayerToggles]}
                onChange={(event) => {
                  setLayerToggles((current) => ({ ...current, [key]: event.target.checked }));
                  logEvent('layer_toggle', { layer: key, checked: event.target.checked });
                }}
              />
              <span>{toggleLabel(key as keyof LayerToggles)}</span>
            </label>
          ))}
        </div>
          </>
        )}

        {studyCondition === 'visual_exposure' && (
          <div className="preference-tools">
            <div className="tool-row">
              <button
                className={interactionMode === 'inspect' ? 'tool-button active' : 'tool-button'}
                type="button"
                onClick={() => setInteractionMode('inspect')}
              >
                Inspect
              </button>
              <button
                className={interactionMode === 'preference' && drawKind === 'sensitive_area' ? 'tool-button active' : 'tool-button'}
                type="button"
                onClick={() => {
                  setDrawKind('sensitive_area');
                  setInteractionMode('preference');
                }}
              >
                Sensitive
              </button>
              <button
                className={interactionMode === 'preference' && drawKind === 'do_not_capture' ? 'tool-button danger active' : 'tool-button danger'}
                type="button"
                onClick={() => {
                  setDrawKind('do_not_capture');
                  setInteractionMode('preference');
                }}
              >
                Do Not Capture
              </button>
            </div>
            <ContextTip copy={PREFERENCE_TIP} />
            <p className="hint">
              {interactionMode === 'preference'
                ? 'Preference drawing is active. Click the map to add polygon vertices.'
                : 'Select Sensitive or Do Not Capture before drawing privacy preferences.'}
            </p>
            <div className="tool-row">
              <button className="tool-button" type="button" disabled={draftPolygon.length < 3} onClick={closePreferencePolygon}>
                Close Polygon
              </button>
              <button className="tool-button" type="button" disabled={draftPolygon.length === 0} onClick={() => setDraftPolygon([])}>
                Clear Draft
              </button>
              <button className="tool-button" type="button" disabled={preferencePolygons.length === 0} onClick={() => {
                setPreferencePolygons([]);
                setExposure(null);
                setComparison(null);
                setPlanning(null);
                setPreviewPlanningOptionId(null);
                logEvent('preference_clear_all');
              }}>
                Clear All
              </button>
            </div>
          </div>
        )}

        {studyCondition === 'visual_exposure' && (
          <>
            <ContextTip copy={EXPOSURE_TIP} />
            <button className="primary-action" type="button" disabled={!scenario || !camera || route.length < 2 || isComputing} onClick={() => void handleCompute()}>
              {isComputing ? 'Computing...' : 'Compute Exposure'}
            </button>
            <ContextTip copy={COMPARE_TIP} />
            <button className="secondary-action" type="button" disabled={!scenario || !camera || route.length < 2 || isComparing} onClick={() => void handleCompare()}>
              {isComparing ? 'Reweighting...' : 'Show Preference-Weighted Exposure'}
            </button>
            <ContextTip copy={PLANNING_TIP} />
            {preferencePolygons.length === 0 && (
              <p className="hint">Mark at least one Sensitive or Do Not Capture area before generating privacy options.</p>
            )}
            <button
              className="primary-action planning-action"
              type="button"
              title={preferencePolygons.length === 0 ? 'Mark at least one privacy area first.' : undefined}
              disabled={!scenario || !camera || route.length < 2 || preferencePolygons.length === 0 || isOptimizing}
              onClick={() => void handleOptimizePlanning()}
            >
              {isOptimizing ? 'Generating...' : 'Generate Privacy Options'}
            </button>
            {planning && (
              <PlanningOptionsPanel
                options={planning.options}
                previewOptionId={previewPlanningOptionId}
                onPreview={(optionId) => {
                  setPreviewPlanningOptionId(optionId);
                  logEvent('preview_planning_option', { option_id: optionId });
                }}
                onApply={applyPlanningOption}
              />
            )}
          </>
        )}

        <div className="metric-row">
          <Metric label="Waypoints" value={route.length.toString()} />
          <Metric label="Buildings" value={(scenario?.buildings.features.length ?? 0).toString()} />
          <Metric label="Sensitive Areas" value={(scenario?.semantic_layers.features.length ?? 0).toString()} />
          <Metric label="Frustums" value={route.length.toString()} />
        </div>
      </section>

      {selectedSurface && (
        <section className="inspection-panel" aria-label="Surface inspection">
          <button type="button" onClick={() => setSelectedSurface(null)}>Close</button>
          <h2>Surface</h2>
          <Metric label="Surface ID" value={String(selectedSurface.surface_id ?? 'n/a')} />
          <Metric label="Semantic" value={String(selectedSurface.semantic_type ?? 'n/a')} />
          <Metric label="Exposure" value={formatNumber(Number(selectedSurface.exposure ?? 0))} />
          <Metric label="Sensitivity" value={formatNumber(Number(selectedSurface.sensitivity ?? 0))} />
          <Metric label="Visible Count" value={formatNumber(Number(selectedSurface.visible_count ?? 0))} />
        </section>
      )}

      <section className="summary-panel" aria-label="Exposure summary">
        {studyCondition !== 'visual_exposure' ? (
          <>
            <p className="summary-empty">
              {studyCondition === 'basic_notice'
                ? 'Basic notice condition: exposure computation and preference controls are hidden.'
                : 'Route + footprint condition: camera footprint is visible, but exposure scores and privacy responses are hidden.'}
            </p>
          </>
        ) : comparison ? (
          <>
            <Metric label="Before Sensitive" value={formatNumber(comparison.before.sensitive_exposure)} />
            <Metric label="After Sensitive" value={formatNumber(comparison.after.sensitive_exposure)} />
            <Metric label="Exposure Delta" value={`${formatNumber(comparison.delta.exposure_reduction_percent)}%`} />
            <Metric label="Coverage Loss" value={`${formatNumber(comparison.delta.coverage_loss_percent)}%`} />
            <Metric label="Affected Surfaces" value={affectedSurfaceCount(exposure).toString()} />
            <MeaningNote
              copy={{
                en: 'These values summarize the trade-off after applying user-marked privacy preferences.',
                zh: '这些数值概括了应用用户隐私偏好后的取舍关系。',
              }}
            />
            <p className="comparison-note">{comparison.explanation}</p>
          </>
        ) : exposure ? (
          <>
            <Metric label="Total Exposure" value={formatNumber(exposure.summary.total_exposure)} />
            <Metric label="Sensitive Exposure" value={formatNumber(exposure.summary.sensitive_exposure)} />
            <Metric label="Route Length" value={`${formatNumber(exposure.summary.route_length_m)} m`} />
            <Metric label="Task Coverage" value={`${Math.round(exposure.summary.estimated_task_coverage * 100)}%`} />
            <Metric label="Ray Count" value={formatNumber(exposure.summary.ray_count)} />
            <Metric label="Affected Buildings" value={affectedBuildingCount(scenario, exposure).toString()} />
            <Metric label="Affected Areas" value={affectedSemanticCount(scenario, exposure).toString()} />
            <MeaningNote
              copy={{
                en: 'Orange outlines and halos show buildings and areas with non-zero estimated exposure.',
                zh: '橙色轮廓和光环表示估计暴露值不为零的建筑和区域。',
              }}
            />
          </>
        ) : (
          <>
            <p className="summary-empty">Compute exposure to view backend raycasting results.</p>
            <MeaningNote
              copy={{
                en: 'Results are estimates from backend raycasting, not a final privacy judgment.',
                zh: '结果来自后端射线计算估计，并不是最终隐私判断。',
              }}
            />
          </>
        )}
      </section>
    </main>
  );
}

function appendManualWaypoint(
  current: RoutePoint[],
  lon: number,
  lat: number,
  alt: number,
): RoutePoint[] {
  const nextPoint: RoutePoint = {
    lon,
    lat,
    alt,
    yaw: current.at(-1)?.yaw ?? 0,
  };

  if (current.length === 0) {
    return [nextPoint];
  }

  const previous = current[current.length - 1];
  const yaw = bearingDegrees(previous, nextPoint);
  const updatedRoute = [...current];
  updatedRoute[updatedRoute.length - 1] = { ...previous, yaw };
  return [...updatedRoute, { ...nextPoint, yaw }];
}

function defaultRouteAltitude(current: RoutePoint[], scenario: Scenario | null): number {
  return current.at(-1)?.alt ?? scenario?.default_route[0]?.alt ?? 80;
}

function bearingDegrees(start: Pick<RoutePoint, 'lon' | 'lat'>, end: Pick<RoutePoint, 'lon' | 'lat'>): number {
  const avgLatRad = (((start.lat + end.lat) / 2) * Math.PI) / 180;
  const east = (end.lon - start.lon) * Math.cos(avgLatRad);
  const north = end.lat - start.lat;

  if (Math.abs(east) < Number.EPSILON && Math.abs(north) < Number.EPSILON) {
    return 0;
  }

  return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read route file.'));
    reader.readAsText(file);
  });
}

function NumberField({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input aria-label={label} type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
        {suffix && <small>{suffix}</small>}
      </div>
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BilingualText({ copy }: { copy: BilingualCopy }) {
  return (
    <span className="bilingual-text">
      <span>{copy.en}</span>
      <small>{copy.zh}</small>
    </span>
  );
}

function ContextTip({ copy }: { copy: BilingualCopy }) {
  return (
    <div className="context-tip">
      <BilingualText copy={copy} />
    </div>
  );
}

function StepGuide({
  condition,
  open,
  onToggle,
}: {
  condition: StudyCondition;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  return (
    <details
      className="step-guide"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary>User Guide / 使用指南</summary>
      <ol>
        {GUIDE_STEPS[condition].map((step) => (
          <li key={`${condition}-${step.en}`}>
            <BilingualText copy={step} />
          </li>
        ))}
      </ol>
    </details>
  );
}

function MeaningNote({ copy }: { copy: BilingualCopy }) {
  return (
    <div className="meaning-note">
      <strong>What This Means / 含义说明</strong>
      <BilingualText copy={copy} />
    </div>
  );
}

function PlanningOptionsPanel({
  options,
  previewOptionId,
  onPreview,
  onApply,
}: {
  options: PlanningOption[];
  previewOptionId: string | null;
  onPreview: (optionId: string) => void;
  onApply: (option: PlanningOption) => void;
}) {
  return (
    <section className="planning-options" aria-label="Planning options">
      <div className="planning-options-header">
        <strong>Suggested Alternatives</strong>
        <span>{options.length} backend-evaluated suggestions</span>
      </div>
      {options.map((option) => (
        <article key={option.id} className={previewOptionId === option.id ? 'planning-card active' : 'planning-card'}>
          <div className="planning-card-title">
            <strong>{option.label}</strong>
            <span>{option.strategy}</span>
          </div>
          <div className="planning-metrics">
            <Metric label="Sensitive Down" value={`${formatNumber(option.delta.sensitive_exposure_reduction_percent)}%`} />
            <Metric label="Total Down" value={`${formatNumber(option.delta.total_exposure_reduction_percent)}%`} />
            <Metric label="Route Up" value={`${formatNumber(option.delta.route_length_increase_percent)}%`} />
            <Metric label="Coverage Loss" value={`${formatNumber(option.delta.coverage_loss_percent)}%`} />
          </div>
          <p>{option.explanation}</p>
          <div className="tool-row">
            <button className="tool-button" type="button" onClick={() => onPreview(option.id)}>
              Preview
            </button>
            <button className="tool-button active" type="button" onClick={() => onApply(option)}>
              Apply
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

function CameraProfilePicker({
  profiles,
  activeProfileId,
  onSelect,
}: {
  profiles: CameraProfile[];
  activeProfileId: string;
  onSelect: (profile: CameraProfile) => void;
}) {
  return (
    <section className="camera-presets" aria-label="Camera presets">
      <div className="camera-presets-header">
        <span>Camera Mode</span>
        {activeProfileId === 'custom' && <strong>Custom</strong>}
      </div>
      <div className="preset-grid">
        {profiles.map((profile) => (
          <button
            key={profile.id}
            className={activeProfileId === profile.id ? 'preset-card active' : 'preset-card'}
            type="button"
            onClick={() => onSelect(profile)}
          >
            <strong>{profile.label}</strong>
            <span>{profile.description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function setAdvancedCameraValue(
  setCamera: React.Dispatch<React.SetStateAction<CameraConfig | null>>,
  setActiveCameraProfileId: React.Dispatch<React.SetStateAction<string>>,
  key: keyof CameraConfig,
  value: number,
) {
  setActiveCameraProfileId('custom');
  setCamera((current) => (current ? { ...current, [key]: value } : current));
}

function togglesForCondition(condition: StudyCondition, toggles: LayerToggles): LayerToggles {
  if (condition === 'basic_notice') {
    return {
      ...toggles,
      semanticRegions: false,
      uav: false,
      frustum: false,
      exposure: false,
      preferences: false,
    };
  }
  if (condition === 'camera_footprint') {
    return {
      ...toggles,
      semanticRegions: false,
      exposure: false,
      preferences: false,
    };
  }
  return toggles;
}

function toggleLabel(key: keyof LayerToggles): string {
  return {
    buildings: 'Buildings',
    semanticRegions: 'Semantic',
    uav: 'UAV',
    frustum: 'Frustum',
    exposure: 'Exposure',
    preferences: 'Preferences',
  }[key];
}

function affectedSurfaceCount(exposure: ExposureResponse | null): number {
  if (!exposure) return 0;
  return exposure.exposure_surfaces.features.filter((feature) =>
    String(feature.properties.semantic_type ?? '').includes('user_sensitive')
    || String(feature.properties.semantic_type ?? '').includes('do_not_capture'),
  ).length;
}

function affectedBuildingCount(scenario: Scenario | null, exposure: ExposureResponse | null): number {
  return buildAffectedBuildingCollection(scenario, exposure).features.length;
}

function affectedSemanticCount(scenario: Scenario | null, exposure: ExposureResponse | null): number {
  return buildAffectedSemanticCollection(scenario, exposure).features.length;
}

function buildAffectedBuildingCollection(
  scenario: Scenario | null,
  exposure: ExposureResponse | null,
): FeatureCollection {
  if (!scenario || !exposure) return emptyFeatureCollection();
  const exposedBuildingIds = exposedSourceIds(exposure, ['roof', 'facade']);
  return {
    type: 'FeatureCollection',
    features: scenario.buildings.features
      .filter((feature) => exposedBuildingIds.has(String(feature.properties.building_id ?? '')))
      .map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          affected_exposure: exposedBuildingIds.get(String(feature.properties.building_id ?? '')) ?? 0,
        },
      })),
  };
}

function buildAffectedSemanticCollection(
  scenario: Scenario | null,
  exposure: ExposureResponse | null,
): FeatureCollection {
  if (!scenario || !exposure) return emptyFeatureCollection();
  const exposedSemanticIds = exposedSourceIds(exposure, ['ground']);
  return {
    type: 'FeatureCollection',
    features: scenario.semantic_layers.features
      .filter((feature) => exposedSemanticIds.has(String(feature.properties.surface_id ?? '')))
      .map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          affected_exposure: exposedSemanticIds.get(String(feature.properties.surface_id ?? '')) ?? 0,
        },
      })),
  };
}

function exposedSourceIds(exposure: ExposureResponse, surfaceTypes: string[]): Map<string, number> {
  const ids = new Map<string, number>();
  for (const feature of exposure.exposure_surfaces.features) {
    const properties = feature.properties;
    const exposureValue = Number(properties.exposure ?? 0);
    const sourceId = String(properties.source_id ?? '');
    const surfaceType = String(properties.surface_type ?? '');
    if (exposureValue <= 0 || !sourceId || !surfaceTypes.includes(surfaceType)) {
      continue;
    }
    ids.set(sourceId, (ids.get(sourceId) ?? 0) + exposureValue);
  }
  return ids;
}

function buildCameraFrustums(route: RoutePoint[], camera: CameraConfig): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: route.map((pose, index) => {
      const leftYaw = pose.yaw - camera.hfov_deg / 2;
      const rightYaw = pose.yaw + camera.hfov_deg / 2;
      const shallowPitch = camera.gimbal_pitch_deg + camera.vfov_deg / 2;
      const steepPitch = camera.gimbal_pitch_deg - camera.vfov_deg / 2;
      const farLeft = projectGroundPoint(pose, leftYaw, shallowPitch, camera.max_depth_m);
      const farRight = projectGroundPoint(pose, rightYaw, shallowPitch, camera.max_depth_m);
      const nearRight = projectGroundPoint(pose, rightYaw, steepPitch, camera.max_depth_m);
      const nearLeft = projectGroundPoint(pose, leftYaw, steepPitch, camera.max_depth_m);

      return {
        type: 'Feature',
        properties: {
          pose_index: index,
          surface_type: 'camera_frustum',
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [pose.lon, pose.lat],
            [farLeft.lon, farLeft.lat],
            [farRight.lon, farRight.lat],
            [nearRight.lon, nearRight.lat],
            [nearLeft.lon, nearLeft.lat],
            [pose.lon, pose.lat],
          ]],
        },
      };
    }),
  };
}

function buildFrustumRays(route: RoutePoint[], camera: CameraConfig) {
  return route.flatMap((pose, index) => {
    const corners = frustumGroundCorners(pose, camera);
    const origin = [pose.lon, pose.lat, pose.alt];
    const center = projectGroundPoint(pose, pose.yaw, camera.gimbal_pitch_deg, camera.max_depth_m);
    return [
      ...corners.map((corner) => ({
        kind: 'edge',
        pose_index: index,
        path: [origin, [corner.lon, corner.lat, 0]],
      })),
      {
        kind: 'center',
        pose_index: index,
        path: [origin, [center.lon, center.lat, 0]],
      },
    ];
  });
}

function buildDroneGlyphs(route: RoutePoint[]) {
  const armLengthM = 28;
  const noseLengthM = 38;
  const bodyLengthM = 18;
  const bodyWidthM = 10;
  return route.reduce(
    (glyphs, pose) => {
      const forward = offsetLonLat(pose, pose.yaw, armLengthM);
      const back = offsetLonLat(pose, pose.yaw + 180, armLengthM);
      const right = offsetLonLat(pose, pose.yaw + 90, armLengthM);
      const left = offsetLonLat(pose, pose.yaw - 90, armLengthM);
      const nose = offsetLonLat(pose, pose.yaw, noseLengthM);
      const bodyNose = offsetLonLat(pose, pose.yaw, bodyLengthM);
      const bodyTail = offsetLonLat(pose, pose.yaw + 180, bodyLengthM * 0.72);
      const bodyRight = offsetLonLat(pose, pose.yaw + 90, bodyWidthM);
      const bodyLeft = offsetLonLat(pose, pose.yaw - 90, bodyWidthM);

      glyphs.armPaths.push({ path: [[forward.lon, forward.lat, pose.alt], [back.lon, back.lat, pose.alt]] });
      glyphs.armPaths.push({ path: [[right.lon, right.lat, pose.alt], [left.lon, left.lat, pose.alt]] });
      glyphs.nosePaths.push({ path: [[pose.lon, pose.lat, pose.alt], [nose.lon, nose.lat, pose.alt]] });
      glyphs.masts.push({ path: [[pose.lon, pose.lat, 0], [pose.lon, pose.lat, pose.alt]] });
      glyphs.rotors.push(
        { position: [forward.lon, forward.lat, pose.alt] },
        { position: [back.lon, back.lat, pose.alt] },
        { position: [right.lon, right.lat, pose.alt] },
        { position: [left.lon, left.lat, pose.alt] },
      );
      glyphs.bodyPolygons.push({
        polygon: [
          [bodyNose.lon, bodyNose.lat, pose.alt],
          [bodyRight.lon, bodyRight.lat, pose.alt],
          [bodyTail.lon, bodyTail.lat, pose.alt],
          [bodyLeft.lon, bodyLeft.lat, pose.alt],
        ],
      });
      return glyphs;
    },
    {
      armPaths: [] as Array<{ path: number[][] }>,
      nosePaths: [] as Array<{ path: number[][] }>,
      masts: [] as Array<{ path: number[][] }>,
      rotors: [] as Array<{ position: number[] }>,
      bodyPolygons: [] as Array<{ polygon: number[][] }>,
    },
  );
}

function frustumGroundCorners(pose: RoutePoint, camera: CameraConfig) {
  const leftYaw = pose.yaw - camera.hfov_deg / 2;
  const rightYaw = pose.yaw + camera.hfov_deg / 2;
  const shallowPitch = camera.gimbal_pitch_deg + camera.vfov_deg / 2;
  const steepPitch = camera.gimbal_pitch_deg - camera.vfov_deg / 2;
  return [
    projectGroundPoint(pose, leftYaw, shallowPitch, camera.max_depth_m),
    projectGroundPoint(pose, rightYaw, shallowPitch, camera.max_depth_m),
    projectGroundPoint(pose, rightYaw, steepPitch, camera.max_depth_m),
    projectGroundPoint(pose, leftYaw, steepPitch, camera.max_depth_m),
  ];
}

function projectGroundPoint(pose: RoutePoint, yawDeg: number, pitchDeg: number, maxDepthM?: number) {
  const downAngleDeg = Math.max(5, Math.min(88, Math.abs(pitchDeg)));
  const rawGroundDistanceM = pose.alt / Math.tan((downAngleDeg * Math.PI) / 180);
  const groundDistanceM = maxDepthM ? Math.min(rawGroundDistanceM, maxDepthM) : rawGroundDistanceM;
  return offsetLonLat(pose, yawDeg, groundDistanceM);
}

function offsetLonLat(origin: Pick<RoutePoint, 'lon' | 'lat'>, yawDeg: number, distanceM: number) {
  const yaw = (yawDeg * Math.PI) / 180;
  const eastM = Math.sin(yaw) * distanceM;
  const northM = Math.cos(yaw) * distanceM;
  const metersPerLatDeg = 111_320;
  const metersPerLonDeg = metersPerLatDeg * Math.cos((origin.lat * Math.PI) / 180);

  return {
    lon: origin.lon + eastM / metersPerLonDeg,
    lat: origin.lat + northM / metersPerLatDeg,
  };
}

function emptyFeatureCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function exposureColor(exposure: number): [number, number, number, number] {
  if (exposure <= 0) return [78, 104, 112, 45];
  if (exposure < 25) return [249, 196, 91, 120];
  if (exposure < 75) return [230, 112, 55, 155];
  return [179, 42, 31, 190];
}

function exposureHaloColor(exposure: number, maxExposure: number): [number, number, number, number] {
  const ratio = Math.max(0, Math.min(1, exposure / maxExposure));
  if (ratio > 0.65) return [214, 38, 20, 185];
  if (ratio > 0.25) return [239, 111, 45, 150];
  return [255, 191, 74, 120];
}

function exposureHaloRadius(exposure: number, maxExposure: number): number {
  const ratio = Math.sqrt(Math.max(0, Math.min(1, exposure / maxExposure)));
  return 7 + ratio * 24;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}
