import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type MeshViewMode = 'observer' | 'camera';

type BuildingFeature = {
  properties: {
    building_id?: string;
    height_m?: number;
    osm_id?: number;
    semantic_type?: string;
  };
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
};

type BuildingCollection = {
  features: BuildingFeature[];
};

type SceneRuntime = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  uav: THREE.Group;
  privacyTarget: THREE.Mesh;
  cameraFrustum: THREE.Group;
  update: (time: number, exposure: number, reveal: boolean) => void;
  resize: () => void;
  dispose: () => void;
};

const ORIGIN = { lon: 114.1708, lat: 22.3182 };
const BUILDING_RADIUS_M = 270;
const BUILDINGS_URL = '/scenarios/hong_kong_mong_kok_01/osm_buildings.geojson';
const DURATION_SECONDS = 36;
const CAMERA_HFOV_DEG = 68;
const CAMERA_ASPECT = 16 / 9;
const CAMERA_VFOV_DEG = THREE.MathUtils.radToDeg(
  2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(CAMERA_HFOV_DEG) / 2) / CAMERA_ASPECT),
);
const CAMERA_MAX_DEPTH_M = 165;
let buildingDataPromise: Promise<BuildingCollection> | null = null;

export function WarmupMeshScene({
  mode,
  time,
  exposure,
  reveal,
}: {
  mode: MeshViewMode;
  time: number;
  exposure: number;
  reveal: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    const host = hostRef.current;
    if (!host) return;

    loadBuildingData()
      .then((buildings) => {
        if (!active || !hostRef.current) return;
        const runtime = createSceneRuntime(hostRef.current, mode, buildings);
        runtimeRef.current = runtime;
        runtime.update(time, exposure, reveal);
        setStatus('ready');
      })
      .catch(() => {
        if (active) setStatus('error');
      });

    return () => {
      active = false;
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, [mode]);

  useEffect(() => {
    runtimeRef.current?.update(time, exposure, reveal);
  }, [exposure, reveal, time]);

  return (
    <div className="warmup-mesh-host" ref={hostRef} data-render-status={status}>
      {status === 'loading' && <div className="mesh-loading">Building 3D scene / 正在构建三维场景</div>}
      {status === 'error' && <div className="mesh-loading error">3D scene unavailable / 三维场景不可用</div>}
    </div>
  );
}

function loadBuildingData(): Promise<BuildingCollection> {
  if (!buildingDataPromise) {
    buildingDataPromise = fetch(BUILDINGS_URL).then((response) => {
      if (!response.ok) throw new Error(`Building data failed with ${response.status}`);
      return response.json() as Promise<BuildingCollection>;
    });
  }
  return buildingDataPromise;
}

function createSceneRuntime(
  host: HTMLDivElement,
  mode: MeshViewMode,
  buildings: BuildingCollection,
): SceneRuntime {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'warmup-mesh-canvas';
  renderer.domElement.setAttribute('aria-label', mode === 'observer' ? '3D resident view' : '3D UAV camera live view');
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(mode === 'observer' ? 0x9fc5d7 : 0xa9c2c8);
  scene.fog = new THREE.FogExp2(mode === 'observer' ? 0xb9ced4 : 0xb5c6c5, 0.00118);
  addPhysicalSky(scene);

  const camera = new THREE.PerspectiveCamera(mode === 'observer' ? 54 : CAMERA_VFOV_DEG, 1, 0.5, 1400);
  camera.up.set(0, 1, 0);

  scene.add(new THREE.HemisphereLight(0xeaf5f3, 0x4a5b54, 2.15));
  const sun = new THREE.DirectionalLight(0xffe8c8, 4.2);
  sun.position.set(-180, 300, 160);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -260;
  sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260;
  sun.shadow.camera.bottom = -260;
  scene.add(sun);

  addGround(scene);
  addBuildingMeshes(scene, buildings);
  addStreetContext(scene);

  const uav = createUavModel();
  uav.visible = mode === 'observer';
  scene.add(uav);

  const privacyTarget = createPrivacyTarget();
  scene.add(privacyTarget);

  const cameraFrustum = createCameraFrustum(
    CAMERA_HFOV_DEG,
    CAMERA_ASPECT,
    CAMERA_MAX_DEPTH_M,
  );
  cameraFrustum.visible = false;
  scene.add(cameraFrustum);

  const resize = () => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const observerPosition = new THREE.Vector3(-145, 88, 365);
  const observerLookAt = new THREE.Vector3(18, 78, -8);
  const targetPosition = new THREE.Vector3(74, 18, -34);
  const awayTarget = new THREE.Vector3(-150, 14, 95);
  const dronePosition = new THREE.Vector3();
  const gimbalPosition = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();

  const update = (time: number, exposure: number, reveal: boolean) => {
    const progress = THREE.MathUtils.clamp(time / DURATION_SECONDS, 0, 1);
    dronePosition.set(
      THREE.MathUtils.lerp(-190, 190, progress),
      118 + Math.sin(progress * Math.PI) * 9,
      18 - Math.sin(progress * Math.PI * 1.35) * 34,
    );
    uav.position.copy(dronePosition);
    uav.rotation.y = Math.atan2(410, -48 * Math.cos(progress * Math.PI * 1.35));
    uav.rotation.z = Math.sin(progress * Math.PI * 2) * 0.035;
    gimbalPosition.copy(dronePosition);
    gimbalPosition.y -= 2;

    const aimBlend = smoothstep(0.48, 0.76, progress);
    cameraTarget.lerpVectors(awayTarget, targetPosition, aimBlend);
    cameraTarget.y += Math.sin(progress * Math.PI) * 4;

    if (mode === 'observer') {
      camera.position.copy(observerPosition);
      camera.lookAt(observerLookAt);
      cameraFrustum.visible = reveal;
      positionCameraFrustum(cameraFrustum, gimbalPosition, cameraTarget);
    } else {
      camera.position.copy(gimbalPosition);
      camera.lookAt(cameraTarget);
      camera.fov = CAMERA_VFOV_DEG;
      camera.updateProjectionMatrix();
    }

    const targetMaterial = privacyTarget.material as THREE.MeshStandardMaterial;
    privacyTarget.visible = reveal;
    targetMaterial.opacity = reveal ? 0.18 + exposure * 0.62 : 0.08;
    targetMaterial.emissiveIntensity = reveal ? 0.4 + exposure * 2.4 : 0.1;
    privacyTarget.scale.setScalar(0.88 + exposure * 0.24);

    renderer.render(scene, camera);
  };

  const resizeObserver = new ResizeObserver(() => {
    resize();
    update(0, 0, false);
  });
  resizeObserver.observe(host);
  resize();

  return {
    renderer,
    scene,
    camera,
    uav,
    privacyTarget,
    cameraFrustum,
    update,
    resize,
    dispose: () => {
      resizeObserver.disconnect();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
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

function addPhysicalSky(scene: THREE.Scene) {
  const sky = new Sky();
  sky.scale.setScalar(8000);
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = 3.1;
  uniforms.rayleigh.value = 1.25;
  uniforms.mieCoefficient.value = 0.006;
  uniforms.mieDirectionalG.value = 0.82;
  const elevation = THREE.MathUtils.degToRad(31);
  const azimuth = THREE.MathUtils.degToRad(226);
  uniforms.sunPosition.value.setFromSphericalCoords(1, Math.PI / 2 - elevation, azimuth);
  scene.add(sky);
}

function addGround(scene: THREE.Scene) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1100, 1100),
    new THREE.MeshStandardMaterial({ color: 0x71847b, roughness: 0.96, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const courtyard = new THREE.Mesh(
    new THREE.CircleGeometry(78, 48),
    new THREE.MeshStandardMaterial({ color: 0x5e7366, roughness: 0.92 }),
  );
  courtyard.rotation.x = -Math.PI / 2;
  courtyard.position.set(42, 0.12, -12);
  courtyard.receiveShadow = true;
  scene.add(courtyard);
}

function addBuildingMeshes(scene: THREE.Scene, collection: BuildingCollection) {
  const geometryGroups = new Map<string, THREE.BufferGeometry[]>();
  const rooftopDetails: RooftopDetail[] = [];

  for (const feature of collection.features) {
    if (feature.geometry.type !== 'Polygon') continue;
    const ring = feature.geometry.coordinates[0];
    if (ring.length < 4) continue;
    const localRing = ring.map(([lon, lat]) => lonLatToLocal(lon, lat));
    const centroid = localRing.reduce((sum, point) => sum.add(point), new THREE.Vector2()).multiplyScalar(1 / localRing.length);
    if (centroid.length() > BUILDING_RADIUS_M) continue;

    const shape = new THREE.Shape();
    localRing.forEach((point, index) => {
      if (index === 0) shape.moveTo(point.x, -point.y);
      else shape.lineTo(point.x, -point.y);
    });

    const height = THREE.MathUtils.clamp(Number(feature.properties.height_m ?? 35), 8, 150);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: false,
      curveSegments: 1,
      steps: 1,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.computeVertexNormals();
    const semantic = feature.properties.semantic_type ?? 'building';
    const semanticClass = semantic.includes('commercial')
      ? 'commercial'
      : semantic.includes('residential')
        ? 'residential'
        : 'mixed';
    const featureKey = String(
      feature.properties.building_id
      ?? feature.properties.osm_id
      ?? `${ring[0][0]}:${ring[0][1]}`,
    );
    const featureHash = stableHash(featureKey);
    const key = `${semanticClass}:${featureHash % 5}`;
    const group = geometryGroups.get(key) ?? [];
    group.push(geometry);
    geometryGroups.set(key, group);

    const bounds = localRing.reduce(
      (result, point) => ({
        minX: Math.min(result.minX, point.x),
        maxX: Math.max(result.maxX, point.x),
        minY: Math.min(result.minY, point.y),
        maxY: Math.max(result.maxY, point.y),
      }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
    );
    const roofWidth = bounds.maxX - bounds.minX;
    const roofDepth = bounds.maxY - bounds.minY;
    if (featureHash % 3 !== 1 && roofWidth > 9 && roofDepth > 9) {
      rooftopDetails.push({
        position: new THREE.Vector3(centroid.x, height + 0.7, centroid.y),
        width: THREE.MathUtils.clamp(roofWidth * (0.12 + (featureHash % 5) * 0.012), 2.2, 8),
        depth: THREE.MathUtils.clamp(roofDepth * (0.11 + (featureHash % 7) * 0.01), 2.2, 7),
        height: 1.5 + (featureHash % 4) * 0.65,
        tank: featureHash % 4 === 0,
      });
    }
  }

  const palette: Record<string, number[]> = {
    residential: [0xc5c2b6, 0xb9c0b9, 0xcfccc0, 0xbeb9ae, 0xc6c8bf],
    commercial: [0xa9b6b2, 0x9faeae, 0xb7b8af, 0xabb2a8, 0x96aaa9],
    mixed: [0xb9b5a9, 0xc2bdb2, 0xaeb8b1, 0xc7c1b4, 0xadb1a8],
  };

  for (const [key, geometries] of geometryGroups) {
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((geometry) => geometry.dispose());
    if (!merged) continue;
    const [semantic, styleIndexText] = key.split(':');
    const styleIndex = Number(styleIndexText);
    const material = new THREE.MeshStandardMaterial({
      color: palette[semantic][styleIndex],
      roughness: 0.73,
      metalness: 0.04,
    });
    installFacadeShader(material, key);
    const mesh = new THREE.Mesh(
      merged,
      material,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(merged, 28),
      new THREE.LineBasicMaterial({ color: 0x4f5e5a, transparent: true, opacity: 0.1 }),
    );
    scene.add(edges);
  }

  addRooftopEquipment(scene, rooftopDetails);
}

type RooftopDetail = {
  position: THREE.Vector3;
  width: number;
  depth: number;
  height: number;
  tank: boolean;
};

function addRooftopEquipment(scene: THREE.Scene, details: RooftopDetail[]) {
  const utilityDetails = details.filter((detail) => !detail.tank).slice(0, 170);
  const tankDetails = details.filter((detail) => detail.tank).slice(0, 70);
  const matrix = new THREE.Matrix4();

  if (utilityDetails.length > 0) {
    const utilityBoxes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x77817d, roughness: 0.68, metalness: 0.18 }),
      utilityDetails.length,
    );
    utilityDetails.forEach((detail, index) => {
      matrix.compose(
        detail.position.clone().add(new THREE.Vector3(0, detail.height / 2, 0)),
        new THREE.Quaternion(),
        new THREE.Vector3(detail.width, detail.height, detail.depth),
      );
      utilityBoxes.setMatrixAt(index, matrix);
    });
    utilityBoxes.castShadow = true;
    utilityBoxes.receiveShadow = true;
    scene.add(utilityBoxes);
  }

  if (tankDetails.length > 0) {
    const waterTanks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 14),
      new THREE.MeshStandardMaterial({ color: 0x83908d, roughness: 0.42, metalness: 0.48 }),
      tankDetails.length,
    );
    tankDetails.forEach((detail, index) => {
      const radius = Math.min(detail.width, detail.depth) * 0.28;
      matrix.compose(
        detail.position.clone().add(new THREE.Vector3(0, detail.height / 2, 0)),
        new THREE.Quaternion(),
        new THREE.Vector3(radius, detail.height, radius),
      );
      waterTanks.setMatrixAt(index, matrix);
    });
    waterTanks.castShadow = true;
    scene.add(waterTanks);
  }
}

function installFacadeShader(material: THREE.MeshStandardMaterial, semantic: string) {
  const windowColor = semantic === 'commercial'
    ? new THREE.Color(0x355f68)
    : new THREE.Color(0x415a61);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.windowColor = { value: windowColor };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWarmupWorldPosition;\nvarying vec3 vWarmupWorldNormal;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWarmupWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWarmupWorldNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 windowColor;\nvarying vec3 vWarmupWorldPosition;\nvarying vec3 vWarmupWorldNormal;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float facadeMask = 1.0 - smoothstep(0.45, 0.7, abs(vWarmupWorldNormal.y));
        float horizontalAxis = abs(vWarmupWorldNormal.x) > abs(vWarmupWorldNormal.z)
          ? vWarmupWorldPosition.z
          : vWarmupWorldPosition.x;
        vec2 cell = fract(vec2(horizontalAxis / 5.2, vWarmupWorldPosition.y / 4.3));
        float windowX = step(0.16, cell.x) * step(cell.x, 0.78);
        float windowY = step(0.2, cell.y) * step(cell.y, 0.68);
        vec2 windowIndex = floor(vec2(horizontalAxis / 5.2, vWarmupWorldPosition.y / 4.3));
        float randomWindow = fract(sin(dot(windowIndex, vec2(12.9898, 78.233))) * 43758.5453);
        float windowMask = facadeMask * windowX * windowY * step(3.0, vWarmupWorldPosition.y);
        float floorBand = facadeMask * smoothstep(0.86, 0.98, cell.y);
        vec3 litWindow = vec3(0.72, 0.60, 0.39);
        vec3 glassColor = mix(windowColor, litWindow, step(0.91, randomWindow) * 0.42);
        diffuseColor.rgb *= 1.0 - floorBand * 0.11;
        diffuseColor.rgb = mix(diffuseColor.rgb, glassColor, windowMask * 0.72);
        float roofMask = smoothstep(0.72, 0.94, abs(vWarmupWorldNormal.y));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.09, roofMask * 0.55);`,
      );
  };
  material.customProgramCacheKey = () => `warmup-facade-${semantic}`;
}

function addStreetContext(scene: THREE.Scene) {
  const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x3d4745, roughness: 0.96 });
  for (const [x, z, width, depth, rotation] of [
    [0, 32, 620, 22, -0.11],
    [-28, -72, 26, 560, 0.04],
  ] as Array<[number, number, number, number, number]>) {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), roadMaterial.clone());
    road.rotation.x = -Math.PI / 2;
    road.rotation.z = rotation;
    road.position.set(x, 0.2, z);
    scene.add(road);
  }

  const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: 0x8e9690, roughness: 0.93 });
  for (const z of [18, 46]) {
    const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(620, 0.55, 5.5), sidewalkMaterial);
    sidewalk.position.set(0, 0.3, z);
    sidewalk.rotation.y = -0.11;
    sidewalk.receiveShadow = true;
    scene.add(sidewalk);
  }

  const markingMaterial = new THREE.MeshStandardMaterial({ color: 0xd7d6c8, roughness: 0.82 });
  for (let index = -11; index <= 11; index += 1) {
    const marking = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 0.42), markingMaterial);
    marking.position.set(index * 24, 0.34, 32 + index * 2.55);
    marking.rotation.y = -0.11;
    scene.add(marking);
  }

  const treeMaterial = new THREE.MeshStandardMaterial({ color: 0x355d48, roughness: 0.9 });
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x625447, roughness: 1 });
  for (let index = 0; index < 28; index += 1) {
    const angle = index * 2.399;
    const radius = 38 + (index % 7) * 10;
    const x = 42 + Math.cos(angle) * radius;
    const z = -12 + Math.sin(angle) * radius;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1, 7, 7), trunkMaterial);
    trunk.position.set(x, 3.5, z);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(4.5 + (index % 3), 1), treeMaterial);
    crown.position.set(x, 9, z);
    scene.add(trunk, crown);
  }
}

function createUavModel() {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x202725, roughness: 0.42, metalness: 0.45 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: 0xe85c42, emissive: 0x4d0d05, emissiveIntensity: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.8, 1.6, 3.4), bodyMaterial);
  body.castShadow = true;
  group.add(body);

  for (const [x, z] of [[-4.5, -3.3], [4.5, -3.3], [-4.5, 3.3], [4.5, 3.3]]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 5.5, 8), bodyMaterial);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = Math.atan2(z, x);
    arm.position.set(x * 0.5, 0, z * 0.5);
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.08, 28), bodyMaterial);
    rotor.position.set(x, 0.5, z);
    group.add(arm, rotor);
  }

  const camera = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 10), accentMaterial);
  camera.position.set(0, -1.25, 1.35);
  group.add(camera);
  const gimbalBracket = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.12, 8, 20), bodyMaterial);
  gimbalBracket.rotation.x = Math.PI / 2;
  gimbalBracket.position.set(0, -1.15, 1.2);
  group.add(gimbalBracket);
  group.scale.setScalar(1.48);
  return group;
}

function createPrivacyTarget() {
  const material = new THREE.MeshStandardMaterial({
    color: 0xef5b45,
    emissive: 0xef3b25,
    emissiveIntensity: 0.2,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const target = new THREE.Mesh(new THREE.CircleGeometry(17, 48), material);
  target.rotation.x = -Math.PI / 2;
  target.position.set(74, 0.55, -34);
  return target;
}

function createCameraFrustum(hfovDeg: number, aspect: number, farDepth: number) {
  const group = new THREE.Group();
  const halfWidth = Math.tan(THREE.MathUtils.degToRad(hfovDeg) / 2) * farDepth;
  const halfHeight = halfWidth / aspect;
  const apex = new THREE.Vector3(0, 0, 0);
  const corners = [
    new THREE.Vector3(-halfWidth, halfHeight, farDepth),
    new THREE.Vector3(halfWidth, halfHeight, farDepth),
    new THREE.Vector3(halfWidth, -halfHeight, farDepth),
    new THREE.Vector3(-halfWidth, -halfHeight, farDepth),
  ];

  const sidePositions: number[] = [];
  for (let index = 0; index < corners.length; index += 1) {
    const next = (index + 1) % corners.length;
    sidePositions.push(
      apex.x, apex.y, apex.z,
      corners[index].x, corners[index].y, corners[index].z,
      corners[next].x, corners[next].y, corners[next].z,
    );
  }
  const sideGeometry = new THREE.BufferGeometry();
  sideGeometry.setAttribute('position', new THREE.Float32BufferAttribute(sidePositions, 3));
  sideGeometry.computeVertexNormals();
  const sides = new THREE.Mesh(
    sideGeometry,
    new THREE.MeshBasicMaterial({
      color: 0xef745e,
      transparent: true,
      opacity: 0.055,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );

  const edgePositions: number[] = [];
  corners.forEach((corner, index) => {
    const next = corners[(index + 1) % corners.length];
    edgePositions.push(apex.x, apex.y, apex.z, corner.x, corner.y, corner.z);
    edgePositions.push(corner.x, corner.y, corner.z, next.x, next.y, next.z);
  });
  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
  const edges = new THREE.LineSegments(
    edgeGeometry,
    new THREE.LineBasicMaterial({ color: 0xff8b73, transparent: true, opacity: 0.78 }),
  );
  group.add(sides, edges);
  return group;
}

function positionCameraFrustum(
  frustum: THREE.Group,
  origin: THREE.Vector3,
  target: THREE.Vector3,
) {
  const direction = target.clone().sub(origin).normalize();
  frustum.position.copy(origin);
  frustum.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function lonLatToLocal(lon: number, lat: number) {
  const metersPerLon = 111_320 * Math.cos(THREE.MathUtils.degToRad(ORIGIN.lat));
  return new THREE.Vector2((lon - ORIGIN.lon) * metersPerLon, (lat - ORIGIN.lat) * 111_320);
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const normalized = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}
