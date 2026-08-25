import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { EventProfile } from './eventProfiles';
import { sampleEventPose, TARGET_BALCONY } from './eventProfiles';

export type EventSceneMode = 'external' | 'resident' | 'camera';

type SceneRuntime = {
  update: (time: number, reveal: boolean) => void;
  dispose: () => void;
};

export function EventMediaScene({
  mode,
  profile,
  time,
  reveal,
}: {
  mode: EventSceneMode;
  profile: EventProfile;
  time: number;
  reveal: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setStatus('loading');
    try {
      const runtime = createSceneRuntime(host, mode, profile);
      runtimeRef.current = runtime;
      runtime.update(time, reveal);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
    return () => {
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, [mode, profile]);

  useEffect(() => {
    runtimeRef.current?.update(time, reveal);
  }, [reveal, time]);

  return (
    <div className="event-scene-host" ref={hostRef} data-render-status={status}>
      {status === 'loading' && <div className="event-scene-status">Preparing synchronized view</div>}
      {status === 'error' && <div className="event-scene-status error">3D view unavailable</div>}
    </div>
  );
}

function createSceneRuntime(host: HTMLDivElement, mode: EventSceneMode, profile: EventProfile): SceneRuntime {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // A restrained filmic curve preserves facade/window contrast while keeping
  // UAV markings and the resident silhouette readable on laboratory displays.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.className = 'event-scene-canvas';
  renderer.domElement.setAttribute('aria-label', `${mode} synchronized event view`);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(mode === 'camera' ? 0xb7d0d5 : 0xc2dce3);
  // Fog previously read as a gray disclosure overlay. The study view now uses
  // direct atmospheric colors so every pixel remains inspectable.
  scene.fog = null;
  addLighting(scene);
  addEnvironment(scene);

  const balcony = createTargetBalcony();
  scene.add(balcony.group);

  const uav = createUavModel(profile.uavAppearance);
  uav.group.visible = mode !== 'camera';
  scene.add(uav.group);

  const frustum = createCameraFrustum();
  frustum.visible = false;
  scene.add(frustum);

  const camera = new THREE.PerspectiveCamera(mode === 'camera' ? 42 : mode === 'resident' ? 68 : 50, 1, 0.12, 600);
  camera.up.set(0, 1, 0);

  const dronePosition = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();
  // The eye remains behind the railing (z=2.1) and at a natural standing eye
  // height. The old z=2.5 position placed the observer outside the balcony.
  const residentEye = new THREE.Vector3(TARGET_BALCONY.x - 0.65, TARGET_BALCONY.y + 1.62, 0.25);
  const externalPosition = new THREE.Vector3();
  const externalTarget = new THREE.Vector3();

  const resize = () => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const update = (time: number, reveal: boolean) => {
    const pose = sampleEventPose(profile, time);
    dronePosition.fromArray(pose.drone);
    cameraTarget.fromArray(pose.cameraTarget);
    uav.group.position.copy(dronePosition);
    uav.group.rotation.y = Math.atan2(
      pose.cameraTarget[0] - pose.drone[0],
      pose.cameraTarget[2] - pose.drone[2],
    );
    uav.group.rotation.z = Math.sin(pose.progress * Math.PI * 2) * 0.025;
    uav.rotors.forEach((rotor, index) => {
      rotor.rotation.y = time * (index % 2 === 0 ? 22 : -22);
    });
    uav.gimbal.lookAt(cameraTarget.clone().sub(dronePosition));
    uav.policeLights.forEach((light, index) => {
      const active = Math.floor(time * 4) % 2 === index % 2;
      light.material.emissiveIntensity = active ? 8 : 0.35;
      light.scale.setScalar(active ? 1.18 : 0.86);
    });

    balcony.person.rotation.y = Math.sin(time * 0.42) * 0.08;
    balcony.phoneArm.rotation.z = -0.2 + Math.sin(time * 0.7) * 0.025;
    balcony.targetGlow.visible = reveal && mode !== 'resident' && profile.exposureLevel === 'high';
    (balcony.targetGlow.material as THREE.MeshBasicMaterial).opacity = reveal ? 0.08 + pose.exposure * 0.2 : 0;

    if (mode === 'external') {
      // A profile-specific establishing camera keeps both the balcony facade
      // and UAV in frame. Partial lateral following preserves legibility while
      // retaining the same relative geometry visible from the resident view.
      if (profile.exposureLevel === 'low') {
        externalPosition.set(dronePosition.x * 0.18 + 42, 51, 55);
        externalTarget.lerpVectors(
          new THREE.Vector3(TARGET_BALCONY.x, TARGET_BALCONY.y + 2, TARGET_BALCONY.z),
          dronePosition,
          0.56,
        );
      } else {
        // Stay between the UAV and opposite block; placing the observer behind
        // that block would let its wall occlude the establishing view.
        externalPosition.set(dronePosition.x * 0.32 + 46, 60, 68);
        externalTarget.lerpVectors(
          new THREE.Vector3(TARGET_BALCONY.x, TARGET_BALCONY.y + 2, TARGET_BALCONY.z),
          dronePosition,
          0.5,
        );
      }
      camera.position.copy(externalPosition);
      camera.lookAt(externalTarget);
      camera.fov = profile.exposureLevel === 'high' ? 62 : 50;
      camera.updateProjectionMatrix();
      frustum.visible = reveal;
      placeFrustum(frustum, dronePosition.clone().add(new THREE.Vector3(0, -0.9, 0)), cameraTarget);
    } else if (mode === 'resident') {
      camera.position.copy(residentEye);
      camera.lookAt(dronePosition.clone().add(new THREE.Vector3(0, -0.6, 0)));
      frustum.visible = false;
    } else {
      camera.position.copy(dronePosition).add(new THREE.Vector3(0, -0.85, 0));
      camera.lookAt(cameraTarget);
      camera.fov = 42;
      camera.updateProjectionMatrix();
      frustum.visible = false;
    }

    renderer.render(scene, camera);
  };

  const observer = new ResizeObserver(() => {
    resize();
    update(0, false);
  });
  observer.observe(host);
  resize();

  return {
    update,
    dispose: () => {
      observer.disconnect();
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

function addLighting(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xf2fbfd, 0x71847c, 3.1));
  scene.add(new THREE.AmbientLight(0xffffff, 1.35));
  const sun = new THREE.DirectionalLight(0xffe5c5, 4.6);
  sun.position.set(-90, 140, 95);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -110;
  sun.shadow.camera.right = 110;
  sun.shadow.camera.top = 110;
  sun.shadow.camera.bottom = -110;
  scene.add(sun);
}

function addEnvironment(scene: THREE.Scene) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 420),
    new THREE.MeshStandardMaterial({ color: 0x73847c, roughness: 0.98 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const towerMaterial = new THREE.MeshStandardMaterial({ color: 0xd4d5ce, roughness: 0.7 });
  const targetTower = new THREE.Mesh(new THREE.BoxGeometry(54, 68, 15), towerMaterial);
  targetTower.position.set(0, 34, -9.5);
  targetTower.castShadow = true;
  targetTower.receiveShadow = true;
  scene.add(targetTower);

  const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x355966, roughness: 0.22, metalness: 0.18 });
  for (let floor = 1; floor <= 15; floor += 1) {
    const floorY = 3.3 + floor * 4.1;
    for (let column = -5; column <= 5; column += 1) {
      if (floor === 8 && Math.abs(column) <= 1) continue;
      const window = new THREE.Mesh(new THREE.PlaneGeometry(3.25, 2.15), glassMaterial);
      window.position.set(column * 4.55, floorY, -1.94);
      scene.add(window);
    }
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(55.5, 0.22, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xaeb4ae, roughness: 0.86 }),
    );
    slab.position.set(0, floorY - 1.7, -1.4);
    scene.add(slab);
  }

  const backgroundMaterial = new THREE.MeshStandardMaterial({ color: 0xb0bbb7, roughness: 0.82 });
  for (const [x, z, width, height] of [
    [-74, -62, 35, 82],
    [64, -86, 42, 106],
    [-112, 20, 31, 58],
    [102, -16, 38, 72],
  ] as Array<[number, number, number, number]>) {
    const building = new THREE.Mesh(new THREE.BoxGeometry(width, height, 28), backgroundMaterial.clone());
    building.position.set(x, height / 2, z);
    building.castShadow = true;
    scene.add(building);
  }

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 24),
    new THREE.MeshStandardMaterial({ color: 0x46504e, roughness: 0.96 }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.12, 43);
  scene.add(road);

  addOppositeStreet(scene);
}

function addOppositeStreet(scene: THREE.Scene) {
  const facadeMaterial = new THREE.MeshStandardMaterial({
    color: 0xc7cdc8,
    emissive: 0x303a38,
    emissiveIntensity: 0.2,
    roughness: 0.76,
  });
  const oppositeBlock = new THREE.Mesh(new THREE.BoxGeometry(158, 54, 20), facadeMaterial);
  oppositeBlock.position.set(12, 27, 86);
  oppositeBlock.castShadow = true;
  oppositeBlock.receiveShadow = true;
  scene.add(oppositeBlock);

  // Shallow facade bands create depth cues at UAV-camera distance. They sit
  // clearly in front of the wall to avoid z-fighting in the compact viewport.
  const facadeBandMaterial = new THREE.MeshStandardMaterial({ color: 0x8f9d98, roughness: 0.82 });
  for (let floor = 1; floor <= 11; floor += 1) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(159, 0.22, 0.5), facadeBandMaterial);
    band.position.set(12, 5.1 + floor * 3.8, 75.55);
    scene.add(band);
  }

  const windowMaterial = new THREE.MeshStandardMaterial({
    color: 0x315866,
    emissive: 0x142d35,
    emissiveIntensity: 0.65,
    roughness: 0.22,
    metalness: 0.2,
  });
  for (let floor = 1; floor <= 11; floor += 1) {
    const y = 6.2 + floor * 3.8;
    for (let column = -15; column <= 15; column += 1) {
      const window = new THREE.Mesh(new THREE.BoxGeometry(3.05, 2.15, 0.22), windowMaterial);
      window.position.set(12 + column * 4.7, y, 75.38);
      scene.add(window);
    }
  }

  const awningColors = [0x1f6f72, 0xb34f42, 0xd19a3c, 0x35668a];
  for (let shop = -5; shop <= 5; shop += 1) {
    const storefront = new THREE.Mesh(
      new THREE.PlaneGeometry(11.2, 4.2),
      new THREE.MeshStandardMaterial({ color: 0x334d52, emissive: 0x1a292c, emissiveIntensity: 0.35 }),
    );
    storefront.position.set(12 + shop * 13.2, 3.25, 75.85);
    scene.add(storefront);
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(10.6, 0.55, 1.8),
      new THREE.MeshStandardMaterial({ color: awningColors[(shop + 8) % awningColors.length], roughness: 0.7 }),
    );
    awning.position.set(12 + shop * 13.2, 5.8, 74.95);
    awning.castShadow = true;
    scene.add(awning);
  }

  const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: 0xabb1ad, roughness: 0.95 });
  const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(190, 0.5, 13), sidewalkMaterial);
  sidewalk.position.set(8, 0.25, 64.5);
  sidewalk.receiveShadow = true;
  scene.add(sidewalk);

  const lanePaint = new THREE.MeshStandardMaterial({ color: 0xe7dfbf, roughness: 0.82 });
  for (let index = -8; index <= 8; index += 1) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.06, 0.42), lanePaint);
    dash.position.set(index * 14, 0.2, 43);
    scene.add(dash);
  }

  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x334244, roughness: 0.5, metalness: 0.58 });
  const lampMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe1a1,
    emissive: 0xffc55c,
    emissiveIntensity: 1.4,
  });
  for (const x of [-62, -18, 28, 72]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7.8, 10), poleMaterial);
    pole.position.set(x, 3.9, 59);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), lampMaterial);
    lamp.position.set(x, 7.7, 59);
    scene.add(pole, lamp);
  }

  const treeTrunk = new THREE.MeshStandardMaterial({ color: 0x655447, roughness: 1 });
  const treeCrown = new THREE.MeshStandardMaterial({ color: 0x3d7154, roughness: 0.94 });
  for (const x of [-82, -40, 6, 50, 94]) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.48, 4.6, 8), treeTrunk);
    trunk.position.set(x, 2.3, 67.5);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2.7, 1), treeCrown);
    crown.position.set(x, 6, 67.5);
    scene.add(trunk, crown);
  }
}

function createTargetBalcony() {
  const group = new THREE.Group();
  group.position.set(TARGET_BALCONY.x, TARGET_BALCONY.y, TARGET_BALCONY.z);

  const slabMaterial = new THREE.MeshStandardMaterial({ color: 0xb7b9b3, roughness: 0.85 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(13, 0.5, 5), slabMaterial);
  slab.position.set(0, -0.3, 0);
  slab.castShadow = true;
  group.add(slab);

  const railMaterial = new THREE.MeshStandardMaterial({ color: 0x39484a, roughness: 0.38, metalness: 0.64 });
  const railTop = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 13, 10), railMaterial);
  railTop.rotation.z = Math.PI / 2;
  railTop.position.set(0, 1.15, 2.1);
  group.add(railTop);
  for (let index = -6; index <= 6; index += 1) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.35, 8), railMaterial);
    post.position.set(index, 0.52, 2.1);
    group.add(post);
  }

  const planterMaterial = new THREE.MeshStandardMaterial({ color: 0x8d5f48, roughness: 0.88 });
  const plantMaterial = new THREE.MeshStandardMaterial({ color: 0x376a4d, roughness: 0.95 });
  for (const x of [-4.8, 4.7]) {
    const planter = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.75, 0.85), planterMaterial);
    planter.position.set(x, 0.18, 1.35);
    const plant = new THREE.Mesh(new THREE.IcosahedronGeometry(0.76, 1), plantMaterial);
    plant.position.set(x, 1.03, 1.35);
    group.add(planter, plant);
  }

  const resident = createResidentModel();
  resident.group.scale.setScalar(0.62);
  resident.group.position.set(0.9, 0, 0.7);
  group.add(resident.group);

  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xff725c,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const targetGlow = new THREE.Mesh(new THREE.RingGeometry(1.5, 2.05, 44), glowMaterial);
  targetGlow.position.set(0.9, 1.8, 0.54);
  targetGlow.visible = false;
  group.add(targetGlow);

  return { group, person: resident.group, phoneArm: resident.phoneArm, targetGlow };
}

function createResidentModel() {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98f70, roughness: 0.78 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x2e6673, roughness: 0.72 });
  const trousers = new THREE.MeshStandardMaterial({ color: 0x293236, roughness: 0.82 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x282321, roughness: 0.92 });
  const phone = new THREE.MeshStandardMaterial({ color: 0x151b1e, roughness: 0.32, metalness: 0.4 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.95, 6, 12), shirt);
  torso.position.y = 1.62;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 18, 12), skin);
  head.position.set(0, 2.72, 0.03);
  head.scale.set(0.92, 1.08, 0.95);
  group.add(head);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.37, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56), hair);
  hairCap.position.set(0, 2.82, 0.01);
  group.add(hairCap);

  for (const x of [-0.22, 0.22]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.8, 5, 10), trousers);
    leg.position.set(x, 0.56, 0);
    group.add(leg);
  }

  const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.72, 5, 10), skin);
  leftArm.position.set(-0.48, 1.78, 0.14);
  leftArm.rotation.z = -0.3;
  leftArm.rotation.x = -0.7;
  group.add(leftArm);

  const phoneArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.72, 5, 10), skin);
  phoneArm.position.set(0.48, 1.78, 0.16);
  phoneArm.rotation.z = 0.24;
  phoneArm.rotation.x = -0.9;
  group.add(phoneArm);
  const handset = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.42, 0.06), phone);
  handset.position.set(0.28, 1.95, 0.64);
  handset.rotation.x = -0.4;
  group.add(handset);

  return { group, phoneArm };
}

function createUavModel(appearance: EventProfile['uavAppearance']) {
  const group = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({
    color: appearance === 'police' ? 0xf2f5f4 : 0xd8dcda,
    emissive: appearance === 'police' ? 0x49646b : 0x3f4849,
    emissiveIntensity: 0.58,
    roughness: 0.34,
    metalness: 0.42,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x252e31, roughness: 0.42, metalness: 0.58 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x172f38, roughness: 0.18, metalness: 0.5 });
  const stripe = new THREE.MeshStandardMaterial({
    color: 0x1470ad,
    emissive: 0x0c4f85,
    emissiveIntensity: 1.15,
    roughness: 0.42,
    metalness: 0.28,
  });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.05, 2.4, 8, 18), shell);
  body.rotation.z = Math.PI / 2;
  body.scale.set(1, 0.72, 1.25);
  body.castShadow = true;
  group.add(body);

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.76, 18, 12), glass);
  nose.scale.set(1.2, 0.55, 0.72);
  nose.position.set(0, -0.15, 1.15);
  group.add(nose);

  if (appearance === 'police') {
    const band = new THREE.Mesh(new THREE.BoxGeometry(3.15, 0.5, 2.35), stripe);
    band.position.y = 0.08;
    group.add(band);
  }

  const rotors: THREE.Group[] = [];
  for (const [x, z] of [[-3.3, -2.8], [3.3, -2.8], [-3.3, 2.8], [3.3, 2.8]] as Array<[number, number]>) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.24, 4.4, 10), dark);
    arm.position.set(x * 0.5, 0.08, z * 0.5);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = Math.atan2(z, x);
    group.add(arm);

    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.5, 0.52, 16), dark);
    motor.position.set(x, 0.34, z);
    group.add(motor);

    const rotorGroup = new THREE.Group();
    rotorGroup.position.set(x, 0.66, z);
    for (const rotation of [0, Math.PI / 2]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.06, 0.24), dark);
      blade.rotation.y = rotation;
      rotorGroup.add(blade);
    }
    group.add(rotorGroup);
    rotors.push(rotorGroup);
  }

  for (const x of [-1.15, 1.15]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 2.1, 10), dark);
    leg.position.set(x, -1.05, 0.25);
    leg.rotation.z = x < 0 ? -0.2 : 0.2;
    group.add(leg);
  }

  const gimbal = new THREE.Group();
  gimbal.position.set(0, -1.05, 0.82);
  const gimbalRing = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.1, 10, 24), dark);
  gimbalRing.rotation.x = Math.PI / 2;
  const cameraBody = new THREE.Mesh(new THREE.SphereGeometry(0.48, 18, 12), dark);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.24, 18), glass);
  lens.rotation.x = Math.PI / 2;
  lens.position.z = 0.42;
  gimbal.add(gimbalRing, cameraBody, lens);
  group.add(gimbal);

  const policeLights: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>[] = [];
  if (appearance === 'police') {
    for (const [x, color] of [[-0.62, 0x1469ff], [0.62, 0xef3947]] as Array<[number, number]>) {
      const lightMaterial = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.4,
      });
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.38, 14, 10), lightMaterial);
      light.position.set(x, 0.92, 0);
      group.add(light);
      policeLights.push(light);
    }
  }

  group.scale.setScalar(1.04);
  return { group, rotors, gimbal, policeLights };
}

function createCameraFrustum() {
  const group = new THREE.Group();
  const depth = 58;
  const halfWidth = Math.tan(THREE.MathUtils.degToRad(34)) * depth;
  const halfHeight = halfWidth / (16 / 9);
  const corners = [
    new THREE.Vector3(-halfWidth, halfHeight, depth),
    new THREE.Vector3(halfWidth, halfHeight, depth),
    new THREE.Vector3(halfWidth, -halfHeight, depth),
    new THREE.Vector3(-halfWidth, -halfHeight, depth),
  ];
  const positions: number[] = [];
  corners.forEach((corner, index) => {
    const next = corners[(index + 1) % corners.length];
    positions.push(0, 0, 0, corner.x, corner.y, corner.z);
    positions.push(corner.x, corner.y, corner.z, next.x, next.y, next.z);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  group.add(new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0xff7a64, transparent: true, opacity: 0.76 }),
  ));
  return group;
}

function placeFrustum(frustum: THREE.Group, origin: THREE.Vector3, target: THREE.Vector3) {
  frustum.position.copy(origin);
  frustum.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    target.clone().sub(origin).normalize(),
  );
}
