import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildCorner } from './scene/corner';
import { applyLook } from './scene/looks';
import { cornerLighting } from './render/lighting';
import { cornerAtmosphere } from './render/atmosphere';
import { adaptiveResolution } from './render/resolution';

const look = new URLSearchParams(location.search).get('look') === 'b' ? 'b' : 'a';
const scene = new T.Scene();
const camera = new T.PerspectiveCamera(40, 1, 0.1, 180);
const focus = new T.Vector3(-11, 3, -7);
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.domElement.style.cssText = 'display:block;width:100vw;height:100vh';
document.body.appendChild(renderer.domElement);
await buildCorner(scene);
applyLook(scene, look);
const lighting = cornerLighting(scene, renderer, new T.Vector3(-12, 0, -10), 26, 1024);
lighting.sun.position.set(-32, 24, 18);
lighting.fill.intensity = 1.15;
cornerAtmosphere(scene, look === 'a' ? '#bdc8d6' : '#c9c8d3', 65, 145);
const sky = new T.Mesh(new T.SphereGeometry(160, 24, 12), new T.ShaderMaterial({
  side: T.BackSide, depthWrite: false,
  uniforms: { top: { value: new T.Color('#7296bd') }, horizon: { value: new T.Color('#e8c7a9') } },
  vertexShader: 'varying vec3 dir; void main(){dir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `varying vec3 dir; uniform vec3 top,horizon;
    void main(){gl_FragColor=vec4(mix(horizon,top,smoothstep(-.3,.8,normalize(dir).y)),1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`,
}));
scene.add(sky);
if (look === 'a') {
  const pmrem = new T.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  scene.environmentIntensity = 0.35;
  room.dispose(); pmrem.dispose();
}
const resolution = adaptiveResolution(renderer);
function resize() {
  camera.aspect = innerWidth / innerHeight;
  const distance = Math.max(1, 1.7 / camera.aspect);
  camera.position.copy(focus).add(new T.Vector3(32, 29, 42).multiplyScalar(distance));
  camera.lookAt(focus); camera.updateProjectionMatrix();
  resolution.resize(innerWidth, innerHeight);
}
window.addEventListener('resize', resize);
resize();
let previous = performance.now();
renderer.setAnimationLoop(now => {
  resolution.sample((now - previous) / 1000); previous = now;
  renderer.render(scene, camera);
  renderer.domElement.dataset.ready = 'true';
});
// Read-only diagnostics for browser verification; no in-game UI.
Object.assign(window, { cornerDiagnostics: () => ({ look, ...renderer.info.render,
  memory: renderer.info.memory, dpr: renderer.getPixelRatio(), shadow: 1024 }) });
