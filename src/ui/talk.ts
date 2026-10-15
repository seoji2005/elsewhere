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
// An open spot near the player for the resident to stand: ahead first, then beside, then behind.
function spot(player: T.Object3D, solids: T.Box3[]) {
  const { x, z } = player.position, yaw = player.rotation.y;
  const at = (turn: number, gap: number) => new T.Vector3(x + Math.sin(yaw + turn) * gap, 0, z + Math.cos(yaw + turn) * gap);
  const options = [at(0, 1.7), at(0, 1.3), at(0.9, 1.6), at(-0.9, 1.6), at(Math.PI, 1.6)];
  const p = options.find(v => Math.abs(v.x) < 46 && Math.abs(v.z) < 46 && solids.every(box => box.distanceToPoint(v) > 0.35)) ?? options[1];
  return p.setY(Math.abs(p.x) > 5 && Math.abs(p.z) > 5 ? 0.11 : 0);
}
// Half-body framing: hips to above the head fill the height, the face in the upper third, the resident left of centre
// so the dialogue box has room; the camera stands a little to the side for a three-quarter view.
function frame(at: T.Vector3, facing: number, height: number): Closeup {
  const dir = new T.Vector3(Math.sin(facing + 0.35), 0, Math.cos(facing + 0.35)), side = new T.Vector3(dir.z, 0, -dir.x);
  const shift = 0.19 * height * innerWidth / Math.max(1, innerHeight);
  const aim = at.clone().addScaledVector(side, shift).setY(at.y + height * 0.68);
  return { aim, eye: aim.clone().addScaledVector(dir, height).setY(at.y + height * 0.76) };
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
  const stands = new Map<string, Promise<Stand>>();
  let npc: Npc | undefined, stand: Stand | undefined, closeup: Closeup | undefined, options: DialogueChoice[] = [];
  let full = '', elapsed = 0, typing = false, instant = false, time = 0, cheer = 0, mood = { level: 0, until: 0 };
  const uid = (kind: string) => `${kind}:player:${Math.floor(session.state.world.clock.totalMinutes)}:${Math.random().toString(36).slice(2, 8)}`;
  const stageName = (id: string) => { try { const s = session.stageFor(id); return s === '연인 첫 단계' ? '연인' : s; } catch { return ''; } };
  const say = (line: string, feeling: number) => {
    full = line; elapsed = 0; typing = true; choiceBox.hidden = true;
    text.textContent = instant ? full : '';
    mood = { level: feeling, until: time + 2.8 };
  };
  const finish = () => {
    typing = false; text.textContent = full;
    choiceBox.replaceChildren();
    for (const choice of options) make('talk-choice', choiceBox, 'button', choice.topic).onclick = () => pick(choice);
    make('talk-choice end', choiceBox, 'button', '그만').onclick = end;
    choiceBox.hidden = false;
  };
  function pick(choice: DialogueChoice) {
    if (!npc) return;
    try {
      const { entry, line } = session.talk(uid('chat'), npc.id, choice);
      say(line, entry.change > 0 ? 0.6 : 0);
    } catch { options = []; say(`${npc.name} 님은 지금 이야기할 수 없어요.`, 0); }
    session.saveNow();
  }
  // One avatar per outfit, kept for the next dialogue; its standing height (precise, skinned bounds once) sets the framing.
  const standFor = (outfit: Outfit) => stands.get(outfit.name) ?? stands.set(outfit.name, spawn!(outfit).then(avatar => {
    avatar.update(0, 0); avatar.group.updateMatrixWorld(true);
    avatar.group.traverse(object => { if (object instanceof T.SkinnedMesh) object.skeleton.update(); });
    const height = new T.Box3().setFromObject(avatar.group, true).getSize(new T.Vector3()).y;
    const happy = avatar.group.getObjectByName('VRMExpression_happy') as Stand['happy'];
    return { avatar, height, happy };
  })).get(outfit.name)!;
  const warm = (who: Npc) => { if (spawn) void standFor(outfitFor(who)); };
  async function start(who: Npc, atOnce = false) {
    if (npc) end();
    npc = who; instant = atOnce;
    document.body.classList.add('talking');
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('show'));
    label.textContent = who.name;
    sub.textContent = ` ${who.job} · ${stageName(who.id)}`;
    try { const opening = session.buildDialogue(who.id); options = opening.choices; say(opening.line, 0.35); }
    catch { options = []; say(`${who.name} 님이 고개를 끄덕여요.`, 0); }
    if (!spawn) return;
    const at = spot(player, solids), facing = Math.atan2(player.position.x - at.x, player.position.z - at.z);
    player.rotation.y = facing + Math.PI;
    const ready = await standFor(outfitFor(who));
    if (npc !== who) return; // ended while loading
    stand = ready;
    stand.avatar.group.position.copy(at);
    stand.avatar.group.rotation.y = facing;
    scene.add(stand.avatar.group);
    closeup = frame(at, facing, stand.height);
  }
  function end() {
    if (!npc) return;
    npc = undefined; closeup = undefined; typing = false; options = [];
    if (stand) { scene.remove(stand.avatar.group); stand = undefined; }
    overlay.hidden = true; overlay.classList.remove('show'); choiceBox.hidden = true;
    document.body.classList.remove('talking');
    onEnd();
  }
  box.onclick = () => { if (typing) finish(); };
  overlay.onclick = event => { if (event.target === overlay) end(); };
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
