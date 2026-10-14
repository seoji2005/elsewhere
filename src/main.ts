import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildCorner } from './scene/corner';
import { applyLook } from './scene/looks';
import { cornerLighting } from './render/lighting';
import { cornerAtmosphere } from './render/atmosphere';
import { adaptiveResolution } from './render/resolution';
import { CheapBloom } from './render/cheapBloom';
import { duskLUT } from './render/duskLUT';
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
lighting.fill.intensity = look === 'a' ? 0.85 : 1.7;
if (look === 'b') { // cool sky bounce from the side away from the sun, so façades facing different ways read apart
  const bounce = new T.DirectionalLight('#8fa5d9', 0.8);
  bounce.position.set(0.55, 0.6, -0.6);
  scene.add(bounce);
}
const horizon = look === 'a' ? '#d9b499' : '#cfa898';
cornerAtmosphere(scene, horizon, 48, 155);
const sky = new T.Mesh(new T.SphereGeometry(300, 48, 24), new T.ShaderMaterial({
  side: T.BackSide, depthWrite: false,
  uniforms: { top: { value: new T.Color(look === 'a' ? '#7296bd' : '#33497d') }, horizon: { value: new T.Color(horizon) },
    band: { value: new T.Color('#9c84b0') }, glow: { value: new T.Color('#ff9a52') },
    sun: { value: lighting.sun.position.clone().sub(lighting.sun.target.position).normalize() } },
  vertexShader: 'varying vec3 dir; void main(){dir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  // B: horizon (= fog colour) -> lavender band -> deep blue zenith, warm glow toward the sun, dithered.
  fragmentShader: `varying vec3 dir; uniform vec3 top,horizon,band,glow,sun;
    void main(){vec3 d=normalize(dir);
    ${look === 'a' ? 'vec3 c=mix(horizon,top,smoothstep(0.,.75,d.y));' : `float h=max(d.y,0.),s=max(dot(d,sun),0.);
    vec3 c=mix(mix(horizon,band,smoothstep(0.,.22,h)),top,smoothstep(.1,.5,h));
    c+=glow*(.7*pow(s,4.)+1.4*pow(s,60.))*smoothstep(0.,.07,h)*(1.-smoothstep(.05,.4,h));
    c+=(fract(sin(dot(gl_FragCoord.xy,vec2(12.99,78.23)))*43758.5)-.5)/255.;`}
    gl_FragColor=vec4(c,1.);
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
// Look B post: HDR scene with MSAA -> half-res bloom (windows, lamps) -> dusk LUT (tone map + grade) -> sRGB.
const composer = look === 'b' ? new EffectComposer(renderer,
  new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: 4 })) : undefined;
if (composer) {
  renderer.toneMapping = T.NoToneMapping; // the LUT pass compresses HDR itself
  [new RenderPass(scene, camera), new CheapBloom(0.5), duskLUT(), new OutputPass()].forEach(pass => composer.addPass(pass));
  renderer.info.autoReset = false; // keep whole-frame counts for diagnostics
}
const resolution = adaptiveResolution(renderer, undefined, (dpr, width, height) => {
  composer?.setPixelRatio(dpr); composer?.setSize(width, height);
});
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
  if (composer) { renderer.info.reset(); composer.render(); } else renderer.render(scene, camera);
  if (!renderer.domElement.dataset.ready) ui.ready();
  renderer.domElement.dataset.ready = 'true';
});
// Read-only diagnostics for browser verification and tests/play.
Object.assign(window, { cornerDiagnostics: () => ({ look, ...renderer.info.render,
  memory: renderer.info.memory, dpr: renderer.getPixelRatio(), shadow: 1024, camera: camera.position.toArray(),
  sunElevation: 11, cornerDistance: Math.hypot(camera.position.x, camera.position.z),
  player: character.group.position.toArray(), ...status }) });
