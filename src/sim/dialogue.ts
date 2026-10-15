import { companies } from '../data/companies';
import { revealMarketHint, type MarketState } from './market';
import { dialogueFor, sharedMemoryTemplates, conflictTemplates, marketHintLines } from '../data/dialogue';
import type { Npc } from '../data/npcs';
import type { GameTime } from './clock';
import { createMemoryState, minuteOf, recall, remember, memoryLine, type MemoryState } from './memory';
import { interact, relationshipStage, type DialogueChoice, type RelationshipState,
  type Interaction } from './relationship';
import { friendly, type Bond } from './bonds';
import type { WorldState } from './world';

export interface Consent { playerWantsDating: boolean; npcWantsDating: boolean }
export interface DialogueState {
  memories: Record<string, MemoryState>;
  dating: { actorId: string; npcId: string }[];
}
export interface DialogueContext {
  market?: MarketState;
  actorId: string; npc: Npc; time: GameTime; value: number;
  scene?: { placeId: string; peopleCount: number; atWork: boolean; bond?: Bond };
}
function informalFor(ctx: DialogueContext): boolean | undefined {
  const scene = ctx.scene;
  return scene ? !scene.atWork && scene.peopleCount === 2
    && (scene.bond ? friendly(scene.bond) : ctx.value >= 30) : undefined;
}
export function conflictLine(ctx: DialogueContext): string | undefined {
  const hurt = ctx.scene?.bond?.hurt;
  return hurt ? conflictTemplates[informalFor(ctx) ? 'casual' : 'polite'][hurt.resolved ? 'reconciled' : 'hurt'] : undefined;
}
export function createDialogueState(): DialogueState { return { memories: {}, dating: [] }; }
function validate(ctx: DialogueContext): void {
  minuteOf(ctx.time);
  if (!ctx.actorId || ctx.actorId === ctx.npc.id || !ctx.npc.id) {
    throw Error('Invalid dialogue context');
  }
  relationshipStage(ctx.value);
}
export function isDating(state: DialogueState, actorId: string, npcId: string): boolean {
  return state.dating.some(pair => pair.actorId === actorId && pair.npcId === npcId);
}
export function buildDialogue(state: DialogueState, ctx: DialogueContext) {
  validate(ctx);
  const template = dialogueFor(ctx.npc, ctx.scene?.bond?.affection ?? ctx.value, ctx.actorId, informalFor(ctx));
  const pending = ctx.scene?.bond?.hurt?.resolved === false;
  const memories = pending || informalFor(ctx) === false ? undefined : state.memories[ctx.npc.id];
  const now = minuteOf(ctx.time);
  const shared = memories ? recall({ ...memories, entries: memories.entries.filter(memory =>
    (memory.kind === 'meal' || memory.kind === 'shared-work') && memory.mentionedAt === undefined
    && now - memory.created >= 1440 && memory.participants?.includes(ctx.actorId)
    && memory.participants.includes(ctx.npc.id)) }, ctx.time, { subjectId: ctx.actorId }, 1)[0] : undefined;
  const past = !shared && memories ? recall({ ...memories, entries: memories.entries.filter(memory =>
    (memory.kind === 'gift' || memory.kind === 'chat') && memory.mentionedAt === undefined
    && now - memory.created >= 1440) }, ctx.time, { subjectId: ctx.actorId }, 1)[0] : undefined;
  const familiar = informalFor(ctx) ?? ctx.value >= 30;
  let sharedLine: string | undefined;
  if (shared && memories && (shared.kind === 'meal' || shared.kind === 'shared-work')) {
    const style = ctx.npc.id === 'lise' && familiar ? 'lise' : ctx.npc.traits.includes('practical')
      ? 'practical' : ctx.npc.traits.includes('social') || ctx.npc.traits.includes('playful') ? 'social' : 'quiet';
    sharedLine = sharedMemoryTemplates[style][shared.kind]
      .replace('{place}', () => shared.placeName ?? shared.placeId ?? '')
      .replace('{activity}', () => shared.topic);
    memories.entries.find(memory => memory.id === shared.id)!.mentionedAt = now;
  }
  if (!shared && familiar && past && memories) {
    memories.entries.find(memory => memory.id === past.id)!.mentionedAt = now;
  }
  const choices: DialogueChoice[] = ctx.npc.likes.map((topic, index) => ({
    id: `chat:${index}`, topic, tone: ctx.npc.traits[0] ?? 'quiet',
  }));
  // No tips while a conflict is unresolved (C074): the line is the awkward one.
  const hint = !pending && ctx.market && ctx.scene?.bond && friendly(ctx.scene.bond) && informalFor(ctx)
    ? revealMarketHint(ctx.market, ctx.npc.job) : undefined;
  const hintLine = hint ? marketHintLines[hint.size > 0 ? 'good' : 'bad']
    .replace('{company}', companies.find(c => c.id === hint.companyId)!.name) : '';
  return { line: ((pending ? conflictLine(ctx) : undefined) ?? sharedLine ?? (familiar && past && past.created < now
    ? memoryLine(past) : familiar ? template.familiar : template.greeting)) + (hintLine ? ` ${hintLine}` : ''),
    // The legacy 90-point label is numeric; dating is only established by mutual consent.
    stage: ctx.value >= 90 && !isDating(state, ctx.actorId, ctx.npc.id)
      ? '호감' : relationshipStage(ctx.value), choices };
}
// Existing gift callers pass giveGift()'s result here; never grant score twice.
export function recordDialogue(state: DialogueState, eventId: string, npc: Npc,
  entry: Interaction, ctx?: DialogueContext): string {
  if (entry.npcId !== npc.id) throw Error('NPC mismatch');
  const memories = state.memories[npc.id] ?? createMemoryState(npc.id);
  const now = minuteOf(entry.time);
  const repeated = memories.entries.some(memory => memory.subjectId === entry.actorId
    && memory.choiceId === entry.choice.id && memory.created <= now
    && now - memory.created < 14 * 1440);
  remember(memories, eventId, entry);
  state.memories[npc.id] = memories;
  const template = dialogueFor(npc, ctx?.scene?.bond?.affection ?? entry.value, entry.actorId, ctx && informalFor(ctx));
  if (entry.choice.id.startsWith('gift:')) {
    return npc.dislikes.includes(entry.choice.topic) ? template.dislikedGift : template.gift;
  }
  return repeated ? template.repeat : entry.change < 0 ? '그 이야기는 조금 불편해요.' : template.chat;
}
export function talk(world: Pick<WorldState, 'relationships'>, relationships: RelationshipState,
  state: DialogueState, eventId: string, ctx: DialogueContext, choice: DialogueChoice) {
  validate(ctx);
  if (!eventId || state.memories[ctx.npc.id]?.entries.some(memory => memory.id === eventId)) {
    throw Error('Invalid or duplicate dialogue event');
  }
  const entry = interact(world, relationships, ctx.actorId, ctx.npc, ctx.time, choice);
  return { entry, line: recordDialogue(state, eventId, ctx.npc, entry, ctx) };
}
export function confess(state: DialogueState, ctx: DialogueContext, consent: Consent) {
  validate(ctx);
  const accepted = isDating(state, ctx.actorId, ctx.npc.id)
    || (ctx.value >= 90 && consent.playerWantsDating === true && consent.npcWantsDating === true);
  if (accepted && !isDating(state, ctx.actorId, ctx.npc.id)) {
    state.dating.push({ actorId: ctx.actorId, npcId: ctx.npc.id });
  }
  const template = dialogueFor(ctx.npc, ctx.scene?.bond?.affection ?? ctx.value, ctx.actorId, informalFor(ctx));
  return { accepted, line: accepted ? template.accept : template.refuse };
}
