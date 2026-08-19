import { Crosshair, Eye, Layers3 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ExposureResponse, PoseEvidence, Scenario, StudyLanguage } from './types';

type EvidenceRuntime = {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  buildingMaterials: Map<string, THREE.MeshStandardMaterial>;
  renderPose: (pose: PoseEvidence, topSurfaceIds: string[]) => void;
  resize: () => void;
  dispose: () => void;
};

export function EvidenceViewport({
  scenario,
  exposure,
  pose,
  language,
}: {
  scenario: Scenario;
  exposure: ExposureResponse;
  pose: PoseEvidence;
  language: StudyLanguage;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<EvidenceRuntime | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    try {
      const runtime = createEvidenceRuntime(host, scenario, language);
      runtimeRef.current = runtime;
      runtime.renderPose(pose, pose.top_surface_ids);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
    return () => {
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, [language, scenario]);

  useEffect(() => {
    runtimeRef.current?.renderPose(pose, pose.top_surface_ids);
  }, [pose]);

  const topSurfaces = pose.top_surface_ids
    .map((surfaceId) => exposure.exposure_surfaces.features.find(
      (feature) => feature.properties.surface_id === surfaceId,
    ))
    .filter(Boolean)
    .slice(0, 3);

  return (
    <div className="evidence-viewport">
      <div className="evidence-canvas" ref={hostRef} data-render-status={status}>
        {status === 'loading' && <div className="evidence-loading">{language === 'zh' ? '正在构建合成视角…' : 'Building synthetic view...'}</div>}
        {status === 'error' && <div className="evidence-loading">{language === 'zh' ? '合成视角暂不可用' : 'Synthetic view unavailable'}</div>}
        <div className="camera-crosshair"><span /><Crosshair size={21} /><span /></div>
        <div className="synthetic-badge"><Eye size={13} /> {language === 'zh' ? '合成可见性估计' : 'Synthetic visibility estimate'}</div>
        <div className="camera-hud"><span>{language === 'zh' ? '位置' : 'POSE'} {String(pose.pose_index + 1).padStart(2, '0')}</span><span>{Math.round(pose.alt)} m</span><span>{Math.round(pose.yaw)}°</span></div>
      </div>
      <div className="pose-evidence-strip">
        <div><span>{language === 'zh' ? '该位置暴露' : 'Exposure here'}</span><strong>{formatValue(pose.total_exposure)}</strong></div>
        <div><span>{language === 'zh' ? '敏感暴露' : 'Sensitive'}</span><strong>{formatValue(pose.sensitive_exposure)}</strong></div>
        <div><span>{language === 'zh' ? '可见表面' : 'Visible surfaces'}</span><strong>{pose.visible_surface_count}</strong></div>
      </div>
      <div className="top-surface-list">
        <p><Layers3 size={14} /> {language === 'zh' ? '主要 first-hit 表面' : 'Leading first-hit surfaces'}</p>
        {topSurfaces.length ? topSurfaces.map((feature) => (
          <div key={String(feature!.properties.surface_id)}>
            <span>{friendlySurface(String(feature!.properties.semantic_type ?? feature!.properties.surface_type ?? 'surface'), language)}</span>
            <strong>{formatValue(Number(feature!.properties.exposure ?? 0))}</strong>
          </div>
        )) : <small>{language === 'zh' ? '该位置没有有效命中。' : 'No valid first-hit surfaces at this pose.'}</small>}
      </div>
    </div>
  );
}

function createEvidenceRuntime(
  host: HTMLDivElement,
  scenario: Scenario,
  language: StudyLanguage,
): EvidenceRuntime {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.domElement.className = 'evidence-webgl-canvas';
  renderer.domElement.setAttribute(
    'aria-label',
    language === 'zh' ? '合成无人机相机可见性视角' : 'Synthetic UAV camera visibility view',
  );
  host.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd9e1df);
  scene.fog = new THREE.Fog(0xd9e1df, 180, 760);
  scene.add(new THREE.HemisphereLight(0xf5fbfa, 0x5b6865, 2.4));
  const sun = new THREE.DirectionalLight(0xffead0, 3.4);
  sun.position.set(-180, 320, 120);
  sun.castShadow = true;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshStandardMaterial({ color: 0xaebbb5, roughness: 0.96 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(900, 45, 0x81928c, 0x9eaaa6);
  grid.position.y = 0.12;
  (grid.material as THREE.Material).opacity = 0.2;
  (grid.material as THREE.Material).transparent = true;
  scene.add(grid);

  const buildingMaterials = new Map<string, THREE.MeshStandardMaterial>();
  for (const feature of scenario.buildings.features) {
    if (feature.geometry.type !== 'Polygon') continue;
    const buildingId = String(feature.properties.building_id ?? feature.properties.osm_id ?? 'building');
    const ring = feature.geometry.coordinates[0] as number[][];
    const shape = polygonShape(ring, scenario);
    const height = Math.max(4, Number(feature.properties.height_m ?? 18));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({
      color: 0x778781,
      roughness: 0.78,
      metalness: 0.04,
      emissive: 0x000000,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    buildingMaterials.set(buildingId, material);
  }

  for (const feature of scenario.semantic_layers.features) {
    if (feature.geometry.type !== 'Polygon') continue;
    const ring = feature.geometry.coordinates[0] as number[][];
    const geometry = new THREE.ShapeGeometry(polygonShape(ring, scenario));
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0xe2a84b,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0.3;
    scene.add(mesh);
  }

  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1000);
  camera.up.set(0, 1, 0);

  const resize = () => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const renderPose = (pose: PoseEvidence, topSurfaceIds: string[]) => {
    for (const [buildingId, material] of buildingMaterials) {
      const active = topSurfaceIds.some((surfaceId) => surfaceId === buildingId || surfaceId.startsWith(`${buildingId}_`));
      material.color.setHex(active ? 0xc96848 : 0x778781);
      material.emissive.setHex(active ? 0x5a160c : 0x000000);
      material.emissiveIntensity = active ? 0.75 : 0;
    }
    const position = geoToWorld(pose.lon, pose.lat, pose.alt, scenario);
    camera.position.set(position.x, position.y, position.z);
    camera.fov = 50;
    const yaw = THREE.MathUtils.degToRad(pose.yaw);
    const pitch = THREE.MathUtils.degToRad(pose.gimbal_pitch_deg);
    const direction = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    );
    camera.lookAt(camera.position.clone().add(direction.multiplyScalar(140)));
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };

  return {
    renderer,
    camera,
    buildingMaterials,
    renderPose,
    resize,
    dispose: () => {
      observer.disconnect();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

function polygonShape(ring: number[][], scenario: Scenario): THREE.Shape {
  const shape = new THREE.Shape();
  ring.forEach(([lon, lat], index) => {
    const point = geoToWorld(lon, lat, 0, scenario);
    if (index === 0) shape.moveTo(point.x, -point.z);
    else shape.lineTo(point.x, -point.z);
  });
  return shape;
}

function geoToWorld(lon: number, lat: number, alt: number, scenario: Scenario) {
  const north = (lat - scenario.origin.lat) * 111_320;
  const east = (lon - scenario.origin.lon) * 111_320 * Math.cos(THREE.MathUtils.degToRad(scenario.origin.lat));
  return { x: east, y: alt - scenario.origin.alt, z: -north };
}

function friendlySurface(value: string, language: StudyLanguage): string {
  const normalized = value.toLowerCase();
  if (language === 'zh') {
    if (normalized.includes('residential') && normalized.includes('facade')) return '住宅立面';
    if (normalized.includes('residential') && normalized.includes('roof')) return '住宅屋顶';
    if (normalized.includes('facade')) return '建筑立面';
    if (normalized.includes('roof')) return '建筑屋顶';
    if (normalized.includes('courtyard')) return '庭院';
    if (normalized.includes('school')) return '学校区域';
    if (normalized.includes('hospital')) return '医院区域';
    if (normalized.includes('road')) return '道路';
    if (normalized.includes('ground')) return '地面';
  }
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatValue(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '0';
}
