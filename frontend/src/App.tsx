import { GeoJsonLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from 'deck.gl';
import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';
import DeckGL from '@deck.gl/react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  Download,
  Eye,
  FileUp,
  FlaskConical,
  Layers3,
  LockKeyhole,
  MapPin,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Route as RouteIcon,
  ScanLine,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compareExposure, computeExposure, loadScenario, optimizePlanning } from './api';
import { EvidenceViewport } from './EvidenceViewport';
import { ExposureTimeline } from './ExposureTimeline';
import { scenarioText, textFor, type LocalizedCopy } from './localization';
import {
  buildUserPreferences,
  createPreferencePolygon,
  preferenceCollection,
  type PreferencePolygon,
} from './preferences';
import { parseRouteFileContent } from './routeParser';
import { cameraSnapshot, createStudyLogEvent, routeSnapshot, studyLogToJsonl, type StudyLogEvent } from './studyLogger';
import { logStorageKey, readStudySession } from './studySession';
import type {
  AppError,
  CameraConfig,
  CameraProfile,
  CompareResponse,
  ExposureResponse,
  ExposureSummary,
  LayerToggles,
  PreferenceKind,
  PlanningOption,
  PlanningResponse,
  PoseEvidence,
  RoutePoint,
  Scenario,
  StudyCondition,
  StudyLanguage,
  StudyRole,
  StudyStepId,
} from './types';
import type { FeatureCollection } from './utils/geojson';
import { WARMUP_RESULT_STORAGE_KEY } from './warmupStorage';

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
type BilingualCopy = LocalizedCopy;
type FinalDecision = 'authorize' | 'request_revision' | 'do_not_authorize';

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
  zh: '偏好加权暴露只会按你的关注重新评分，不会改变当前航线。',
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

function getInitialStudyCondition(): StudyCondition {
  if (typeof window === 'undefined') return 'visual_exposure';
  const value = new URLSearchParams(window.location.search).get('condition');
  const aliases: Record<string, StudyCondition> = {
    c1: 'basic_notice',
    basic_notice: 'basic_notice',
    c2: 'camera_footprint',
    camera_footprint: 'camera_footprint',
    c3: 'visual_exposure',
    visual_exposure: 'visual_exposure',
  };
  return value ? aliases[value.toLowerCase()] ?? 'visual_exposure' : 'visual_exposure';
}

export function App() {
  const [session] = useState(() => readStudySession());
  const studyRole = session.role;
  const initialStudyCondition = session.condition;
  const language = session.language;
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
  const [studyCondition, setStudyCondition] = useState<StudyCondition>(initialStudyCondition);
  const [layerToggles, setLayerToggles] = useState<LayerToggles>(DEFAULT_LAYER_TOGGLES);
  const [drawKind, setDrawKind] = useState<PreferenceKind>('sensitive_area');
  const [draftPolygon, setDraftPolygon] = useState<Array<[number, number]>>([]);
  const [preferencePolygons, setPreferencePolygons] = useState<PreferencePolygon[]>([]);
  const [selectedSurface, setSelectedSurface] = useState<Record<string, unknown> | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('inspect');
  const [activeCameraProfileId, setActiveCameraProfileId] = useState('custom');
  const [advancedCameraOpen, setAdvancedCameraOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(true);
  const [activeStep, setActiveStep] = useState<StudyStepId>('briefing');
  const [furthestStepIndex, setFurthestStepIndex] = useState(0);
  const [stepStartedAt, setStepStartedAt] = useState(() => Date.now());
  const [studyLog, setStudyLog] = useState<StudyLogEvent[]>(() => restoreStudyLog(session, studyRole));
  const [appliedOption, setAppliedOption] = useState<Pick<PlanningOption, 'id' | 'label' | 'strategy' | 'summary'> | null>(null);
  const [finalDecision, setFinalDecision] = useState<FinalDecision | null>(null);
  const [decisionConfidence, setDecisionConfidence] = useState(3);
  const [decisionSubmitted, setDecisionSubmitted] = useState(false);
  const [concernsConfirmed, setConcernsConfirmed] = useState(false);
  const [noAreaConcerns, setNoAreaConcerns] = useState(false);
  const [selectedPoseIndex, setSelectedPoseIndex] = useState(0);
  const [posePlaying, setPosePlaying] = useState(false);
  const [evidenceDrawerOpen, setEvidenceDrawerOpen] = useState(true);
  const [researcherDrawerOpen, setResearcherDrawerOpen] = useState(false);
  const autoComputeStarted = useRef(false);
  const [studyStartedAt] = useState(() => Date.now());
  const canEditRoute = studyRole === 'facilitator' && studyCondition !== 'basic_notice';
  const conditionLocked = studyRole === 'participant';

  const logEvent = useCallback((event: string, payload: Record<string, unknown> = {}, summary?: Record<string, unknown>) => {
    setStudyLog((current) => [
      ...current,
      createStudyLogEvent({
        event,
        scenario_id: scenario?.scenario_id,
        condition: studyCondition,
        role: studyRole,
        participant_id: session.participantId,
        session_id: session.sessionId,
        language,
        active_step: activeStep,
        step_elapsed_ms: Date.now() - stepStartedAt,
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
  }, [activeCameraProfileId, activeStep, camera, language, route, scenario?.scenario_id, session.participantId, session.sessionId, stepStartedAt, studyCondition, studyRole]);

  useEffect(() => {
    if (!canEditRoute && interactionMode === 'route') {
      setInteractionMode('inspect');
    }
  }, [canEditRoute, interactionMode]);

  useEffect(() => {
    let active = true;
    setScenarioLoading(true);
    loadScenario(session.scenarioId)
      .then((nextScenario) => {
        if (!active) return;
        const configuredProfile = nextScenario.camera_profiles.find(
          (profile) => profile.id === session.cameraProfileId,
        );
        setScenario(nextScenario);
        setRoute(nextScenario.default_route);
        setCamera(configuredProfile?.camera ?? nextScenario.camera);
        setActiveCameraProfileId(configuredProfile?.id ?? nextScenario.default_camera_profile_id);
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
  }, [session.cameraProfileId, session.scenarioId]);

  useEffect(() => {
    window.sessionStorage.setItem(logStorageKey(session), JSON.stringify(studyLog));
  }, [session, studyLog]);

  useEffect(() => {
    if (!posePlaying || !exposure?.pose_evidence.length) return;
    const timer = window.setInterval(() => {
      setSelectedPoseIndex((current) => {
        const next = current + 1;
        if (next >= exposure.pose_evidence.length) {
          setPosePlaying(false);
          return current;
        }
        return next;
      });
    }, 260);
    return () => window.clearInterval(timer);
  }, [exposure?.pose_evidence.length, posePlaying]);

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

  const computeResolvedExposure = useCallback(async (
    targetRoute: RoutePoint[],
    targetCamera: CameraConfig,
    eventName = 'compute_exposure',
  ) => {
    if (!scenario) return null;
    setComputing(true);
    try {
      const response = await computeExposure(
        scenario.scenario_id,
        targetRoute,
        targetCamera,
        buildUserPreferences([]),
      );
      setExposure(response);
      setComparison(null);
      setSelectedPoseIndex(indexOfPeakPose(response.pose_evidence));
      logEvent(eventName, {}, response.summary);
      setError(null);
      return response;
    } catch (reason) {
      setError({
        title: 'Exposure computation failed',
        message: reason instanceof Error ? reason.message : String(reason),
      });
      return null;
    } finally {
      setComputing(false);
    }
  }, [logEvent, scenario]);

  const handleCompute = useCallback(async () => {
    if (!camera) return;
    setPlanning(null);
    setPreviewPlanningOptionId(null);
    await computeResolvedExposure(route, camera);
  }, [camera, computeResolvedExposure, route]);

  useEffect(() => {
    if (
      studyRole !== 'participant'
      || studyCondition !== 'visual_exposure'
      || activeStep !== 'exposure'
      || exposure
      || isComputing
      || !scenario
      || !camera
      || route.length < 2
      || autoComputeStarted.current
    ) return;
    autoComputeStarted.current = true;
    void computeResolvedExposure(route, camera, 'auto_compute_exposure').then((response) => {
      if (!response) autoComputeStarted.current = false;
    });
  }, [activeStep, camera, computeResolvedExposure, exposure, isComputing, route, scenario, studyCondition, studyRole]);

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

  const applyPlanningOption = useCallback(async (option: PlanningOption) => {
    setRoute(option.modified_route);
    setCamera(option.modified_camera);
    setActiveCameraProfileId('custom');
    setAppliedOption({
      id: option.id,
      label: option.label,
      strategy: option.strategy,
      summary: option.summary,
    });
    setFinalDecision(null);
    setDecisionSubmitted(false);
    setExposure(null);
    setComparison(null);
    setPlanning(null);
    setPreviewPlanningOptionId(null);
    setUploadMessage(`Applied suggested alternative: ${option.label}. Verifying it at full camera fidelity.`);
    logEvent('apply_planning_option', { option_id: option.id, label: option.label, strategy: option.strategy }, option.summary);
    const verified = await computeResolvedExposure(
      option.modified_route,
      option.modified_camera,
      'verify_applied_option',
    );
    if (verified) {
      setUploadMessage(`Applied and verified suggested alternative: ${option.label}.`);
    }
  }, [computeResolvedExposure, logEvent]);

  const submitFinalDecision = useCallback(() => {
    if (!finalDecision) return;
    setDecisionSubmitted(true);
    logEvent('final_decision', {
      decision: finalDecision,
      confidence: decisionConfidence,
      applied_option_id: appliedOption?.id,
      elapsed_seconds: Math.round((Date.now() - studyStartedAt) / 1000),
      preference_count: preferencePolygons.length,
    }, exposure?.summary ?? appliedOption?.summary);
  }, [
    appliedOption,
    decisionConfidence,
    exposure?.summary,
    finalDecision,
    logEvent,
    preferencePolygons.length,
    studyStartedAt,
  ]);

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
      setComparison(null);
      setPlanning(null);
      setPreviewPlanningOptionId(null);
      setConcernsConfirmed(false);
      setNoAreaConcerns(false);
      setDecisionSubmitted(false);
      logEvent('preference_polygon_close', { kind: drawKind, vertex_count: draftPolygon.length });
      setError(null);
    } catch (reason) {
      setError({
        title: 'Preference polygon incomplete',
        message: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }, [draftPolygon, drawKind, logEvent, preferencePolygons.length]);

  const goToStep = useCallback((nextStep: StudyStepId) => {
    logEvent('step_complete', { step: activeStep, next_step: nextStep });
    setActiveStep(nextStep);
    const nextIndex = studyStepIds(studyCondition).indexOf(nextStep);
    if (nextIndex >= 0) setFurthestStepIndex((current) => Math.max(current, nextIndex));
    setStepStartedAt(Date.now());
    setPosePlaying(false);
  }, [activeStep, logEvent, studyCondition]);

  const prepareResponses = useCallback(async () => {
    setConcernsConfirmed(true);
    setEvidenceDrawerOpen(false);
    goToStep('options');
    logEvent('concerns_confirmed', {
      preference_count: preferencePolygons.length,
      no_area_concerns: noAreaConcerns,
    });
    if (noAreaConcerns || preferencePolygons.length === 0) return;
    await Promise.all([handleCompare(), handleOptimizePlanning()]);
  }, [goToStep, handleCompare, handleOptimizePlanning, logEvent, noAreaConcerns, preferencePolygons.length]);

  const retryResponses = useCallback(async () => {
    if (noAreaConcerns || preferencePolygons.length === 0) return;
    await Promise.all([handleCompare(), handleOptimizePlanning()]);
  }, [handleCompare, handleOptimizePlanning, noAreaConcerns, preferencePolygons.length]);

  const previewPlanningOption = planning?.options.find((option) => option.id === previewPlanningOptionId) ?? null;
  const selectedPose = exposure?.pose_evidence[selectedPoseIndex] ?? exposure?.pose_evidence[0] ?? null;

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
            opacity: 0.62,
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
          getFillColor: [102, 122, 119, 215],
          getLineColor: [55, 72, 72, 235],
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
              ? [191, 47, 39, 120]
              : [232, 157, 53, 116],
          getLineColor: (feature: any) =>
            feature.properties.preference_kind === 'do_not_capture'
              ? [150, 21, 16, 255]
              : [175, 101, 12, 255],
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
          getColor: drawKind === 'do_not_capture' ? [180, 28, 22, 255] : [210, 127, 19, 255],
          getWidth: 4,
          widthUnits: 'pixels',
          pickable: false,
        }) as any,
        new ScatterplotLayer({
          id: 'draft-preference-vertices',
          data: draftPolygon,
          getPosition: ([lon, lat]: [number, number]) => [lon, lat, 0],
          getFillColor: drawKind === 'do_not_capture' ? [180, 28, 22, 255] : [210, 127, 19, 255],
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
          getColor: [35, 132, 100, 255],
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
            getFillColor: [35, 132, 100, 72],
            getLineColor: [25, 105, 78, 245],
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

    if (selectedPose && camera && studyCondition === 'visual_exposure') {
      const poseRoutePoint: RoutePoint = {
        lon: selectedPose.lon,
        lat: selectedPose.lat,
        alt: selectedPose.alt,
        yaw: selectedPose.yaw,
      };
      const selectedFrustum = buildCameraFrustums([poseRoutePoint], camera);
      const selectedFrustumRays = buildFrustumRays([poseRoutePoint], camera);
      const poseHits = scenario && exposure
        ? buildPoseHitCollections(scenario, exposure, selectedPose)
        : null;

      if (effectiveToggles.exposure && poseHits) {
        if (poseHits.buildings.features.length > 0) {
          nextLayers.push(
            new GeoJsonLayer({
              id: 'selected-pose-hit-buildings',
              data: poseHits.buildings,
              extruded: true,
              filled: true,
              stroked: true,
              getElevation: (feature: any) => Number(feature.properties.height_m ?? 0) + 4,
              getFillColor: [255, 171, 57, 155],
              getLineColor: [255, 249, 224, 255],
              getLineWidth: 6,
              lineWidthMinPixels: 3,
              pickable: false,
            }) as any,
          );
        }
        if (poseHits.semanticAreas.features.length > 0) {
          nextLayers.push(
            new GeoJsonLayer({
              id: 'selected-pose-hit-areas',
              data: poseHits.semanticAreas,
              filled: true,
              stroked: true,
              getFillColor: [255, 183, 71, 160],
              getLineColor: [255, 249, 224, 255],
              getLineWidth: 6,
              lineWidthMinPixels: 3,
              pickable: false,
            }) as any,
          );
        }
        if (poseHits.surfaces.features.length > 0) {
          nextLayers.push(
            new GeoJsonLayer({
              id: 'selected-pose-first-hit-surfaces',
              data: poseHits.surfaces,
              filled: true,
              stroked: true,
              getFillColor: [255, 193, 79, 185],
              getLineColor: [255, 255, 255, 255],
              getLineWidth: 5,
              lineWidthMinPixels: 3,
              pickable: true,
              onClick: (info: any) => {
                if (info.object?.properties) setSelectedSurface(info.object.properties);
              },
            }) as any,
          );
        }
        if (poseHits.points.length > 0) {
          nextLayers.push(
            new ScatterplotLayer({
              id: 'selected-pose-hit-markers',
              data: poseHits.points,
              getPosition: (point: { lon: number; lat: number }) => [point.lon, point.lat, 12],
              getFillColor: [239, 96, 54, 245],
              getLineColor: [255, 255, 255, 255],
              getRadius: 10,
              radiusUnits: 'pixels',
              lineWidthMinPixels: 3,
              stroked: true,
              pickable: false,
            }) as any,
          );
        }
      }
      nextLayers.push(
        new GeoJsonLayer({
          id: 'selected-pose-frustum',
          data: selectedFrustum,
          filled: true,
          stroked: true,
          getFillColor: [24, 150, 170, 108],
          getLineColor: [7, 89, 111, 255],
          getLineWidth: 4,
          lineWidthMinPixels: 2,
          pickable: false,
        }) as any,
        new PathLayer({
          id: 'selected-pose-frustum-rays',
          data: selectedFrustumRays,
          getPath: (item: { path: number[][] }) => item.path as any,
          getColor: (item: { kind: string }) => (item.kind === 'center' ? [255, 211, 73, 255] : [16, 138, 157, 255]),
          getWidth: (item: { kind: string }) => (item.kind === 'center' ? 6 : 4),
          widthUnits: 'pixels',
          pickable: false,
        }) as any,
        new ScatterplotLayer({
          id: 'selected-pose-pulse',
          data: [selectedPose],
          getPosition: (pose: PoseEvidence) => [pose.lon, pose.lat, pose.alt + 3],
          getFillColor: [255, 255, 255, 245],
          getLineColor: [12, 122, 147, 255],
          getRadius: 13,
          radiusUnits: 'pixels',
          lineWidthMinPixels: 4,
          stroked: true,
          pickable: false,
        }) as any,
      );
    }

    return nextLayers;
  }, [camera, draftPolygon, drawKind, exposure, interactionMode, layerToggles, preferencePolygons, previewPlanningOption, route, scenario, selectedPose, studyCondition]);

  const operation = isComputing
    ? { title: uiText(language, 'Estimating visual exposure', '正在估计视觉暴露'), detail: uiText(language, 'Casting camera rays against the 3D city model.', '正在将相机射线投射到三维城市模型。') }
    : isComparing
      ? { title: uiText(language, 'Applying your concern weights', '正在应用你的关注权重'), detail: uiText(language, 'The route stays unchanged during this comparison.', '此次比较不会改变航线。') }
      : isOptimizing
        ? { title: uiText(language, 'Generating privacy options', '正在生成隐私建议方案'), detail: uiText(language, 'Evaluating deterministic route and camera alternatives.', '正在评估确定性的航线与相机替代方案。') }
        : null;
  const workflowSteps = getWorkflowSteps({
    condition: studyCondition,
    exposure,
    preferenceCount: preferencePolygons.length,
    planning,
    appliedOption,
    decisionSubmitted,
  });
  const activeExposureSummary = exposure?.summary ?? appliedOption?.summary;
  const guidedSteps = studyStepDefinitions(studyCondition, language);
  const activeStepIndex = Math.max(0, guidedSteps.findIndex((step) => step.id === activeStep));
  const currentGuidedStep = guidedSteps[activeStepIndex] ?? guidedSteps[0];
  const selectedCameraProfile = scenario?.camera_profiles.find((profile) => profile.id === activeCameraProfileId);
  const canContinueGuided = currentGuidedStep.id === 'briefing'
    ? Boolean(scenario)
    : currentGuidedStep.id === 'footprint'
      ? route.length >= 2
      : currentGuidedStep.id === 'exposure'
        ? Boolean(exposure) && !isComputing
        : currentGuidedStep.id === 'concerns'
          ? noAreaConcerns || preferencePolygons.length > 0
          : currentGuidedStep.id === 'options'
            ? noAreaConcerns || Boolean(appliedOption) || Boolean(planning && previewPlanningOptionId)
            : false;
  const useLegacyInterface = new URLSearchParams(window.location.search).get('ui') === 'legacy';

  if (!useLegacyInterface) {
    return (
      <main className={`app-shell study-workbench ${evidenceDrawerOpen && exposure ? 'with-evidence' : ''}`}>
        <DeckGL
          controller
          initialViewState={scenario ? { ...INITIAL_VIEW_STATE, longitude: scenario.origin.lon, latitude: scenario.origin.lat } : INITIAL_VIEW_STATE}
          layers={layers}
          onClick={handleMapClick}
        />

        <header className="session-bar">
          <div className="session-brand">
            <span><FlaskConical size={17} /></span>
            <div><strong>{uiText(language, 'Visual Exposure Lab', '视觉暴露实验台')}</strong><small>{scenario ? scenarioText(scenario, language, 'name') : uiText(language, 'Loading scenario', '正在加载场景')}</small></div>
          </div>
          <nav className="session-progress" aria-label={uiText(language, 'Study progress', '研究进度')}>
            {guidedSteps.map((step, index) => (
              <button
                key={step.id}
                className={index === activeStepIndex ? 'current' : index < activeStepIndex || index <= furthestStepIndex ? 'available' : ''}
                type="button"
                disabled={index > furthestStepIndex || index === activeStepIndex}
                onClick={() => {
                  setActiveStep(step.id);
                  setStepStartedAt(Date.now());
                  logEvent('step_return', { step: step.id });
                }}
                aria-label={`${index + 1}. ${step.label}`}
              >
                <span>{index < activeStepIndex ? <Check size={13} /> : index + 1}</span>
                <small>{step.shortLabel}</small>
              </button>
            ))}
          </nav>
          <div className="session-meta">
            <span className={isScenarioLoading ? 'session-health loading' : 'session-health'}>{isScenarioLoading ? uiText(language, 'Loading', '加载中') : uiText(language, 'Live engine', '实时引擎')}</span>
            <span>{session.participantId}</span>
            {studyRole === 'facilitator' && <button className="session-icon-button" type="button" title="Researcher controls" aria-label="Researcher controls" onClick={() => setResearcherDrawerOpen((value) => !value)}><Settings2 size={17} /></button>}
            {exposure && studyCondition === 'visual_exposure' && <button className="session-icon-button" type="button" title={uiText(language, 'Toggle evidence view', '切换证据视图')} aria-label={uiText(language, 'Toggle evidence view', '切换证据视图')} onClick={() => setEvidenceDrawerOpen((value) => !value)}>{evidenceDrawerOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</button>}
          </div>
        </header>

        <aside className="task-dock" aria-label={uiText(language, 'Current study task', '当前研究任务')}>
          <div className="task-dock-heading">
            <span>{String(activeStepIndex + 1).padStart(2, '0')}</span>
            <div><p>{uiText(language, 'Current task', '当前任务')}</p><h1>{currentGuidedStep.label}</h1><small>{currentGuidedStep.description}</small></div>
          </div>

          <div className="task-dock-body">
            {error && <div className="v2-error" role="alert"><TriangleAlert size={17} /><div><strong>{studyRole === 'participant' ? uiText(language, 'This evidence could not be prepared', '暂时无法准备此项证据') : error.title}</strong><p>{studyRole === 'participant' ? uiText(language, 'Please retry. If the problem continues, ask the facilitator for help.', '请重试；如果问题仍然存在，请联系主持人。') : error.message}</p></div></div>}

            {currentGuidedStep.id === 'briefing' && scenario && (
              <section className="task-content briefing-task">
                <div className="task-callout"><CircleHelp size={18} /><div><strong>{uiText(language, 'Planned operation', '计划飞行任务')}</strong><p>{scenarioText(scenario, language, 'task')}</p></div></div>
                <div className="briefing-facts">
                  <div><RouteIcon size={17} /><span>{uiText(language, 'Route', '航线')}</span><strong>{route.length} {uiText(language, 'waypoints', '个航点')}</strong></div>
                  <div><MapPin size={17} /><span>{uiText(language, 'Altitude', '高度')}</span><strong>{Math.round(route[0]?.alt ?? 0)} m</strong></div>
                  <div><Camera size={17} /><span>{uiText(language, 'Camera', '相机')}</span><strong>{cameraProfileDisplayLabel(selectedCameraProfile, language)}</strong></div>
                </div>
                <div className="estimate-notice"><ShieldCheck size={17} /><p>{scenarioText(scenario, language, 'notice')}</p></div>
                <p className="method-caption">{uiText(language, 'Review the prepared flight before moving to the evidence shown for this study condition.', '请先查看准备好的飞行信息，再进入本研究条件提供的证据。')}</p>
              </section>
            )}

            {currentGuidedStep.id === 'footprint' && (
              <section className="task-content footprint-task">
                <div className="task-callout camera"><Camera size={18} /><div><strong>{uiText(language, 'Potential camera coverage', '潜在相机覆盖范围')}</strong><p>{uiText(language, 'Blue frustums show where the planned camera may point. They do not show whether a surface is actually visible.', '蓝色视锥表示计划相机可能朝向的区域，但并不说明某个表面是否实际可见。')}</p></div></div>
                <CameraCapabilitySummary profile={selectedCameraProfile} camera={camera} language={language} />
                <div className="concept-separator"><span>{uiText(language, 'Footprint', '覆盖范围')}</span><ChevronRight size={16} /><span>{uiText(language, 'Not an exposure score', '不等于暴露分数')}</span></div>
              </section>
            )}

            {currentGuidedStep.id === 'exposure' && (
              <section className="task-content exposure-task-v2">
                {isComputing && <EvidenceSkeleton language={language} />}
                {!isComputing && !exposure && (
                  <div className="task-empty-state"><ScanLine size={24} /><strong>{uiText(language, 'Exposure evidence is ready to compute', '可以开始计算暴露证据')}</strong><p>{uiText(language, 'The engine will cast camera rays against the 3D city model.', '系统将相机射线投射到三维城市模型中。')}</p><button className="v2-primary" onClick={() => void handleCompute()}><ScanLine size={16} />{error ? uiText(language, 'Retry', '重试') : uiText(language, 'Compute exposure', '计算视觉暴露')}</button></div>
                )}
                {exposure && (
                  <>
                    <div className="evidence-scoreboard">
                      <div className="primary"><span>{uiText(language, 'Estimated exposure', '估计总暴露')}</span><strong>{formatNumber(exposure.summary.total_exposure)}</strong><small>{uiText(language, 'relative geometric score', '相对几何分数')}</small></div>
                      <div><span>{uiText(language, 'Sensitive', '敏感暴露')}</span><strong>{formatNumber(exposure.summary.sensitive_exposure)}</strong></div>
                      <div><span>{uiText(language, 'Coverage', '任务覆盖')}</span><strong>{Math.round(exposure.summary.estimated_task_coverage * 100)}%</strong></div>
                    </div>
                    <div className="task-callout evidence"><Eye size={18} /><div><strong>{uiText(language, 'Inspect the evidence, not only the score', '请检查证据，而不只是分数')}</strong><p>{uiText(language, 'Use the route profile and synthetic camera view to understand where exposure is estimated.', '使用航线暴露剖面和合成相机视角，理解暴露出现的位置。')}</p></div></div>
                    <button className="v2-secondary" type="button" onClick={() => setEvidenceDrawerOpen(true)}><Eye size={16} />{uiText(language, 'Open synchronized evidence', '打开联动证据')}</button>
                  </>
                )}
              </section>
            )}

            {currentGuidedStep.id === 'concerns' && (
              <section className="task-content concerns-task">
                <p className="task-instruction">{uiText(language, 'Mark places where camera visibility would concern you, or explicitly state that you have no area concerns.', '请标记会让你担忧的相机可见区域，或者明确选择没有区域担忧。')}</p>
                <div className="preference-mode-grid">
                  <button className={interactionMode === 'preference' && drawKind === 'sensitive_area' ? 'selected sensitive' : 'sensitive'} type="button" onClick={() => { setNoAreaConcerns(false); setDrawKind('sensitive_area'); setInteractionMode('preference'); }}><ShieldAlert size={17} /><span><strong>{uiText(language, 'Sensitive', '敏感区域')}</strong><small>{uiText(language, 'Needs extra care', '需要额外关注')}</small></span></button>
                  <button className={interactionMode === 'preference' && drawKind === 'do_not_capture' ? 'selected no-capture' : 'no-capture'} type="button" onClick={() => { setNoAreaConcerns(false); setDrawKind('do_not_capture'); setInteractionMode('preference'); }}><X size={17} /><span><strong>{uiText(language, 'Do not capture', '禁止拍摄')}</strong><small>{uiText(language, 'Strong restriction', '强限制')}</small></span></button>
                </div>
                <button className={noAreaConcerns ? 'no-concern-choice selected' : 'no-concern-choice'} type="button" onClick={() => { setNoAreaConcerns(true); setPreferencePolygons([]); setDraftPolygon([]); setInteractionMode('inspect'); setPlanning(null); setComparison(null); logEvent('no_area_concerns_selected'); }}><Check size={17} /><span><strong>{uiText(language, 'No area concerns', '没有区域担忧')}</strong><small>{uiText(language, 'Continue without spatial restrictions', '不添加空间限制并继续')}</small></span></button>
                {!noAreaConcerns && (
                  <>
                    <div className="drawing-status"><span className={`drawing-dot ${interactionMode === 'preference' ? 'active' : ''}`} /><div><strong>{interactionMode === 'preference' ? uiText(language, 'Drawing active', '正在绘制') : uiText(language, 'Choose a marking type', '请选择标注类型')}</strong><small>{interactionMode === 'preference' ? uiText(language, 'Click at least three map vertices, then close the polygon.', '请在地图上点击至少三个顶点，然后闭合多边形。') : uiText(language, 'Your marks remain editable until you continue.', '继续下一步前仍可修改标注。')}</small></div></div>
                    <div className="concern-counts"><span><i className="sensitive" />{preferencePolygons.filter((polygon) => polygon.kind === 'sensitive_area').length} {uiText(language, 'sensitive', '敏感')}</span><span><i className="no-capture" />{preferencePolygons.filter((polygon) => polygon.kind === 'do_not_capture').length} {uiText(language, 'do not capture', '禁止拍摄')}</span>{draftPolygon.length > 0 && <span>{draftPolygon.length} {uiText(language, 'draft points', '个草稿点')}</span>}</div>
                    <div className="compact-actions"><button disabled={draftPolygon.length < 3} onClick={closePreferencePolygon}>{uiText(language, 'Close polygon', '闭合多边形')}</button><button disabled={!draftPolygon.length} onClick={() => setDraftPolygon([])}>{uiText(language, 'Clear draft', '清除草稿')}</button><button disabled={!preferencePolygons.length} onClick={() => { setPreferencePolygons([]); setPlanning(null); setComparison(null); setConcernsConfirmed(false); logEvent('preference_clear_all'); }}>{uiText(language, 'Clear all', '全部清除')}</button></div>
                  </>
                )}
              </section>
            )}

            {currentGuidedStep.id === 'options' && (
              <section className="task-content options-task">
                {noAreaConcerns ? (
                  <div className="task-empty-state success"><ShieldCheck size={24} /><strong>{uiText(language, 'No spatial response requested', '未请求空间响应')}</strong><p>{uiText(language, 'Your decision can use the baseline flight because you recorded no area concerns.', '由于你没有记录区域担忧，可以直接基于原计划飞行作出决定。')}</p></div>
                ) : (
                  <>
                    {(isComparing || isOptimizing) && <EvidenceSkeleton language={language} label={uiText(language, 'Evaluating suggested alternatives', '正在评估建议替代方案')} />}
                    {isComputing && appliedOption && <EvidenceSkeleton language={language} label={uiText(language, 'Verifying the applied suggestion', '正在验证已应用的建议方案')} />}
                    {!isComputing && appliedOption && exposure && (
                      <div className="task-empty-state success">
                        <ShieldCheck size={24} />
                        <strong>{uiText(language, 'Applied and verified', '已应用并完成验证')}: {planningOptionDisplayLabel(appliedOption, language)}</strong>
                        <p>{uiText(language, 'The displayed exposure now uses the full study camera fidelity.', '当前显示的暴露结果已使用完整的研究相机精度重新计算。')}</p>
                      </div>
                    )}
                    {comparison && <PreferenceWeightingEvidence comparison={comparison} />}
                    {planning && <div className="task-callout options"><Sparkles size={18} /><div><strong>{uiText(language, `${planning.options.length} raycast-evaluated suggestions`, `${planning.options.length} 个经过射线评估的建议方案`)}</strong><p>{uiText(language, 'Preview each alternative on the map. These are deterministic suggestions, not globally optimal routes.', '请在地图上预览各方案。这些是确定性建议，并非全局最优航线。')}</p></div></div>}
                    {previewPlanningOption && (
                      <div className="selected-option-explanation">
                        <strong>{planningOptionDisplayLabel(previewPlanningOption, language)}</strong>
                        <p>{planningOptionExplanation(previewPlanningOption, language)}</p>
                      </div>
                    )}
                    {!planning && !isOptimizing && !appliedOption && <button className="v2-primary" onClick={() => void retryResponses()}><Sparkles size={16} />{uiText(language, 'Try suggestion generation again', '重新生成建议替代方案')}</button>}
                  </>
                )}
              </section>
            )}

            {currentGuidedStep.id === 'decision' && (
              <GuidedDecision
                language={language}
                condition={studyCondition}
                decision={finalDecision}
                confidence={decisionConfidence}
                submitted={decisionSubmitted}
                appliedOption={appliedOption}
                disabled={studyCondition === 'visual_exposure' ? !activeExposureSummary : !scenario}
                onDecision={(value) => { setFinalDecision(value); setDecisionSubmitted(false); }}
                onConfidence={(value) => { setDecisionConfidence(value); setDecisionSubmitted(false); }}
                onSubmit={submitFinalDecision}
                onDownload={downloadStudyLog}
              />
            )}
          </div>

          {currentGuidedStep.id !== 'decision' && (
            <footer className="task-navigation">
              <button className="back" type="button" disabled={activeStepIndex === 0} onClick={() => goToStep(guidedSteps[activeStepIndex - 1].id)}><ArrowLeft size={16} />{uiText(language, 'Back', '返回')}</button>
              <button
                className="continue"
                type="button"
                disabled={!canContinueGuided || isComparing || isOptimizing}
                onClick={() => {
                  if (currentGuidedStep.id === 'concerns') void prepareResponses();
                  else goToStep(guidedSteps[activeStepIndex + 1].id);
                }}
              >
                {currentGuidedStep.id === 'concerns' ? uiText(language, 'Confirm concerns', '确认关注区域') : currentGuidedStep.id === 'options' ? uiText(language, 'Continue to decision', '进入最终决策') : uiText(language, 'Continue', '继续')}
                <ArrowRight size={16} />
              </button>
            </footer>
          )}
        </aside>

        <MapLegend
          condition={studyCondition}
          exposureVisible={Boolean(exposure && layerToggles.exposure)}
          preferencesVisible={preferencePolygons.length > 0 && layerToggles.preferences}
          previewVisible={Boolean(previewPlanningOption)}
          poseHitsVisible={Boolean(selectedPose?.top_surface_ids.length)}
          language={language}
        />

        {exposure && studyCondition === 'visual_exposure' && (
          <div className="map-metric-strip">
            <span><small>{uiText(language, 'Exposure', '总暴露')}</small><strong>{formatNumber(exposure.summary.total_exposure)}</strong></span>
            <span><small>{uiText(language, 'Sensitive', '敏感暴露')}</small><strong>{formatNumber(exposure.summary.sensitive_exposure)}</strong></span>
            <span><small>{uiText(language, 'Coverage', '覆盖率')}</small><strong>{Math.round(exposure.summary.estimated_task_coverage * 100)}%</strong></span>
          </div>
        )}

        {operation && <OperationStatus title={operation.title} detail={operation.detail} />}

        {exposure && selectedPose && studyCondition === 'visual_exposure' && evidenceDrawerOpen && (
          <aside className="evidence-drawer" aria-label={uiText(language, 'Synchronized visibility evidence', '联动可见性证据')}>
            <header><div><p>{uiText(language, 'Synchronized evidence', '联动证据')}</p><h2>{uiText(language, 'What the camera may see here', '相机在此处可能看到什么')}</h2></div><button className="session-icon-button" type="button" title={uiText(language, 'Close evidence', '关闭证据')} aria-label={uiText(language, 'Close evidence', '关闭证据')} onClick={() => setEvidenceDrawerOpen(false)}><PanelRightClose size={17} /></button></header>
            <EvidenceViewport scenario={scenario!} exposure={exposure} pose={selectedPose} language={language} />
            {selectedSurface && <SurfaceEvidenceDetail surface={selectedSurface} language={language} onClose={() => setSelectedSurface(null)} />}
            <p className="evidence-disclaimer">{uiText(language, 'First-hit rays estimate geometric visibility. They do not identify people, activities, or image content.', 'First-hit 射线只估计几何可见性，不识别人、活动或真实影像内容。')}</p>
          </aside>
        )}

        {exposure && studyCondition === 'visual_exposure' && activeStep !== 'briefing' && (
          <ExposureTimeline
            profile={exposure.pose_evidence}
            selectedIndex={selectedPoseIndex}
            playing={posePlaying}
            language={language}
            onSelect={(index) => { setSelectedPoseIndex(index); setPosePlaying(false); logEvent('pose_inspect', { pose_index: index }); }}
            onTogglePlay={() => { setPosePlaying((value) => !value); logEvent('pose_playback_toggle', { playing: !posePlaying }); }}
          />
        )}

        {activeStep === 'options' && planning && !noAreaConcerns && (
          <PlanningComparisonBar
            baseline={planning.baseline_summary}
            options={planning.options}
            previewOptionId={previewPlanningOptionId}
            language={language}
            onPreview={(optionId) => { setPreviewPlanningOptionId(optionId); logEvent('preview_planning_option', { option_id: optionId }); }}
            onApply={(option) => void applyPlanningOption(option)}
          />
        )}

        {studyRole === 'facilitator' && researcherDrawerOpen && (
          <aside className="researcher-drawer" aria-label="Researcher controls">
            <header><div><p>Facilitator only</p><h2>Research controls</h2></div><button className="session-icon-button" aria-label="Close researcher controls" title="Close researcher controls" onClick={() => setResearcherDrawerOpen(false)}><X size={17} /></button></header>
            <section><strong>Condition</strong><div className="research-condition-grid">{Object.entries(CONDITION_LABELS).map(([condition, label]) => <button key={condition} className={studyCondition === condition ? 'active' : ''} onClick={() => { const next = condition as StudyCondition; setStudyCondition(next); setActiveStep('briefing'); setFurthestStepIndex(0); setExposure(null); setComparison(null); setPlanning(null); setPreferencePolygons([]); setDecisionSubmitted(false); logEvent('condition_switch', { next_condition: next }); }}>{label}</button>)}</div></section>
            <section><strong>Fixed camera profile</strong><CameraProfilePicker profiles={scenario?.camera_profiles ?? []} activeProfileId={activeCameraProfileId} onSelect={(profile) => { setCamera(profile.camera); setActiveCameraProfileId(profile.id); setExposure(null); autoComputeStarted.current = false; logEvent('camera_profile_select', { profile_id: profile.id }); }} /></section>
            <section><strong>Route file</strong><label className="research-upload"><FileUp size={15} /><input aria-label="Route file" type="file" accept=".json,.geojson,.wkt,.txt" onChange={(event) => void handleUpload(event.target.files?.[0] ?? null)} /></label><div className="compact-actions"><button onClick={() => { setRoute([]); setInteractionMode('route'); }}>New manual route</button><button disabled={interactionMode !== 'route'} onClick={() => setInteractionMode('inspect')}>Finish route</button><button disabled={!scenario} onClick={() => setRoute(scenario?.default_route ?? [])}>Restore</button></div></section>
            <section><strong>Map layers</strong><div className="research-layer-grid">{Object.keys(layerToggles).map((key) => <label key={key}><input type="checkbox" checked={layerToggles[key as keyof LayerToggles]} onChange={(event) => setLayerToggles((current) => ({ ...current, [key]: event.target.checked }))} /><span>{toggleLabel(key as keyof LayerToggles)}</span></label>)}</div></section>
            <button className="v2-secondary" onClick={downloadStudyLog}><Download size={16} />Download study log ({studyLog.length})</button>
            <a className="legacy-link" href={`${window.location.pathname}${window.location.search}&ui=legacy`}>Open legacy debug interface</a>
          </aside>
        )}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <DeckGL
        controller
        initialViewState={scenario ? { ...INITIAL_VIEW_STATE, longitude: scenario.origin.lon, latitude: scenario.origin.lat } : INITIAL_VIEW_STATE}
        layers={layers}
        onClick={handleMapClick}
      />

      <MapLegend
        condition={studyCondition}
        exposureVisible={Boolean(exposure && layerToggles.exposure)}
        preferencesVisible={preferencePolygons.length > 0 && layerToggles.preferences}
        previewVisible={Boolean(previewPlanningOption)}
      />

      {operation && <OperationStatus title={operation.title} detail={operation.detail} />}

      <section className="control-panel" aria-label="Scenario controls">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Pre-flight privacy decision support</p>
            <h1>Visual Exposure Lab</h1>
          </div>
          <span className="prototype-badge"><FlaskConical size={13} /> Research prototype</span>
        </div>

        <div className="status-block">
          <span className={isScenarioLoading ? 'status-dot loading' : 'status-dot ready'} />
          <div>
            <strong>{scenario?.name ?? 'Loading scenario'}</strong>
            <p>{scenario?.summary.task ?? 'Fetching live backend data...'}</p>
            <div className="status-meta">
              <span className="role-note">{studyRole === 'participant' ? <LockKeyhole size={12} /> : <SlidersHorizontal size={12} />} Study role: {studyRole}</span>
              <span>{studyRole === 'facilitator' ? CONDITION_LABELS[studyCondition] : 'Study session'}</span>
            </div>
          </div>
        </div>

        {scenario && (
          <div className="notice-strip">
            <CircleHelp size={16} />
            <BilingualText copy={{
              en: scenario.summary.notice,
              zh: '该结果依据计划航线、城市几何和相机设置进行估计，实际可见性可能因环境与飞行偏差而变化。',
            }} />
          </div>
        )}

        <WorkflowRail steps={workflowSteps} />

        <StepGuide
          condition={studyCondition}
          open={guideOpen}
          onToggle={setGuideOpen}
        />

        {conditionLocked ? (
          <div className="condition-lock">
            <LockKeyhole size={15} />
            <span>Interface configured for this session / 本次研究界面已配置</span>
          </div>
        ) : (
          <div className="segmented" aria-label="Study condition">
            {Object.entries(CONDITION_LABELS).map(([condition, label]) => (
              <button
                key={condition}
                className={studyCondition === condition ? 'active' : ''}
                type="button"
                onClick={() => {
                  setStudyCondition(condition as StudyCondition);
                  setDecisionSubmitted(false);
                  logEvent('condition_switch', { next_condition: condition });
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {studyRole === 'facilitator' && (
          <button className="log-download" type="button" onClick={downloadStudyLog}>
            <Download size={15} /> Download Study Log ({studyLog.length})
          </button>
        )}

        {error && (
          <div className="error-box" role="alert">
            <strong>{error.title}</strong>
            <p>{error.message}</p>
          </div>
        )}

        <div className="system-message"><ScanLine size={15} /><span>{uploadMessage}</span></div>

        {canEditRoute && (
          <section className="workflow-section facilitator-tools">
            <SectionHeading
              icon={<RouteIcon size={17} />}
              step="Setup"
              title="Route setup"
              subtitle="Facilitator controls / 主持人设置"
            />
        <label className="field">
          <span><FileUp size={14} /> Route file</span>
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
          </section>
        )}

        {studyCondition === 'visual_exposure' && (
          <section className="workflow-section">
        <SectionHeading
          icon={<Camera size={17} />}
          step="1"
          title="Review flight and camera"
          subtitle="确认航线与相机模式"
          complete={route.length >= 2 && Boolean(camera)}
        />
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
          </section>
        )}

        {studyCondition === 'visual_exposure' && (
          <section className="workflow-section exposure-step">
            <SectionHeading
              icon={<Eye size={17} />}
              step="2"
              title="Inspect estimated exposure"
              subtitle="查看估计的视觉暴露"
              complete={Boolean(exposure)}
            />
            <ContextTip copy={EXPOSURE_TIP} />
            <button className="primary-action" type="button" disabled={!scenario || !camera || route.length < 2 || isComputing} onClick={() => void handleCompute()}>
              <ScanLine size={17} />
              {isComputing ? 'Computing...' : exposure ? 'Recompute Baseline Exposure' : 'Compute Baseline Exposure'}
            </button>
            {exposure && <ExposureEvidence summary={exposure.summary} />}
          </section>
        )}

        {studyCondition === 'visual_exposure' && (
          <section className="workflow-section preference-tools">
            <SectionHeading
              icon={<ShieldAlert size={17} />}
              step="3"
              title="Mark privacy concerns"
              subtitle="标注隐私关注区域"
              complete={preferencePolygons.length > 0}
            />
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
            <div className="preference-counts" aria-label="Preference counts">
              <span><i className="swatch sensitive" /> Sensitive {preferencePolygons.filter((item) => item.kind === 'sensitive_area').length}</span>
              <span><i className="swatch no-capture" /> Do Not Capture {preferencePolygons.filter((item) => item.kind === 'do_not_capture').length}</span>
              {draftPolygon.length > 0 && <span className="draft-count">Draft: {draftPolygon.length} vertices</span>}
            </div>
            <div className="tool-row">
              <button className="tool-button" type="button" disabled={draftPolygon.length < 3} onClick={closePreferencePolygon}>
                Close Polygon
              </button>
              <button className="tool-button" type="button" disabled={draftPolygon.length === 0} onClick={() => setDraftPolygon([])}>
                Clear Draft
              </button>
              <button className="tool-button" type="button" disabled={preferencePolygons.length === 0} onClick={() => {
                setPreferencePolygons([]);
                setComparison(null);
                setPlanning(null);
                setPreviewPlanningOptionId(null);
                setDecisionSubmitted(false);
                logEvent('preference_clear_all');
              }}>
                Clear All
              </button>
            </div>
          </section>
        )}

        {studyCondition === 'visual_exposure' && (
          <section className="workflow-section response-step">
            <SectionHeading
              icon={<Sparkles size={17} />}
              step="4"
              title="Compare system responses"
              subtitle="比较系统建议与任务取舍"
              complete={Boolean(planning || appliedOption)}
            />
            <ContextTip copy={COMPARE_TIP} />
            <button className="secondary-action" type="button" disabled={!scenario || !camera || route.length < 2 || preferencePolygons.length === 0 || isComparing} onClick={() => void handleCompare()}>
              <Layers3 size={16} />
              {isComparing ? 'Reweighting...' : 'Show Preference-Weighted Exposure'}
            </button>
            {comparison && <PreferenceWeightingEvidence comparison={comparison} />}
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
              <Sparkles size={17} /> {isOptimizing ? 'Generating...' : 'Generate Privacy Options'}
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
          </section>
        )}

        <DecisionPanel
          condition={studyCondition}
          decision={finalDecision}
          confidence={decisionConfidence}
          submitted={decisionSubmitted}
          appliedOption={appliedOption}
          disabled={studyCondition === 'visual_exposure' ? !activeExposureSummary : !scenario}
          onDecision={(value) => {
            setFinalDecision(value);
            setDecisionSubmitted(false);
          }}
          onConfidence={(value) => {
            setDecisionConfidence(value);
            setDecisionSubmitted(false);
          }}
          onSubmit={submitFinalDecision}
          onDownload={downloadStudyLog}
        />

        <div className="metric-row">
          <Metric label="Waypoints" value={route.length.toString()} />
          <Metric label="Buildings" value={(scenario?.buildings.features.length ?? 0).toString()} />
          <Metric label="Sensitive Areas" value={(scenario?.semantic_layers.features.length ?? 0).toString()} />
          <Metric label="Frustums" value={route.length.toString()} />
        </div>
      </section>

      {selectedSurface && (
        <section className="inspection-panel" aria-label="Surface inspection">
          <button className="icon-button" type="button" aria-label="Close surface inspection" title="Close" onClick={() => setSelectedSurface(null)}><X size={16} /></button>
          <p className="eyebrow">Raycast evidence</p>
          <h2>{friendlySemanticType(String(selectedSurface.semantic_type ?? 'Surface'))}</h2>
          <Metric label="Surface ID" value={String(selectedSurface.surface_id ?? 'n/a')} />
          <Metric label="Exposure" value={formatNumber(Number(selectedSurface.exposure ?? 0))} />
          <Metric label="Sensitivity" value={formatNumber(Number(selectedSurface.sensitivity ?? 0))} />
          <Metric label="Visible Count" value={formatNumber(Number(selectedSurface.visible_count ?? 0))} />
          <Metric label="Mean Distance" value={`${formatNumber(Number(selectedSurface.mean_distance_m ?? 0))} m`} />
          <p className="inspection-note">First-hit rays estimate geometric visibility. They do not identify people, activities, or actual image content.</p>
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
        ) : appliedOption && !exposure ? (
          <>
            <Metric label="Applied Suggestion" value={appliedOption.label} />
            <Metric label="Screened Exposure" value={formatNumber(appliedOption.summary.total_exposure)} />
            <Metric label="Route Length" value={`${formatNumber(appliedOption.summary.route_length_m)} m`} />
            <Metric label="Task Coverage" value={`${Math.round(appliedOption.summary.estimated_task_coverage * 100)}%`} />
            <MeaningNote copy={{
              en: 'This is the reduced-fidelity screening result. Recompute baseline exposure to verify the applied route at full camera fidelity.',
              zh: '这是低精度筛选结果。请重新计算基线暴露，以完整相机精度验证已应用的航线。',
            }} />
          </>
        ) : comparison ? (
          <>
            <Metric label="Before Sensitive" value={formatNumber(comparison.before.sensitive_exposure)} />
            <Metric label="After Sensitive" value={formatNumber(comparison.after.sensitive_exposure)} />
            <Metric label="Exposure Delta" value={`${formatNumber(comparison.delta.exposure_reduction_percent)}%`} />
            <Metric label="Coverage Loss" value={`${formatNumber(comparison.delta.coverage_loss_percent)}%`} />
            <Metric label="Marked Concerns" value={preferencePolygons.length.toString()} />
            <MeaningNote
              copy={{
                en: 'Preference weighting changes which visible surfaces count as concerning. It does not mitigate exposure or change the route.',
                zh: '偏好加权只会改变哪些可见面片被视为值得关注；它不会减少暴露，也不会改变航线。',
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

function warmupStudyLog(
  role: StudyRole,
  session?: ReturnType<typeof readStudySession>,
): StudyLogEvent[] {
  if (typeof window === 'undefined') return [];
  const serialized = window.sessionStorage.getItem(WARMUP_RESULT_STORAGE_KEY);
  if (!serialized) return [];

  try {
    const result = JSON.parse(serialized) as Record<string, unknown>;
    if (
      session
      && typeof result.session_id === 'string'
      && result.session_id !== session.sessionId
    ) return [];
    return [createStudyLogEvent({
      event: 'warmup_calibration_complete',
      condition: 'warmup',
      role,
      participant_id: session?.participantId,
      session_id: session?.sessionId,
      language: session?.language,
      payload: result,
    })];
  } catch {
    return [];
  }
}

type GuidedStep = {
  id: StudyStepId;
  label: string;
  shortLabel: string;
  description: string;
};

function studyStepIds(condition: StudyCondition): StudyStepId[] {
  if (condition === 'basic_notice') return ['briefing', 'decision'];
  if (condition === 'camera_footprint') return ['briefing', 'footprint', 'decision'];
  return ['briefing', 'exposure', 'concerns', 'options', 'decision'];
}

function studyStepDefinitions(condition: StudyCondition, language: StudyLanguage): GuidedStep[] {
  const definitions: Record<StudyStepId, GuidedStep> = {
    briefing: {
      id: 'briefing',
      label: uiText(language, 'Review the flight', '查看飞行任务'),
      shortLabel: uiText(language, 'Briefing', '任务'),
      description: uiText(language, 'Understand the prepared route, altitude, task, and camera capability.', '了解准备好的航线、高度、任务和相机能力。'),
    },
    footprint: {
      id: 'footprint',
      label: uiText(language, 'Inspect camera coverage', '查看相机覆盖范围'),
      shortLabel: uiText(language, 'Footprint', '覆盖'),
      description: uiText(language, 'Use the route and frustum to judge potential camera coverage.', '通过航线与视锥判断潜在相机覆盖范围。'),
    },
    exposure: {
      id: 'exposure',
      label: uiText(language, 'Inspect exposure evidence', '检查暴露证据'),
      shortLabel: uiText(language, 'Evidence', '证据'),
      description: uiText(language, 'Explore when and where geometric visibility is estimated.', '探索几何可见性可能出现的时间和位置。'),
    },
    concerns: {
      id: 'concerns',
      label: uiText(language, 'Express your concerns', '表达你的关注'),
      shortLabel: uiText(language, 'Concerns', '关注'),
      description: uiText(language, 'Mark sensitive or do-not-capture areas directly on the map.', '直接在地图上标记敏感区域或禁止拍摄区域。'),
    },
    options: {
      id: 'options',
      label: uiText(language, 'Review suggested responses', '查看建议响应'),
      shortLabel: uiText(language, 'Options', '方案'),
      description: uiText(language, 'Compare deterministic alternatives and their privacy-task trade-offs.', '比较确定性替代方案及其隐私与任务取舍。'),
    },
    decision: {
      id: 'decision',
      label: uiText(language, 'Make your decision', '作出最终决定'),
      shortLabel: uiText(language, 'Decision', '决定'),
      description: uiText(language, 'Record authorization and confidence based on the evidence shown.', '根据所展示的证据记录授权决定和信心。'),
    },
  };
  return studyStepIds(condition).map((id) => definitions[id]);
}

function uiText(language: StudyLanguage, en: string, zh: string): string {
  return textFor(language, { en, zh });
}

function restoreStudyLog(
  session: ReturnType<typeof readStudySession>,
  role: StudyRole,
): StudyLogEvent[] {
  try {
    const stored = window.sessionStorage.getItem(logStorageKey(session));
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed as StudyLogEvent[];
    }
  } catch {
    // Corrupt session data must not prevent the participant interface loading.
  }
  return warmupStudyLog(role, session);
}

function indexOfPeakPose(profile: PoseEvidence[]): number {
  let peakIndex = 0;
  let peakExposure = -1;
  profile.forEach((pose, index) => {
    if (pose.total_exposure > peakExposure) {
      peakExposure = pose.total_exposure;
      peakIndex = index;
    }
  });
  return peakIndex;
}

function CameraCapabilitySummary({
  profile,
  camera,
  language,
}: {
  profile?: CameraProfile;
  camera: CameraConfig | null;
  language: StudyLanguage;
}) {
  if (!camera) return null;
  return (
    <div className="camera-capability-summary">
      <div className="camera-capability-title"><span><Camera size={17} /></span><div><strong>{cameraProfileDisplayLabel(profile, language)}</strong><small>{uiText(language, 'Fixed for this study session', '本次研究会话中保持固定')}</small></div><LockKeyhole size={15} /></div>
      <div><span>{uiText(language, 'View', '视野')}</span><strong>{camera.hfov_deg >= 85 ? uiText(language, 'Wide', '广角') : camera.hfov_deg <= 60 ? uiText(language, 'Focused', '聚焦') : uiText(language, 'Balanced', '均衡')}</strong></div>
      <div><span>{uiText(language, 'Look direction', '观看方向')}</span><strong>{Math.abs(camera.gimbal_pitch_deg)}° {uiText(language, 'down', '向下')}</strong></div>
      <div><span>{uiText(language, 'Effective depth', '有效深度')}</span><strong>{Math.round(camera.max_depth_m ?? 0)} m</strong></div>
    </div>
  );
}

function EvidenceSkeleton({ language, label }: { language: StudyLanguage; label?: string }) {
  return (
    <div className="evidence-skeleton" role="status">
      <span className="skeleton-orbit"><ScanLine size={20} /></span>
      <strong>{label ?? uiText(language, 'Estimating visual exposure', '正在估计视觉暴露')}</strong>
      <p>{uiText(language, 'Casting first-hit rays against the 3D city model.', '正在将 first-hit 射线投射到三维城市模型。')}</p>
      <div><i /><i /><i /></div>
    </div>
  );
}

function SurfaceEvidenceDetail({
  surface,
  language,
  onClose,
}: {
  surface: Record<string, unknown>;
  language: StudyLanguage;
  onClose: () => void;
}) {
  return (
    <section className="surface-evidence-detail">
      <header><div><p>{uiText(language, 'Selected surface', '选中表面')}</p><h3>{friendlySemanticType(String(surface.semantic_type ?? surface.surface_type ?? 'Surface'), language)}</h3></div><button className="session-icon-button" title="Close surface detail" aria-label="Close surface detail" onClick={onClose}><X size={15} /></button></header>
      <div className="surface-evidence-grid">
        <div><span>{uiText(language, 'Exposure', '暴露')}</span><strong>{formatNumber(Number(surface.exposure ?? 0))}</strong></div>
        <div><span>{uiText(language, 'Sensitivity', '敏感度')}</span><strong>{formatNumber(Number(surface.sensitivity ?? 0))}</strong></div>
        <div><span>{uiText(language, 'Visible rays', '可见射线')}</span><strong>{formatNumber(Number(surface.visible_count ?? 0))}</strong></div>
        <div><span>{uiText(language, 'Mean distance', '平均距离')}</span><strong>{formatNumber(Number(surface.mean_distance_m ?? 0))} m</strong></div>
        <div><span>{uiText(language, 'Incidence', '入射权重')}</span><strong>{formatNumber(Number(surface.mean_incidence_angle ?? 0))}</strong></div>
        <div><span>{uiText(language, 'Surface ID', '表面 ID')}</span><strong>{String(surface.surface_id ?? 'n/a')}</strong></div>
      </div>
    </section>
  );
}

function PlanningComparisonBar({
  baseline,
  options,
  previewOptionId,
  language,
  onPreview,
  onApply,
}: {
  baseline: ExposureSummary;
  options: PlanningOption[];
  previewOptionId: string | null;
  language: StudyLanguage;
  onPreview: (optionId: string) => void;
  onApply: (option: PlanningOption) => void;
}) {
  return (
    <section className="option-comparison-bar" aria-label="Suggested alternative comparison">
      <div className="option-baseline-card">
        <p>{uiText(language, 'Current route', '当前航线')}</p>
        <strong>{uiText(language, 'Baseline', '基线')}</strong>
        <div><span>{uiText(language, 'Sensitive exposure', '敏感暴露')}</span><b>{formatNumber(baseline.sensitive_exposure)}</b></div>
        <div><span>{uiText(language, 'Coverage', '覆盖率')}</span><b>{Math.round(baseline.estimated_task_coverage * 100)}%</b></div>
      </div>
      {options.map((option) => {
        const active = option.id === previewOptionId;
        return (
          <article key={option.id} className={active ? 'option-compare-card active' : 'option-compare-card'}>
            <button className="option-preview-area" type="button" onClick={() => onPreview(option.id)}>
              <span className="option-rank">{planningOptionDisplayLabel(option, language)}</span>
              <strong>{planningStrategyDisplayLabel(option.strategy, language)}</strong>
              <div className="delta-row privacy"><span>{uiText(language, 'Sensitive exposure', '敏感暴露')}</span><i><b style={{ width: `${Math.min(100, Math.max(0, option.delta.sensitive_exposure_reduction_percent))}%` }} /></i><em>{signedPercent(option.delta.sensitive_exposure_reduction_percent, true)}</em></div>
              <div className="delta-row route"><span>{uiText(language, 'Route change', '航线变化')}</span><i><b style={{ width: `${Math.min(100, Math.abs(option.delta.route_length_increase_percent) * 2)}%` }} /></i><em>{signedPercent(option.delta.route_length_increase_percent)}</em></div>
              <div className="delta-row coverage"><span>{uiText(language, 'Coverage loss', '覆盖损失')}</span><i><b style={{ width: `${Math.min(100, Math.abs(option.delta.coverage_loss_percent) * 3)}%` }} /></i><em>{signedPercent(option.delta.coverage_loss_percent)}</em></div>
            </button>
            <footer><span>{active ? <><Eye size={13} />{uiText(language, 'Previewing', '正在预览')}</> : uiText(language, 'Select to preview', '选择以预览')}</span><button type="button" onClick={() => onApply(option)}>{uiText(language, 'Apply', '应用')}<ArrowRight size={14} /></button></footer>
          </article>
        );
      })}
    </section>
  );
}

function GuidedDecision({
  language,
  condition,
  decision,
  confidence,
  submitted,
  appliedOption,
  disabled,
  onDecision,
  onConfidence,
  onSubmit,
  onDownload,
}: {
  language: StudyLanguage;
  condition: StudyCondition;
  decision: FinalDecision | null;
  confidence: number;
  submitted: boolean;
  appliedOption: Pick<PlanningOption, 'id' | 'label' | 'strategy' | 'summary'> | null;
  disabled: boolean;
  onDecision: (decision: FinalDecision) => void;
  onConfidence: (confidence: number) => void;
  onSubmit: () => void;
  onDownload: () => void;
}) {
  const choices: Array<{ value: FinalDecision; en: string; zh: string; detailEn: string; detailZh: string }> = [
    { value: 'authorize', en: 'Authorize as shown', zh: '按当前方案授权', detailEn: 'The flight may proceed.', detailZh: '允许此次飞行继续。' },
    { value: 'request_revision', en: 'Request a revision', zh: '要求修改方案', detailEn: 'Change the notice, route, or camera plan.', detailZh: '修改通知、航线或相机方案。' },
    { value: 'do_not_authorize', en: 'Do not authorize', zh: '不予授权', detailEn: 'The flight should not proceed as shown.', detailZh: '不应按当前方案飞行。' },
  ];
  return (
    <section className="guided-decision">
      {appliedOption && <div className="applied-suggestion-note"><Check size={16} /><span><strong>{uiText(language, 'Applied suggestion', '已应用建议')}</strong><small>{planningOptionDisplayLabel(appliedOption, language)}</small></span></div>}
      <fieldset disabled={disabled || submitted}>
        <legend>{uiText(language, 'Based on the information shown, what would you choose?', '根据所展示的信息，你会如何选择？')}</legend>
        <div className="guided-decision-choices">
          {choices.map((choice) => <label key={choice.value} className={decision === choice.value ? 'selected' : ''}><input type="radio" name="guided-decision" checked={decision === choice.value} onChange={() => onDecision(choice.value)} /><span><strong>{uiText(language, choice.en, choice.zh)}</strong><small>{uiText(language, choice.detailEn, choice.detailZh)}</small></span></label>)}
        </div>
      </fieldset>
      <fieldset className="guided-confidence" disabled={disabled || submitted}>
        <legend>{uiText(language, 'How confident are you?', '你有多确定？')}</legend>
        <div>{[1, 2, 3, 4, 5].map((value) => <button key={value} className={confidence === value ? 'active' : ''} onClick={() => onConfidence(value)} aria-label={`${uiText(language, 'Decision confidence', '决定信心')} ${value}`}>{value}</button>)}</div>
        <p><span>{uiText(language, 'Not certain', '不确定')}</span><span>{uiText(language, 'Very certain', '非常确定')}</span></p>
      </fieldset>
      {!submitted ? <button className="v2-primary decision-submit-v2" disabled={disabled || !decision} onClick={onSubmit}><Check size={16} />{uiText(language, 'Record final decision', '记录最终决定')}</button> : <div className="decision-finished"><Check size={20} /><div><strong>{uiText(language, 'Decision recorded', '决定已记录')}</strong><p>{uiText(language, `This ${condition === 'visual_exposure' ? 'evidence-informed ' : ''}response is ready for study analysis.`, '该回答已可用于研究分析。')}</p></div><button className="session-icon-button" title={uiText(language, 'Download study log', '下载研究日志')} aria-label={uiText(language, 'Download study log', '下载研究日志')} onClick={onDownload}><Download size={16} /></button></div>}
    </section>
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

type WorkflowStep = {
  id: string;
  label: string;
  complete: boolean;
  current: boolean;
};

function getWorkflowSteps({
  condition,
  exposure,
  preferenceCount,
  planning,
  appliedOption,
  decisionSubmitted,
}: {
  condition: StudyCondition;
  exposure: ExposureResponse | null;
  preferenceCount: number;
  planning: PlanningResponse | null;
  appliedOption: Pick<PlanningOption, 'id'> | null;
  decisionSubmitted: boolean;
}): WorkflowStep[] {
  if (condition !== 'visual_exposure') {
    return [
      { id: 'review', label: 'Review notice', complete: true, current: !decisionSubmitted },
      { id: 'decide', label: 'Record decision', complete: decisionSubmitted, current: decisionSubmitted },
    ];
  }

  const states = [
    { id: 'review', label: 'Flight setup', complete: true },
    { id: 'exposure', label: 'Exposure', complete: Boolean(exposure) },
    { id: 'preference', label: 'Concerns', complete: preferenceCount > 0 },
    { id: 'options', label: 'Options', complete: Boolean(planning || appliedOption) },
    { id: 'decision', label: 'Decision', complete: decisionSubmitted },
  ];
  const firstIncomplete = states.findIndex((step) => !step.complete);
  return states.map((step, index) => ({
    ...step,
    current: firstIncomplete === -1 ? index === states.length - 1 : index === firstIncomplete,
  }));
}

function WorkflowRail({ steps }: { steps: WorkflowStep[] }) {
  return (
    <nav className="workflow-rail" aria-label="Study progress">
      {steps.map((step, index) => (
        <div
          key={step.id}
          className={`workflow-node${step.complete ? ' complete' : ''}${step.current ? ' current' : ''}`}
        >
          <span>{step.complete ? <Check size={13} /> : index + 1}</span>
          <small>{step.label}</small>
        </div>
      ))}
    </nav>
  );
}

function SectionHeading({
  icon,
  step,
  title,
  subtitle,
  complete = false,
}: {
  icon: React.ReactNode;
  step: string;
  title: string;
  subtitle: string;
  complete?: boolean;
}) {
  return (
    <div className="section-heading">
      <span className="section-icon">{icon}</span>
      <div>
        <small>Step {step}</small>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      {complete && <span className="section-complete" title="Complete"><Check size={14} /></span>}
    </div>
  );
}

function ExposureEvidence({ summary }: { summary: ExposureSummary }) {
  return (
    <div className="evidence-strip">
      <div><span>Task coverage</span><strong>{Math.round(summary.estimated_task_coverage * 100)}%</strong></div>
      <div><span>Sampled poses</span><strong>{formatNumber(summary.sampled_pose_count)}</strong></div>
      <div><span>Max depth</span><strong>{formatNumber(summary.config.max_range_m)} m</strong></div>
      <p><TriangleAlert size={14} /> Relative proxy, not a probability or legal privacy determination.</p>
    </div>
  );
}

function PreferenceWeightingEvidence({ comparison }: { comparison: CompareResponse }) {
  const delta = comparison.after.sensitive_exposure - comparison.before.sensitive_exposure;
  return (
    <div className="weighting-evidence">
      <div>
        <span>Baseline sensitive score</span>
        <strong>{formatNumber(comparison.before.sensitive_exposure)}</strong>
      </div>
      <span className="weighting-arrow">→</span>
      <div>
        <span>Preference-weighted score</span>
        <strong>{formatNumber(comparison.after.sensitive_exposure)}</strong>
      </div>
      <p>
        {delta >= 0 ? '+' : ''}{formatNumber(delta)} concern-weighted units. Route and camera are unchanged.
      </p>
    </div>
  );
}

function DecisionPanel({
  condition,
  decision,
  confidence,
  submitted,
  appliedOption,
  disabled,
  onDecision,
  onConfidence,
  onSubmit,
  onDownload,
}: {
  condition: StudyCondition;
  decision: FinalDecision | null;
  confidence: number;
  submitted: boolean;
  appliedOption: Pick<PlanningOption, 'id' | 'label'> | null;
  disabled: boolean;
  onDecision: (decision: FinalDecision) => void;
  onConfidence: (confidence: number) => void;
  onSubmit: () => void;
  onDownload: () => void;
}) {
  const choices: Array<{ id: FinalDecision; label: string; zh: string }> = [
    { id: 'authorize', label: 'Authorize this plan', zh: '同意该方案' },
    { id: 'request_revision', label: 'Request another revision', zh: '要求进一步调整' },
    { id: 'do_not_authorize', label: 'Do not authorize', zh: '不同意该方案' },
  ];
  const step = condition === 'visual_exposure' ? '5' : '2';

  return (
    <section className="workflow-section decision-panel" aria-label="Final decision">
      <SectionHeading
        icon={<Check size={17} />}
        step={step}
        title="Record your decision"
        subtitle="记录你的最终决定"
        complete={submitted}
      />
      {appliedOption && <p className="applied-note"><Check size={14} /> Applied suggestion: {appliedOption.label}</p>}
      <fieldset disabled={disabled}>
        <legend>Based on the information shown, what would you choose?</legend>
        <div className="decision-choices">
          {choices.map((choice) => (
            <label key={choice.id} className={decision === choice.id ? 'selected' : ''}>
              <input
                type="radio"
                name="final-decision"
                value={choice.id}
                checked={decision === choice.id}
                onChange={() => onDecision(choice.id)}
              />
              <span><strong>{choice.label}</strong><small>{choice.zh}</small></span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="decision-confidence" disabled={disabled}>
        <legend>How confident are you? / 你有多确定？</legend>
        <div>
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              className={confidence === value ? 'active' : ''}
              type="button"
              aria-label={`Decision confidence ${value}`}
              onClick={() => onConfidence(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </fieldset>
      <button className="primary-action decision-submit" type="button" disabled={disabled || !decision} onClick={onSubmit}>
        <Check size={17} /> {submitted ? 'Decision recorded' : 'Record Decision'}
      </button>
      {submitted && (
        <div className="decision-complete" role="status">
          <Check size={18} />
          <div><strong>Response recorded</strong><span>你的选择已记录，可导出研究日志。</span></div>
          <button className="icon-button" type="button" title="Download study log" aria-label="Download study log" onClick={onDownload}><Download size={16} /></button>
        </div>
      )}
    </section>
  );
}

function MapLegend({
  condition,
  exposureVisible,
  preferencesVisible,
  previewVisible,
  poseHitsVisible = false,
  language,
}: {
  condition: StudyCondition;
  exposureVisible: boolean;
  preferencesVisible: boolean;
  previewVisible: boolean;
  poseHitsVisible?: boolean;
  language?: StudyLanguage;
}) {
  const localized = (english: string, chinese: string) => language
    ? uiText(language, english, chinese)
    : `${english} / ${chinese}`;
  return (
    <aside className="map-legend" aria-label={localized('Map legend', '地图图例')}>
      <strong>{localized('Map evidence', '地图证据')}</strong>
      <span><i className="legend-line route" /> {localized('Planned route', '计划航线')}</span>
      {condition !== 'basic_notice' && <span><i className="legend-area frustum" /> {localized('Camera footprint', '相机覆盖范围')}</span>}
      {exposureVisible && (
        <>
          <span><i className="legend-area exposure-low" /> {localized('Lower exposure', '较低暴露')}</span>
          <span><i className="legend-area exposure-high" /> {localized('Higher exposure', '较高暴露')}</span>
        </>
      )}
      {preferencesVisible && <span><i className="legend-area preference" /> {localized('User concern', '用户关注区域')}</span>}
      {previewVisible && <span><i className="legend-line preview" /> {localized('Suggested route', '建议航线')}</span>}
      {poseHitsVisible && <span><i className="legend-area pose-hit" /> {localized('Current first hits', '当前位置命中')}</span>}
    </aside>
  );
}

function OperationStatus({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="operation-status" role="status" aria-live="polite">
      <span className="operation-spinner" />
      <div><strong>{title}</strong><small>{detail}</small></div>
    </div>
  );
}

function cameraProfileDisplayLabel(profile: CameraProfile | undefined, language: StudyLanguage): string {
  if (!profile) return uiText(language, 'Configured camera', '已配置相机');
  if (language === 'en') return profile.label;
  return {
    wide_survey: '广角概览',
    inspection_balanced: '均衡检查',
    focused_detail: '聚焦细节',
    custom: '自定义相机',
  }[profile.id] ?? profile.label;
}

function planningOptionDisplayLabel(
  option: Pick<PlanningOption, 'id' | 'label'>,
  language: StudyLanguage,
): string {
  if (language === 'en') return option.label;
  const normalized = option.label.toLowerCase();
  if (normalized.includes('privacy')) return '隐私优先';
  if (normalized.includes('task')) return '任务保持';
  if (normalized.includes('balanced')) return '均衡方案';
  return option.label;
}

function planningStrategyDisplayLabel(strategy: string, language: StudyLanguage): string {
  if (language === 'en') return friendlyStrategy(strategy);
  return {
    altitude: '关注区域附近提高高度',
    lateral: '横向航线偏移',
    depth_limited_camera: '限制有效视觉深度',
    combined: '航线与相机组合响应',
    current: '当前航线',
  }[strategy] ?? friendlySemanticType(strategy, language);
}

function planningOptionExplanation(
  option: Pick<PlanningOption, 'strategy' | 'explanation'>,
  language: StudyLanguage,
): string {
  if (language === 'en') return option.explanation;
  return {
    altitude: '在标注隐私区域附近提高相关航段高度，以减少近距离视觉暴露。',
    lateral: '将相关航段横向移离标注区域，同时尽量保持原始任务走廊。',
    depth_limited_camera: '限制有效视觉深度，并在标注区域附近调整相机俯仰，以减少远距离可识别暴露。',
    combined: '组合航线偏移、高度提升和相机调整，以形成更强的隐私响应。',
    current: '保留当前航线和相机配置。',
  }[option.strategy] ?? '该建议方案已使用相同的视觉暴露引擎进行评估。';
}

function friendlySemanticType(value: string, language?: StudyLanguage): string {
  const normalized = value
    .replace(/_user_sensitive/g, '')
    .replace(/_do_not_capture/g, '')
    .toLowerCase();
  if (language === 'zh') {
    if (normalized.includes('residential') && normalized.includes('facade')) return '住宅立面';
    if (normalized.includes('residential') && normalized.includes('roof')) return '住宅屋顶';
    if (normalized.includes('facade')) return '建筑立面';
    if (normalized.includes('roof')) return '建筑屋顶';
    if (normalized.includes('courtyard')) return '庭院';
    if (normalized.includes('school')) return '学校区域';
    if (normalized.includes('hospital')) return '医院区域';
    if (normalized.includes('playground')) return '操场';
    if (normalized.includes('park')) return '公园';
    if (normalized.includes('road')) return '道路';
    if (normalized.includes('ground')) return '地面';
  }
  return normalized
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
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
        <div><strong>Suggested Alternatives</strong><small>建议替代方案</small></div>
        <span>{options.length} raycast-evaluated suggestions</span>
      </div>
      <div className="option-table-head" aria-hidden="true">
        <span>Alternative</span><span>Sensitive ↓</span><span>Route Δ</span><span>Coverage Δ</span>
      </div>
      {options.map((option) => (
        <article key={option.id} className={previewOptionId === option.id ? 'planning-card active' : 'planning-card'}>
          <div className="planning-card-title">
            <div><strong>{option.label}</strong><small>{friendlyStrategy(option.strategy)}</small></div>
            {previewOptionId === option.id && <span className="preview-badge"><Eye size={12} /> Previewing</span>}
          </div>
          <div className="planning-metrics">
            <Metric label="Sensitive Down" value={signedPercent(option.delta.sensitive_exposure_reduction_percent, true)} />
            <Metric label="Total Down" value={signedPercent(option.delta.total_exposure_reduction_percent, true)} />
            <Metric label="Route Change" value={signedPercent(option.delta.route_length_increase_percent)} />
            <Metric label="Coverage Loss" value={signedPercent(option.delta.coverage_loss_percent)} />
          </div>
          <p>{option.explanation}</p>
          <p className="option-method-note">Evaluated at reduced ray fidelity for screening. Apply and recompute for the final result.</p>
          <div className="tool-row">
            <button className="tool-button" type="button" onClick={() => onPreview(option.id)}>
              <Eye size={14} /> Preview
            </button>
            <button className="tool-button active" type="button" onClick={() => onApply(option)}>
              <Check size={14} /> Apply
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

function friendlyStrategy(strategy: string): string {
  return {
    altitude: 'Higher altitude near concern',
    lateral: 'Lateral route offset',
    depth_limited_camera: 'Limited visual depth',
    combined: 'Combined route + camera response',
    current: 'Current route',
  }[strategy] ?? friendlySemanticType(strategy);
}

function signedPercent(value: number, reduction = false): string {
  if (value === 0) return '0%';
  const display = reduction ? -value : value;
  return `${display > 0 ? '+' : ''}${formatNumber(display)}%`;
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
        <span>Camera Mode / 相机模式</span>
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
            <span className="preset-card-title">
              <strong>{profile.label}</strong>
              {activeProfileId === profile.id && <Check size={14} />}
            </span>
            <span>{profileDescription(profile.id, profile.description)}</span>
            <small>{profile.camera.hfov_deg}° view · {formatNumber(profile.camera.max_depth_m ?? 0)} m depth</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function profileDescription(id: string, fallback: string): string {
  return {
    wide_survey: 'See a wider area with less image detail.',
    inspection_balanced: 'Balanced context and detail for this study.',
    focused_detail: 'See a narrower area with more image detail.',
  }[id] ?? fallback;
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

function buildPoseHitCollections(
  scenario: Scenario,
  exposure: ExposureResponse,
  pose: PoseEvidence,
): {
  surfaces: FeatureCollection;
  buildings: FeatureCollection;
  semanticAreas: FeatureCollection;
  points: ExposureResponse['exposure_points'];
} {
  // `top_surface_ids` intentionally carries only the five strongest
  // contributors for a pose. Highlighting this compact set keeps slider
  // interaction responsive while the numeric count still reports every
  // visible first-hit surface at that position.
  const hitSurfaceIds = new Set(pose.top_surface_ids);
  const hitSurfaces = exposure.exposure_surfaces.features.filter((feature) =>
    hitSurfaceIds.has(String(feature.properties.surface_id ?? '')),
  );
  const buildingIds = new Set<string>();
  const semanticIds = new Set<string>();

  for (const feature of hitSurfaces) {
    const surfaceType = String(feature.properties.surface_type ?? '');
    const sourceId = String(feature.properties.source_id ?? '');
    if (!sourceId) continue;
    if (surfaceType === 'roof' || surfaceType === 'facade') buildingIds.add(sourceId);
    if (surfaceType === 'ground') semanticIds.add(sourceId);
  }

  return {
    surfaces: { type: 'FeatureCollection', features: hitSurfaces },
    buildings: {
      type: 'FeatureCollection',
      features: scenario.buildings.features.filter((feature) =>
        buildingIds.has(String(feature.properties.building_id ?? '')),
      ),
    },
    semanticAreas: {
      type: 'FeatureCollection',
      features: scenario.semantic_layers.features.filter((feature) =>
        semanticIds.has(String(feature.properties.surface_id ?? '')),
      ),
    },
    points: exposure.exposure_points.filter((point) => hitSurfaceIds.has(point.surface_id)),
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
