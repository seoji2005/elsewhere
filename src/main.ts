import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { buildCorner } from './scene/corner';
import { buildBlock } from './scene/block';
import { buildTown } from './scene/town';
import { applyLook } from './scene/looks';
import { cornerLighting } from './render/lighting';
import { cornerAtmosphere } from './render/atmosphere';
import { adaptiveResolution } from './render/resolution';
import { CheapBloom } from './render/cheapBloom';
import { ToonEdges } from './render/outline';
import { duskLUT } from './render/duskLUT';
import { time, tone, spots } from './render/style';
import { loadCharacter } from './player/character';
import { loadAvatar } from './anime/avatar';
import { outfits, LISE_C } from './anime/wardrobe';
import { cloudCards } from './anime/clouds';
import { playerControls } from './player/controls';
import { followPlayer } from './player/player';
import { hud } from './ui/hud';
import { talkScene } from './ui/talk';
import { debugOverlay } from './ui/debug';
import { paint } from './scene/props';
import { createSession, NEW_GAME_SPEED } from './game/session';
import { localStorageAdapter } from './game/storage';
import { npcs } from './data/npcs';
import { doors as cornerDoors, townDoors } from './data/doors';
import { generate } from './sim/npcgen';
import { whereIs } from './sim/npc';
import { lifeSpots, sidewalk } from './scene/spots';
import { prepareTrial, trial, trialStorage } from './data/tycoonScenario';
import { buildTag, intro } from './ui/intro';

const query = new URLSearchParams(location.search);
// style=anime (default: VRM hero, toon city, time=day|dusk|night) or style=current (the look A/B corner as before).
const anime = query.get('style') !== 'current', day = anime && time === 'day';
const sd = ['0', '1', '2'].includes(query.get('sd') ?? '') ? Number(query.get('sd')) : 0; // user 2026-10-15: 6.5–7 heads
const look = !anime && query.get('look') === 'a' ? 'a' : 'b';
// Anime city plans (C033): toon=a hard cel with screen-space outlines (default), toon=b soft illustration.
const toon = query.get('toon') === 'b' ? 'b' : 'a';
// Phone measurement switches (?debug=1 shows fps, render height, draw calls, triangles):
// msaa=0|4, bloom=0|1, lut=0|1, shadow=off|static|dynamic, dpr=<fixed pixel ratio>.
// A switch given in the URL is left alone by the automatic quality ladder.
const msaa = Number(query.get('msaa') ?? (look === 'a' ? 4 : 0)) > 0 ? 4 : 0;
// STYLE §4: no bloom by day (threshold 99 in the time table).
const bloom = query.get('bloom') === '1' || query.get('bloom') !== '0' && !(anime && tone.bloom > 10), grade = query.get('lut') === '1' || (!anime && query.get('lut') !== '0');
const shadow = (['off', 'static', 'dynamic'] as const).find(mode => mode === query.get('shadow')) ?? 'static';
const fixedDpr = Number(query.get('dpr')) > 0 ? Math.min(4, Number(query.get('dpr'))) : undefined;
const post = look === 'b' && (bloom || grade || (anime && toon === 'a')); // A's outline pass needs the composer
const scene = new T.Scene();
const camera = new T.PerspectiveCamera(50, 1, 0.1, 400);
const renderer = new T.WebGLRenderer({ antialias: !post && msaa > 0 });
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
if (look === 'b' && !post) { // no post passes: the same Reinhard curve and exposure as duskLUT, in the materials
  renderer.toneMapping = anime ? T.NeutralToneMapping : T.ReinhardToneMapping;
  renderer.toneMappingExposure = 1.15;
}
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.domElement.style.cssText = 'display:block;width:100vw;height:100vh';
document.body.appendChild(renderer.domElement);
const block = query.get('block') === '1'; // C067: the building-kit test street instead of the corner
const town = !block && query.get('town') === '1'; // C077: the seven places on one kit block, each with its door
const doors = town ? townDoors : cornerDoors;
const [world, character] = await Promise.all([block ? buildBlock(scene) : town ? buildTown(scene) : buildCorner(scene),
  anime ? loadAvatar(camera, sd, query.get('model') === 'lise-c' ? LISE_C : outfits[0]) : loadCharacter()]);
const cast: Awaited<ReturnType<typeof loadAvatar>>[] = [];
if (anime && query.get('cast') === '1') {
  // Sequential cloning also lets every copy reuse the first copy's compact morph geometry.
  for (let i = 1; i < outfits.length; i++) cast.push(await loadAvatar(camera, sd, outfits[i], i * 0.47));
}
applyLook(scene, anime ? 'anime' : look, anime ? tone.windows : 1.6, toon);
if (day) scene.traverse(object => { if (object.name === 'glow') object.visible = false; }); // lamp bulbs and pools
// Added after the look pass so look A/B never retints the player.
scene.add(character.group);
// A static shadow map cannot follow the player: a soft contact blob grounds them instead.
const blob = shadow === 'dynamic' ? undefined : new T.Mesh(new T.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2),
  new T.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.5, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, map: paint(64, 64, g => {
      const fade = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      fade.addColorStop(0, '#fff'); fade.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = fade; g.fillRect(0, 0, 64, 64);
    }) }));
if (blob) {
  character.group.traverse(object => { object.castShadow = false; });
  scene.add(blob);
}
// The life simulation: clock, wallets, residents, shops and market; autosaves every game hour and when hidden.
// ?trial=1 (C106): a separate save (trial.*) on seed 106, prepared at 07:00 with the shop signed and opened.
const trialMode = query.get('trial') === '1';
const session = trialMode ? createSession(trialStorage(localStorageAdapter()), trial.seed, undefined, NEW_GAME_SPEED, true)
  : createSession(localStorageAdapter(), undefined, undefined, NEW_GAME_SPEED);
const newGame = session.state.world.clock.totalMinutes === 0; // C112 ⑦: a new game (trial too) opens the 결폰 on 내 가게
const fresh = trialMode && prepareTrial(session);
const player = session.state.player;
character.group.position.set(player.x, 0, player.z);
character.group.rotation.y = player.direction;
if (block) character.group.position.set(-16, 0, -7); // south sidewalk, between the shops
if (town) character.group.position.set(-24.5, 0, -6.6); // south sidewalk between 빛고리 조율실 and 모아결 교환소
let origin = doors.find(d => d.placeId === player.placeId)?.position ?? { x: player.x, z: player.z };
function syncPosition() {
  const at = character.group.position;
  Object.assign(player, { x: at.x, z: at.z, direction: character.group.rotation.y });
  if (player.placeId !== 'street' && Math.hypot(at.x - origin.x, at.z - origin.z) > 6) {
    player.placeId = 'street';
    session.state.world.people.player.placeId = 'street';
  }
}
const residents = [...npcs, ...generate(session.state.npcSeed, 50)];
// Face-to-face dialogue: the resident's avatar steps in front of the player and the camera eases into a close-up.
const talk = talkScene(session, scene, character.group, world.solids,
  anime ? outfit => loadAvatar(camera, sd, outfit) : undefined, () => ui.open('people'));
const ui = hud(session, residents, {
  sync: syncPosition, talk: npc => { void talk.start(npc); }, warm: talk.warm,
  move(placeId) {
    const pose = doors.find(d => d.placeId === placeId)?.position;
    if (pose) { character.group.position.set(pose.x, 0, pose.z); character.group.rotation.y = pose.yaw; }
    origin = { x: character.group.position.x, z: character.group.position.z };
  },
});
if (!session.loadResult.ok) ui.say('저장이 손상돼 새로 시작했어요');
if (newGame) ui.home();
if (fresh) ui.open('', 'shop'); // the new trial starts at the shop's door
buildTag();
const guide = fresh ? intro() : undefined;
addEventListener('visibilitychange', () => { if (document.hidden) { syncPosition(); session.saveNow(); } });
const [phoneTab, phonePlace] = (query.get('phone') ?? '').split(',');
if (phoneTab) ui.open(phoneTab, phonePlace);
// ?talk=<placeId>[,<npcId>] (screenshots): go there and open the dialogue with that or the first resident present.
const [talkPlace, talkNpc] = (query.get('talk') ?? '').split(',');
if (talkPlace) {
  ui.open('', talkPlace);
  const here = residents.filter(n => session.state.world.people[n.id]?.placeId === session.state.player.placeId);
  const npc = here.find(n => n.id === talkNpc) ?? here[0];
  if (npc) await talk.start(npc, true);
}
const controls = playerControls(renderer.domElement, ui.stick, ui.knob);
// ?cast=1: the player waits on the zebra crossing; the six residents take the street's life spots (C083) by where
// their schedule puts them at this light's hour (day 14:00, dusk 18:00, night 21:00); off-street residents stop to chat.
const stage = new T.Vector3(-6.3, 0, -2.2), yaw = controls.state.yaw, hour = { day: 14, dusk: 18, night: 21 }[time];
if (cast.length) { character.group.position.copy(stage); character.group.rotation.y = yaw; }
const free = [...lifeSpots];
cast.forEach((person, i) => {
  const place = whereIs(npcs[i % npcs.length], { day: 1, hour, minute: 0 });
  const spot = free.find(s => s.places.includes(place)) ?? free.find(s => s.kind === 'talk') ?? free[0];
  free.splice(free.indexOf(spot), 1);
  person.group.position.set(spot.x, sidewalk, spot.z);
  person.group.rotation.y = spot.yaw;
  person.act(spot.kind, spot.seat);
  scene.add(person.group);
});
if (blob) cast.forEach(person => {
  const contact = blob.clone();
  contact.position.copy(person.group.position).setY(person.group.position.y + 0.02);
  scene.add(contact);
});
// Comparison shots: ?dist=3.5&pitch=0.25 start view (close-up, sky in view); ?move=-0.5|-1 walks / runs toward the camera.
// Anime default (STYLE §7): eye-level street walk, 7 m back and 14° down, the upper third sky and rooftops.
controls.state.dist = Number(query.get('dist')) || (anime ? 7 : controls.state.dist);
controls.state.pitch = Number(query.get('pitch')) || (anime ? 0.25 : controls.state.pitch);
// ?spot=A..E (STYLE §7 presets for photos and the §9 sheet): the player stands there and the camera holds the
// preset view until the stick or an orbit drag moves.
const spot = anime ? spots[query.get('spot') ?? ''] : undefined, startYaw = controls.state.yaw;
let held = !!spot;
if (spot) { character.group.position.set(spot.at[0], 0, spot.at[1]); character.group.rotation.y = spot.at[2]; }
const move = Number(query.get('move')) || 0;
const follow = followPlayer(character.group, camera, world,
  anime ? (character as Awaited<ReturnType<typeof loadAvatar>>).focusHeight : 1.4);
// Anime: the sun comes from behind the default view, so the façades in sight are lit and shadows fall away.
const sunElevation = anime ? tone.elevation : 11, toSun = new T.Vector3(...anime ? [0.45, 0, 0.9] : [-0.8, 0, 0.6]);
toSun.y = Math.tan(sunElevation * Math.PI / 180) * Math.hypot(toSun.x, toSun.z);
const lighting = cornerLighting(scene, renderer, new T.Vector3(-8, 0, -10), 22, 1024, shadow, toSun); // follows the player
lighting.fill.intensity = look === 'a' ? 0.85 : 1.7;
if (anime) { // STYLE §2: afternoon sun over a sky-blue fill, low orange sun under lavender, or moon only at night
  lighting.sun.color.copy(tone.sun);
  lighting.sun.intensity = tone.power;
  lighting.fill.color.copy(tone.fill[0]);
  lighting.fill.groundColor.copy(tone.fill[1]);
  lighting.fill.intensity = tone.fillPower;
}
if (look === 'b' && !(anime && toon === 'a')) { // cool sky bounce from the side away from the sun (not in the two-step cel)
  const bounce = new T.DirectionalLight('#8fa5d9', 0.8);
  bounce.position.set(0.55, 0.6, -0.6);
  scene.add(bounce);
}
// Sky gradient: zenith, horizon (= fog), band above the horizon, sun glow.
const [top, horizon, band, glow] = anime ? [tone.sky[0], tone.sky[2], tone.sky[1], tone.glow] : [look === 'a' ? '#7296bd' : '#33497d', look === 'a' ? '#d9b499' : '#cfa898',
  '#9c84b0', '#ff9a52'];
cornerAtmosphere(scene, horizon, 48, 155);
const sky = new T.Mesh(new T.SphereGeometry(300, 48, 24), new T.ShaderMaterial({
  side: T.BackSide, depthWrite: false,
  uniforms: { top: { value: new T.Color(top) }, horizon: { value: new T.Color(horizon) },
    band: { value: new T.Color(band) }, glow: { value: new T.Color(glow) },
    sun: { value: lighting.sun.position.clone().sub(lighting.sun.target.position).normalize() } },
  vertexShader: 'varying vec3 dir; void main(){dir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  // B: horizon (= fog colour) -> lavender band -> deep blue zenith, warm glow toward the sun, dithered.
  fragmentShader: `varying vec3 dir; uniform vec3 top,horizon,band,glow,sun;
    void main(){vec3 d=normalize(dir);
    ${look === 'a' ? 'vec3 c=mix(horizon,top,smoothstep(0.,.75,d.y));' : `float h=max(d.y,0.),s=max(dot(d,sun),0.);
    vec3 c=mix(mix(horizon,band,smoothstep(0.,${anime ? '.06' : '.22'},h)),top,smoothstep(${anime ? '.06,.2' : '.1,.5'},h));
    c+=glow*(.7*pow(s,4.)+1.4*pow(s,60.))*smoothstep(0.,.07,h)*(1.-smoothstep(.05,.4,h));
    c+=(fract(sin(dot(gl_FragCoord.xy,vec2(12.99,78.23)))*43758.5)-.5)/255.;`}
    gl_FragColor=vec4(c,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`,
}));
sky.frustumCulled = false;
scene.add(sky);
if (anime) sky.add(cloudCards(tone.clouds));
if (look === 'a') {
  const pmrem = new T.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  scene.environmentIntensity = 0.35;
  room.dispose(); pmrem.dispose();
}
// Look B post: HDR scene (no MSAA by default; the high pixel ratio keeps edges clean) -> quarter-res bloom
// (windows, lamps) -> one full-screen pass: add glow, tone map, dusk LUT grade, sRGB to the screen.
const edges = anime && toon === 'a' ? new ToonEdges(camera) : undefined; // reads the scene depth, so the scene target keeps a depth texture
edges?.material.uniforms.ink.value.copy(tone.ink);
const composer = post ? new EffectComposer(renderer, new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: msaa,
  ...(edges ? { depthTexture: new T.DepthTexture(1, 1) } : {}) })) : undefined;
// The composer clones the target, and clones share one GL texture (same Source): the edge pass would then write into
// the buffer whose depth it samples. Only the scene buffer (renderTarget2, two swaps per frame) keeps the depth texture.
if (composer && edges) composer.renderTarget1.depthTexture = null;
const bloomPass = post && bloom ? new CheapBloom(0.25) : undefined, finalPass = post ? duskLUT(16, grade) : undefined;
if (composer && finalPass) {
  renderer.toneMapping = T.NoToneMapping; // the LUT pass compresses HDR itself
  [new RenderPass(scene, camera), bloomPass, edges, finalPass].forEach(pass => pass && composer.addPass(pass));
  finalPass.glow(bloomPass?.glow ?? null);
  // Lit white cloth and plaster peak near 1.2 (HDR): only lamps, lit windows and neon pass 1.4 (STYLE §4 bloom).
  if (anime && bloomPass) bloomPass.material.uniforms.threshold.value = tone.bloom;
  if (anime) { finalPass.material.defines.NEUTRAL = ''; finalPass.uniforms.exposure.value = 1; }
}
renderer.info.autoReset = false; // keep whole-frame counts for diagnostics
// Automatic quality, cheapest loss first: bloom 1/8 res -> bloom off -> shadow 512 -> pixel ratio down to 1.6.
const steps: ((cheaper: boolean) => void)[] = [];
if (bloomPass && finalPass && !query.has('bloom')) steps.push(cheaper => bloomPass.setScale(cheaper ? 0.125 : 0.25),
  cheaper => { bloomPass.enabled = !cheaper; finalPass.glow(cheaper ? null : bloomPass.glow); });
if (shadow !== 'off' && !query.has('shadow')) steps.push(cheaper => lighting.setMapSize(cheaper ? 512 : 1024));
const resolution = adaptiveResolution(renderer, fixedDpr, (dpr, width, height) => {
  composer?.setPixelRatio(dpr); composer?.setSize(width, height);
}, steps, fixedDpr);
const debug = query.get('debug') === '1' ? debugOverlay(renderer, () => `q${resolution.level} dpr ${renderer
  .getPixelRatio().toFixed(2)} msaa ${msaa}\nbloom ${bloomPass?.enabled ? 1 : 0} lut ${post && grade ? 1 : 0} `
  + `shadow ${shadow} ${lighting.sun.shadow.mapSize.x}`) : undefined;
function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1 ? 54 : 38; // telephoto: less perspective distortion, buildings packed like an illustration
  camera.updateProjectionMatrix();
  resolution.resize(innerWidth, innerHeight);
}
window.addEventListener('resize', resize);
resize();
let previous = performance.now(), positionElapsed = 0, status = { speed: 0, near: false };
renderer.setAnimationLoop(now => {
  const dt = (now - previous) / 1000;
  resolution.sample(dt); previous = now;
  const input = talk.active() ? { x: 0, y: 0 } : move ? { x: 0, y: move } : controls.stickInput();
  status = follow(Math.min(dt, 0.1), input, controls.state, talk.closeup());
  held &&= !input.x && !input.y && controls.state.yaw === startYaw && !talk.active();
  if (held && spot) { camera.position.set(...spot.eye); camera.lookAt(...spot.aim); }
  talk.update(dt);
  lighting.follow(character.group.position);
  character.update(status.speed, Math.min(dt, 0.1));
  const at = character.group.position; // only the two hero shops have a sim door; other façades stay closed
  ui.door(status.near ? doors.find(door => Math.hypot(door.position.x - at.x, door.position.z - at.z) < 3) : undefined);
  positionElapsed += dt;
  if (positionElapsed >= 0.2) { syncPosition(); positionElapsed = 0; }
  const reading = talk.active() || ui.reading() || !!guide?.open(); // GDD §2: no time pressure while reading
  ui.paused(reading);
  if (session.tick(reading ? 0 : Math.max(0, Math.min(dt, 5)))?.ok === false) ui.say('저장하지 못했어요');
  cast.forEach(person => person.update(0, Math.min(dt, 0.1)));
  sky.position.copy(camera.position);
  blob?.position.copy(character.group.position).setY(character.group.position.y + 0.02);
  renderer.info.reset();
  if (composer) composer.render(); else renderer.render(scene, camera);
  debug?.frame(dt);
  if (!renderer.domElement.dataset.ready) ui.ready();
  renderer.domElement.dataset.ready = 'true';
});
// Read-only diagnostics for browser verification and tests/play.
Object.assign(window, { cornerDiagnostics: () => ({ look, toon, style: anime ? 'anime' : 'current', day, ...renderer.info.render,
  sd: anime ? sd : 0, cast: cast.length, outfits: cast.map(person => person.group.name), life: cast.map(person => person.activity()),
  memory: renderer.info.memory, dpr: renderer.getPixelRatio(), shadow, shadowSize: lighting.sun.shadow.mapSize.x,
  quality: resolution.level, passes: composer?.passes.filter(pass => pass.enabled).length ?? 0, camera: camera.position.toArray(),
  time, spot: held ? query.get('spot') : '', sunElevation, cornerDistance: Math.hypot(camera.position.x, camera.position.z),
  player: character.group.position.toArray(), place: session.state.player.placeId, ...status }) });
