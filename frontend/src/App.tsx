import { GeoJsonLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from 'deck.gl';
import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';
import DeckGL from '@deck.gl/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { computeExposure, loadScenario } from './api';
import { parseRouteFileContent } from './routeParser';
import type { AppError, CameraConfig, ExposureResponse, RoutePoint, Scenario } from './types';
import type { FeatureCollection } from './utils/geojson';

const INITIAL_VIEW_STATE = {
  longitude: 113.9305,
  latitude: 22.5405,
  zoom: 16,
  pitch: 45,
  bearing: 0,
};

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export function App() {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [route, setRoute] = useState<RoutePoint[]>([]);
  const [camera, setCamera] = useState<CameraConfig | null>(null);
  const [exposure, setExposure] = useState<ExposureResponse | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [uploadMessage, setUploadMessage] = useState('Default route loaded from scenario.');
  const [isScenarioLoading, setScenarioLoading] = useState(true);
  const [isComputing, setComputing] = useState(false);

  useEffect(() => {
    let active = true;
    setScenarioLoading(true);
    loadScenario()
      .then((nextScenario) => {
        if (!active) return;
        setScenario(nextScenario);
        setRoute(nextScenario.default_route);
        setCamera(nextScenario.camera);
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
      setUploadMessage(`${parsed.sourceFormat} route loaded: ${parsed.route.length} waypoints.`);
      setError(null);
    } catch (reason) {
      setError({
        title: 'Route upload rejected',
        message: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }, []);

  const handleCompute = useCallback(async () => {
    if (!scenario || !camera) return;
    setComputing(true);
    try {
      const response = await computeExposure(scenario.scenario_id, route, camera);
      setExposure(response);
      setError(null);
    } catch (reason) {
      setError({
        title: 'Exposure computation failed',
        message: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      setComputing(false);
    }
  }, [camera, route, scenario]);

  const layers = useMemo(() => {
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

    if (scenario) {
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

    if (exposure) {
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
          pickable: true,
        }) as any,
      );
    }

    if (route.length >= 2) {
      const frustums = camera ? buildCameraFrustums(route, camera) : emptyFeatureCollection();
      const droneGlyphs = buildDroneGlyphs(route);
      const frustumRays = camera ? buildFrustumRays(route, camera) : [];
      nextLayers.push(
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
        new PathLayer({
          id: 'route-path',
          data: [{ path: route.map((point) => [point.lon, point.lat, point.alt]) }],
          getPath: (item: { path: number[][] }) => item.path as any,
          getColor: [22, 107, 185, 255],
          getWidth: 5,
          widthUnits: 'pixels',
          pickable: true,
        }) as any,
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
        new ScatterplotLayer({
          id: 'route-waypoints',
          data: route,
          getPosition: (point: RoutePoint) => [point.lon, point.lat, point.alt],
          getFillColor: [21, 93, 138, 255],
          getLineColor: [255, 255, 255, 255],
          getRadius: 4,
          radiusUnits: 'pixels',
          lineWidthMinPixels: 2,
          stroked: true,
          pickable: true,
        }) as any,
      );
    }

    return nextLayers;
  }, [exposure, route, scenario]);

  return (
    <main className="app-shell">
      <DeckGL
        controller
        initialViewState={scenario ? { ...INITIAL_VIEW_STATE, longitude: scenario.origin.lon, latitude: scenario.origin.lat } : INITIAL_VIEW_STATE}
        layers={layers}
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
          </div>
        </div>

        {error && (
          <div className="error-box" role="alert">
            <strong>{error.title}</strong>
            <p>{error.message}</p>
          </div>
        )}

        <label className="field">
          <span>Route file</span>
          <input
            aria-label="Route file"
            type="file"
            accept=".json,.geojson,.wkt,.txt,application/geo+json,application/json,text/plain"
            onChange={(event) => void handleUpload(event.target.files?.[0] ?? null)}
          />
        </label>
        <p className="hint">{uploadMessage}</p>

        <div className="camera-grid">
          <NumberField label="HFOV" value={camera?.hfov_deg ?? 0} suffix="deg" onChange={(value) => setCameraValue(setCamera, 'hfov_deg', value)} />
          <NumberField label="VFOV" value={camera?.vfov_deg ?? 0} suffix="deg" onChange={(value) => setCameraValue(setCamera, 'vfov_deg', value)} />
          <NumberField label="Pitch" value={camera?.gimbal_pitch_deg ?? 0} suffix="deg" onChange={(value) => setCameraValue(setCamera, 'gimbal_pitch_deg', value)} />
          <NumberField label="Rays W" value={camera?.ray_width ?? 0} onChange={(value) => setCameraValue(setCamera, 'ray_width', Math.round(value))} />
          <NumberField label="Rays H" value={camera?.ray_height ?? 0} onChange={(value) => setCameraValue(setCamera, 'ray_height', Math.round(value))} />
        </div>

        <button className="primary-action" type="button" disabled={!scenario || !camera || route.length < 2 || isComputing} onClick={() => void handleCompute()}>
          {isComputing ? 'Computing...' : 'Compute Exposure'}
        </button>

        <div className="metric-row">
          <Metric label="Waypoints" value={route.length.toString()} />
          <Metric label="Buildings" value={(scenario?.buildings.features.length ?? 0).toString()} />
          <Metric label="Sensitive Areas" value={(scenario?.semantic_layers.features.length ?? 0).toString()} />
          <Metric label="Frustums" value={route.length.toString()} />
        </div>
      </section>

      <section className="summary-panel" aria-label="Exposure summary">
        {exposure ? (
          <>
            <Metric label="Total Exposure" value={formatNumber(exposure.summary.total_exposure)} />
            <Metric label="Sensitive Exposure" value={formatNumber(exposure.summary.sensitive_exposure)} />
            <Metric label="Route Length" value={`${formatNumber(exposure.summary.route_length_m)} m`} />
            <Metric label="Task Coverage" value={`${Math.round(exposure.summary.estimated_task_coverage * 100)}%`} />
            <Metric label="Ray Count" value={formatNumber(exposure.summary.ray_count)} />
          </>
        ) : (
          <p className="summary-empty">Compute exposure to view backend raycasting results.</p>
        )}
      </section>
    </main>
  );
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
        <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
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

function setCameraValue(
  setCamera: React.Dispatch<React.SetStateAction<CameraConfig | null>>,
  key: keyof CameraConfig,
  value: number,
) {
  setCamera((current) => (current ? { ...current, [key]: value } : current));
}

function buildCameraFrustums(route: RoutePoint[], camera: CameraConfig): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: route.map((pose, index) => {
      const leftYaw = pose.yaw - camera.hfov_deg / 2;
      const rightYaw = pose.yaw + camera.hfov_deg / 2;
      const shallowPitch = camera.gimbal_pitch_deg + camera.vfov_deg / 2;
      const steepPitch = camera.gimbal_pitch_deg - camera.vfov_deg / 2;
      const farLeft = projectGroundPoint(pose, leftYaw, shallowPitch);
      const farRight = projectGroundPoint(pose, rightYaw, shallowPitch);
      const nearRight = projectGroundPoint(pose, rightYaw, steepPitch);
      const nearLeft = projectGroundPoint(pose, leftYaw, steepPitch);

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
    const center = projectGroundPoint(pose, pose.yaw, camera.gimbal_pitch_deg);
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
    projectGroundPoint(pose, leftYaw, shallowPitch),
    projectGroundPoint(pose, rightYaw, shallowPitch),
    projectGroundPoint(pose, rightYaw, steepPitch),
    projectGroundPoint(pose, leftYaw, steepPitch),
  ];
}

function projectGroundPoint(pose: RoutePoint, yawDeg: number, pitchDeg: number) {
  const downAngleDeg = Math.max(5, Math.min(88, Math.abs(pitchDeg)));
  const groundDistanceM = pose.alt / Math.tan((downAngleDeg * Math.PI) / 180);
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

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}
