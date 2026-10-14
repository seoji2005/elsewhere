// from research R001
import { DirectionalLight, HemisphereLight, PCFSoftShadowMap,
  Scene, Vector3, WebGLRenderer } from 'three';

// Original implementation; distances assume roughly one world unit per metre.
export function cornerLighting(scene: Scene, renderer: WebGLRenderer,
  center = new Vector3(), radius = 14, mapSize: 512 | 1024 = 512) {
  const previous = { enabled: renderer.shadowMap.enabled,
    type: renderer.shadowMap.type };
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  const fill = new HemisphereLight('#b9d4e5', '#655447', 0.8);
  const sun = new DirectionalLight('#ffe0b2', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mapSize, mapSize);
  Object.assign(sun.shadow.camera, { left: -radius, right: radius,
    top: radius, bottom: -radius, near: 1, far: radius * 6 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.04;
  const offset = new Vector3(1, 1.6, 0.7).normalize().multiplyScalar(radius * 3);
  function update(target: Vector3) {
    sun.target.position.copy(target);
    sun.position.copy(target).add(offset);
    sun.target.updateMatrixWorld();
  }
  scene.add(fill, sun, sun.target);
  update(center);
  return { sun, fill, update, dispose() {
    scene.remove(fill, sun, sun.target);
    sun.dispose();
    fill.dispose();
    renderer.shadowMap.enabled = previous.enabled;
    renderer.shadowMap.type = previous.type;
  } };
}
