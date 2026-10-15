import * as T from 'three';
import type { loadAvatar } from '../anime/avatar';
import { outfits, type Outfit } from '../anime/wardrobe';
import type { Npc } from '../data/npcs';
import type { DialogueChoice } from '../sim/relationship';
import type { createSession } from '../game/session';
import type { Closeup } from '../player/player';

type Session = ReturnType<typeof createSession>;
type Avatar = Awaited<ReturnType<typeof loadAvatar>>;
type Stand = { avatar: Avatar; height: number; happy?: T.Object3D & { weight: number; applyWeight(): void } };
const SPEED = 30; // typed characters per second

// Outfit by job keyword (uniforms read at a glance), otherwise a stable pick per resident id.
function outfitFor(npc: Npc): Outfit {
  const name = /조율/.test(npc.job) ? '조율사' : /차|찻/.test(npc.job) ? '카페 점원' : /기록|순환|사무|거래/.test(npc.job) ? '사무직'
    : npc.traits.includes('social') ? '사교형' : '';
  const hash = [...npc.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return outfits.find(o => o.name === name) ?? outfits[1 + hash % (outfits.length - 1)];
}
// Stay next to the player, with a nearby façade behind the resident instead of the empty road horizon.
function spot(player: T.Object3D, solids: T.Box3[]) {
  const { x, z } = player.position;
  const buildings = solids.filter(box => box.max.y - box.min.y > 3);
  const distance = (box: T.Box3) => Math.hypot(x - T.MathUtils.clamp(x, box.min.x, box.max.x),
    z - T.MathUtils.clamp(z, box.min.z, box.max.z));
  const backdrop = buildings.reduce<T.Box3 | undefined>((near, box) => !near || distance(box) < distance(near) ? box : near, undefined);
  const centre = backdrop?.getCenter(new T.Vector3());
  const yaw = centre ? Math.atan2(centre.x - x, centre.z - z) : player.rotation.y;
  const at = (turn: number, gap: number) => new T.Vector3(x + Math.sin(yaw + turn) * gap, 0, z + Math.cos(yaw + turn) * gap);
  const options = [Math.PI / 2, -Math.PI / 2, 0, 0.5, -0.5, 0.9, -0.9, Math.PI].flatMap(turn => [at(turn, 1.6), at(turn, 1.3)]);
  const p = options.find(v => Math.abs(v.x) < 46 && Math.abs(v.z) < 46 && solids.every(box =>
    Math.hypot(v.x - T.MathUtils.clamp(v.x, box.min.x, box.max.x), v.z - T.MathUtils.clamp(v.z, box.min.z, box.max.z)) > 0.35));
  if (!p) return;
  p.setY(Math.abs(p.x) > 5 && Math.abs(p.z) > 5 ? 0.11 : 0);
  return { at: p, facing: centre ? Math.atan2(p.x - centre.x, p.z - centre.z) : Math.atan2(x - p.x, z - p.z) };
}
// Half-body framing (residents are ~0.8 m chibi figures with big heads): the camera stands at eye level a little to
// the side for a three-quarter view, far enough that head to waist plus some headroom fill the height, and the aim is
// shifted so the resident sits in the left third, clear of the dialogue box and choices on the right.
function frame(at: T.Vector3, facing: number, height: number): Closeup {
  const dir = new T.Vector3(Math.sin(facing + 0.2), 0, Math.cos(facing + 0.2)), side = new T.Vector3(dir.z, 0, -dir.x);
  const distance = height * 1.15;
  // NDC x=-0.55 is about the middle of the left third. Shift the aim only, keeping the eye in front of the resident.
  const shift = innerWidth > innerHeight ? distance * Math.tan(T.MathUtils.degToRad(25)) * innerWidth / innerHeight * 0.55 : 0;
  const aim = at.clone().addScaledVector(side, shift).setY(at.y + height * 0.66);
  return { aim, eye: at.clone().addScaledVector(dir, distance).setY(at.y + height * 0.74) };
}

// Dialogue scene: the chosen resident steps in front of the player (their own avatar), the camera eases into a
// half-body close-up, and a dialogue box types the line, offers topics and plays the reply. Outside tap or 그만 ends it.
export function talkScene(session: Session, scene: T.Scene, player: T.Object3D, solids: T.Box3[],
  spawn: ((outfit: Outfit) => Promise<Avatar>) | undefined, onEnd: () => void) {
  const make = (className: string, parent: HTMLElement, tag = 'div', text = '') => {
    const element = document.createElement(tag);
    element.className = className; element.textContent = text;
    parent.append(element);
    return element;
  };
  const overlay = make('talk', document.body), column = make('talk-column', overlay);
  const choiceBox = make('talk-choices', column), box = make('talk-box', column);
  const name = make('talk-name', box), label = make('', name, 'b'), sub = make('talk-sub', name, 'span'), text = make('talk-text', box);
  overlay.hidden = choiceBox.hidden = true;
  const stands = new Map<string, Promise<Stand | undefined>>();
  let npc: Npc | undefined, stand: Stand | undefined, closeup: Closeup | undefined, options: DialogueChoice[] = [];
  let full = '', elapsed = 0, typing = false, reply = false, instant = false, time = 0, cheer = 0, run = 0;
  let mood = { level: 0, until: 0 };
  const uid = (kind: string) => `${kind}:player:${Math.floor(session.state.world.clock.totalMinutes)}:${Math.random().toString(36).slice(2, 8)}`;
  const stageName = (id: string) => { try { const s = session.stageFor(id); return s === '연인 첫 단계' ? '연인' : s; } catch { return ''; } };
  const say = (line: string, feeling: number, result = false) => {
    full = line; elapsed = 0; typing = true; reply = result; choiceBox.hidden = true; box.dataset.next = '';
    text.textContent = instant ? full : '';
    mood = { level: feeling, until: time + 2.8 };
  };
  const finish = () => {
    typing = false; text.textContent = full;
    box.dataset.next = reply ? '탭해서 계속' : '';
    if (reply) return;
    choiceBox.replaceChildren();
    for (const choice of options) make('talk-choice', choiceBox, 'button', choice.topic).onclick = () => pick(choice);
    make('talk-choice end', choiceBox, 'button', '그만').onclick = end;
    choiceBox.hidden = false;
  };
  function pick(choice: DialogueChoice) {
    if (!npc || typing || reply) return;
    try {
      const { entry, line } = session.talk(uid('chat'), npc.id, choice);
      say(line, entry.change > 0 ? 0.6 : 0, true);
      sub.textContent = ` ${npc.job} · ${stageName(npc.id)}`;
    } catch { options = []; say(`${npc.name} 님은 지금 이야기할 수 없어요.`, 0, true); }
    session.saveNow();
  }
  // One avatar per outfit, kept for the next dialogue; its standing height (precise, skinned bounds once) sets the framing.
  const standFor = (outfit: Outfit) => stands.get(outfit.name) ?? stands.set(outfit.name, spawn!(outfit).then(avatar => {
    avatar.update(0, 0); avatar.group.updateMatrixWorld(true);
    avatar.group.traverse(object => { if (object instanceof T.SkinnedMesh) object.skeleton.update(); });
    const height = new T.Box3().setFromObject(avatar.group, true).getSize(new T.Vector3()).y;
    const happy = avatar.group.getObjectByName('VRMExpression_happy') as Stand['happy'];
    return { avatar, height, happy };
  }).catch(() => { stands.delete(outfit.name); return undefined; })).get(outfit.name)!;
  const warm = (who: Npc) => { if (spawn) void standFor(outfitFor(who)); };
  async function start(who: Npc, atOnce = false) {
    if (npc) end();
    const token = ++run;
    npc = who; instant = atOnce;
    cheer = 0;
    overlay.dataset.closeup = 'false';
    document.body.classList.add('talking');
    overlay.hidden = false;
    requestAnimationFrame(() => { if (run === token && npc) overlay.classList.add('show'); });
    label.textContent = who.name;
    sub.textContent = ` ${who.job} · ${stageName(who.id)}`;
    try { const opening = session.buildDialogue(who.id); options = opening.choices; say(opening.line, 0.35); }
    catch { options = []; say(`${who.name} 님이 고개를 끄덕여요.`, 0); }
    if (!spawn) return; // legacy look: dialogue only
    const placement = spot(player, solids);
    if (!placement) return;
    const { at, facing } = placement;
    const loading = standFor(outfitFor(who));
    const ready = atOnce ? await loading : await Promise.race([loading,
      new Promise<undefined>(resolve => setTimeout(resolve, 200))]);
    if (run !== token || !npc || !ready) return; // dialogue only if the avatar is late
    player.rotation.y = Math.atan2(at.x - player.position.x, at.z - player.position.z);
    stand = ready;
    stand.avatar.group.position.copy(at);
    stand.avatar.group.rotation.y = facing;
    scene.add(stand.avatar.group);
    closeup = frame(at, facing, stand.height);
    overlay.dataset.closeup = 'true';
  }
  function end() {
    if (!npc) return;
    run++; npc = undefined; closeup = undefined; typing = false; options = [];
    if (stand) { scene.remove(stand.avatar.group); stand = undefined; }
    overlay.hidden = true; overlay.classList.remove('show'); choiceBox.hidden = true;
    document.body.classList.remove('talking');
    onEnd();
  }
  box.onclick = () => { if (typing) finish(); else if (reply) { reply = false; finish(); } };
  overlay.onclick = event => { if (event.target === overlay) end(); };
  addEventListener('resize', () => {
    if (stand) closeup = frame(stand.avatar.group.position, stand.avatar.group.rotation.y, stand.height);
  });
  return { start, end, warm, closeup: () => closeup, active: () => !!npc, update(dt: number) {
    dt = Math.min(dt, 0.5); time += dt;
    if (typing) {
      elapsed += dt;
      const shown = instant ? full.length : Math.min(full.length, Math.floor(elapsed * SPEED));
      text.textContent = full.slice(0, shown);
      if (shown >= full.length) finish();
    }
    if (!stand) return;
    stand.avatar.update(0, dt);
    // Reaction smile on top of the avatar's own idle smile: added after its update so it reaches this frame's morphs.
    cheer += ((time < mood.until ? mood.level : 0) - cheer) * (1 - Math.exp(-dt * 6));
    const extra = cheer - (stand.happy?.weight ?? 1);
    if (stand.happy && extra > 0.01) { stand.happy.weight = extra; stand.happy.applyWeight(); }
  } };
}
