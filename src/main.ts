import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildCorner } from './scene/corner';
import { applyLook } from './scene/looks';
import { cornerLighting } from './render/lighting';
import { cornerAtmosphere } from './render/atmosphere';
import { adaptiveResolution } from './render/resolution';
import { loadCharacter } from './player/character';
import { playerControls } from './player/controls';
import { followPlayer } from './player/player';
import { hud } from './ui/hud';

const look = new URLSearchParams(location.search).get('look') === 'a' ? 'a' : 'b';
const scene = new T.Scene();
const camera = new T.PerspectiveCamera(50, 1, 0.1, 400);
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.domElement.style.cssText = 'display:block;width:100vw;height:100vh';
document.body.appendChild(renderer.domElement);
const [world, character] = await Promise.all([buildCorner(scene), loadCharacter()]);
applyLook(scene, look);
// Added after the look pass so look A/B never retints the player.
character.group.position.set(-7, 0, -6);
scene.add(character.group);
const ui = hud();
const controls = playerControls(renderer.domElement, ui.stick, ui.knob);
const follow = followPlayer(character.group, camera, world);
const lighting = cornerLighting(scene, renderer, new T.Vector3(-8, 0, -10), 55, 1024);
lighting.fill.intensity = look === 'a' ? 0.85 : 1.05;
const horizon = look === 'a' ? '#d9b499' : '#c6b5b2';
cornerAtmosphere(scene, horizon, 48, 155);
const sky = new T.Mesh(new T.SphereGeometry(300, 48, 24), new T.ShaderMaterial({
  side: T.BackSide, depthWrite: false,
  uniforms: { top: { value: new T.Color('#7296bd') }, horizon: { value: new T.Color(horizon) } },
  vertexShader: 'varying vec3 dir; void main(){dir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `varying vec3 dir; uniform vec3 top,horizon;
    void main(){gl_FragColor=vec4(mix(horizon,top,smoothstep(0.,.75,normalize(dir).y)),1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`,
}));
sky.frustumCulled = false;
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
  camera.fov = camera.aspect < 1 ? 70 : 50;
  camera.updateProjectionMatrix();
  resolution.resize(innerWidth, innerHeight);
}
window.addEventListener('resize', resize);
resize();
let previous = performance.now(), status = { speed: 0, near: false };
renderer.setAnimationLoop(now => {
  const dt = (now - previous) / 1000;
  resolution.sample(dt); previous = now;
  status = follow(Math.min(dt, 0.1), controls.stickInput(), controls.state);
  character.update(status.speed, Math.min(dt, 0.1));
  ui.door(status.near);
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
  if (!renderer.domElement.dataset.ready) ui.ready();
  renderer.domElement.dataset.ready = 'true';
});
// Read-only diagnostics for browser verification and tests/play.
Object.assign(window, { cornerDiagnostics: () => ({ look, ...renderer.info.render,
  memory: renderer.info.memory, dpr: renderer.getPixelRatio(), shadow: 1024, camera: camera.position.toArray(),
  sunElevation: 11, cornerDistance: Math.hypot(camera.position.x, camera.position.z),
  player: character.group.position.toArray(), ...status }) });
