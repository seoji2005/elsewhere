// from research R001
import { DirectionalLight, HemisphereLight, PCFShadowMap,
  Scene, Vector3, WebGLRenderer } from 'three';

// Original implementation; distances assume roughly one world unit per metre.
// static: the shadow map is drawn once and again only after update() or setMapSize() (sun or scene changed).
// The shadow camera is small (22 m radius in main.ts, 6x the texel density of the old 55 m) and follows the player
// in follow(), moving in whole texel steps so shadow edges never shimmer while walking.
export function cornerLighting(scene: Scene, renderer: WebGLRenderer,
  center = new Vector3(), radius = 14, mapSize = 512, mode: 'off' | 'static' | 'dynamic' = 'dynamic',
  toSun = new Vector3(-0.8, Math.tan(11 * Math.PI / 180), 0.6)) {
  const previous = { enabled: renderer.shadowMap.enabled,
    type: renderer.shadowMap.type, autoUpdate: renderer.shadowMap.autoUpdate };
  renderer.shadowMap.enabled = mode !== 'off';
  renderer.shadowMap.type = PCFShadowMap; // PCFSoft costs more taps per pixel on phones
  renderer.shadowMap.autoUpdate = mode === 'dynamic';
  const fill = new HemisphereLight('#92b7e5', '#64504a', 0.8);
  const sun = new DirectionalLight('#ffbc7e', 2.8);
  sun.castShadow = mode !== 'off';
  sun.shadow.mapSize.set(mapSize, mapSize);
  Object.assign(sun.shadow.camera, { left: -radius, right: radius,
    top: radius, bottom: -radius, near: 1, far: radius * 6 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.04;
  const offset = toSun.clone().normalize().multiplyScalar(radius * 3);
  function update(target: Vector3) {
    // Snap to a multiple of four texels (the same grid after a 1024 <-> 512 quality switch).
    const step = Math.max(0.05, (radius * 2) / sun.shadow.mapSize.x * 4);
    sun.target.position.set(Math.round(target.x / step) * step, 0, Math.round(target.z / step) * step);
    sun.position.copy(sun.target.position).add(offset);
    sun.target.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
  }
  // Re-centre once the player is 4 m from the last centre; a static map is redrawn only then.
  function follow(playerPos: Vector3) {
    const dx = playerPos.x - sun.target.position.x, dz = playerPos.z - sun.target.position.z;
    if (mode !== 'off' && dx * dx + dz * dz > 16) update(playerPos);
  }
  function setMapSize(size: number) {
    if (sun.shadow.mapSize.x === size) return;
    sun.shadow.mapSize.set(size, size);
    sun.shadow.map?.dispose();
    sun.shadow.map = null; // recreated at the new size on the next shadow render
    renderer.shadowMap.needsUpdate = true;
  }
  scene.add(fill, sun, sun.target);
  update(center);
  return { sun, fill, update, follow, setMapSize, dispose() {
    scene.remove(fill, sun, sun.target);
    sun.dispose();
    fill.dispose();
    renderer.shadowMap.enabled = previous.enabled;
    renderer.shadowMap.type = previous.type;
    renderer.shadowMap.autoUpdate = previous.autoUpdate;
  } };
}
