import { archetypes } from './archetypes';
import type { Npc } from './npcs';
import type { GeneratedNpc } from '../sim/npcgen';
export interface DialogueTemplate {
  greeting: string; familiar: string; chat: string; repeat: string;
  gift: string; dislikedGift: string; accept: string; refuse: string;
}
export const sharedMemoryTemplates = {
  quiet: { meal: '{place}에서 함께 먹은 {activity}, 아직 여운이 남아 있어요.',
    'shared-work': '{place}에서 함께 한 {activity}, 그때의 손길이 생각나요.' },
  social: { meal: '{place}에서 같이 먹은 {activity}, 즐거웠죠! 또 함께 먹어요.',
    'shared-work': '{place}에서 같이 한 {activity}, 함께하니 즐거웠어요!' },
  practical: { meal: '{place}에서 함께 먹은 {activity}, 든든했습니다.',
    'shared-work': '{place}에서 함께 한 {activity}, 덕분에 잘 끝냈습니다.' },
  lise: { meal: '{place}에서 같이 먹은 {activity}, 네 몫까지 기억하고 있어.',
    'shared-work': '{place}에서 같이 한 {activity}, 네가 맡은 분량도 기억해. …고마워.' },
} as const;
// Original lines for Gyeol's residents; no source-game dialogue.
export const dialogueTemplates: Record<string, DialogueTemplate> = {
  aro: {
    greeting: '빛씨가 조용하네요. 안녕하세요.', familiar: '당신 발소리는 이제 알아요.',
    chat: '오늘 빛씨가 낯선 무늬를 냈어요.', repeat: '그 무늬 얘기, 아까도 했죠. 다른 빛을 볼까요?',
    gift: '이건 창가에 두고 살펴볼게요.', dislikedGift: '제 빛씨 곁에는 두기 어렵겠어요.',
    accept: '네. 천천히, 같은 빛을 찾아가요.', refuse: '아직 그 마음으로 답할 준비는 안 됐어요.',
  },
  nuel: {
    greeting: '어서 와요! 잔향이 딱 한 잔 남았어요.', familiar: '왔군요! 당신 자리는 비워 뒀죠.',
    chat: '오늘 차에는 웃음 같은 잔향이 돌아요.', repeat: '하하, 그 얘기는 벌써 우렸죠. 다음 잔은요?',
    gift: '고마워요! 쉬는 시간에 펼쳐 볼게요.', dislikedGift: '고맙지만 제 취향과는 조금 멀어요.',
    accept: '좋아요. 다음 잔부터는 우리 둘의 시간이에요.', refuse: '반갑다는 마음과 사귀는 마음은 달라요. 지금은 어려워요.',
  },
  sori: {
    greeting: '안녕하세요. 순환대 옆은 비워 주세요.', familiar: '왔어요? 손볼 물건 있으면 같이 봐요.',
    chat: '고리 하나를 고치니 공유물 셋이 돌아왔어요.', repeat: '그건 답했어요. 이번엔 다른 걸 물어봐요.',
    gift: '고마워요. 잘 쓰고 오래 돌볼게요.', dislikedGift: '쓰지 않을 물건을 쌓아 두긴 어렵네요.',
    accept: '좋아요. 서로 시간을 지키며 만나 봅시다.', refuse: '그 약속은 아직 할 수 없어요.',
  },
  velo: {
    greeting: '밤결 한 줄 주워 왔어요. 들어 볼래요?', familiar: '당신 몫의 빈 줄도 남겨 뒀어요.',
    chat: '어젯밤 잔향이 거꾸로 흐르더라고요!', repeat: '이 줄은 이미 읽었잖아요. 다음 장으로 가요!',
    gift: '이건 오늘 밤 기록에 남겨야겠어요!', dislikedGift: '음, 내 밤결에는 어울리지 않네요.',
    accept: '좋아요! 다음 밤결은 함께 적어요.', refuse: '아직 우리를 그렇게 적고 싶지는 않아요.',
  },
  iri: {
    greeting: '어서 와요. 뜰이 막 깨어났어요.', familiar: '왔네요. 같이 돌볼 자리를 남겨 뒀어요.',
    chat: '수선한 받침에서 새 빛씨가 돋았어요.', repeat: '그 얘기는 나눴지요. 이번엔 당신 하루를 들려줘요.',
    gift: '마음 써 줘서 고마워요. 잘 돌볼게요.', dislikedGift: '고맙지만 뜰 곁에 두기는 곤란해요.',
    accept: '네. 서로의 하루를 함께 돌봐요.', refuse: '아직은 그 마음을 받아들일 수 없어요.',
  },
  // Public 해요체 until a real conversation, then short 반말; name only once dating.
  lise: {
    greeting: '어서 오세요. 지금 조율 중이라 용건만 짧게 부탁드려요.', familiar: '왔네. 마침 고리 하나 다 맞췄어.',
    chat: '오늘 고리 마흔 개 맞췄어. 그사이 누엘은 찻잔 세 개를 비웠고.',
    repeat: '같은 걸 두 번 묻는 건 너뿐이야. …그래, 오늘은 좀 피곤해.',
    gift: '…고마워. 방금 웃은 거 아니야. 조명 각도 탓이야.', dislikedGift: '마음만 받을게. 이건 조율실에 둘 데가 없네.',
    accept: '…응. 일정 빈칸은 이제 네 이름으로 채울게.', refuse: '고마워. 그래도 그건 대충 맞출 수 있는 각도가 아니야.',
  },
};
const archetypeLines: Record<string, [string, string]> = {
  composed: ['오늘은 약속을 지키기 좋은 날이네요.', '오늘도 약속은 기억하고 있네.'],
  warm: ['같이 마시니 잔향이 더 좋네요.', '같이 마시니 잔향이 더 좋잖아.'],
  artisan: ['수선할 물건은 오래 돌봐야 합니다.', '수선할 물건은 내가 돌본다.'],
  explorer: ['빛씨는 어디까지 자라는 걸까요?', '빛씨가 또 다른 무늬를 냈구나.'],
  dreamer: ['조용히 들으니 잔향이 남는 것 같아요.', '조용히 들으니 잔향이 남는 것 같아.'],
  jester: ['오늘은 새 놀이를 해 볼까요?', '오늘은 새 놀이를 해 볼래?'],
  organizer: ['다음 약속은 미리 정리해주세요.', '다음 약속은 미리 정리하자.'],
  keeper: ['따뜻한 차를 한 잔 드릴게요.', '따뜻한 차를 한 잔 줄게.'],
  wit: ['고요한 날에도 농담은 남겠네요.', '고요한 날에도 농담은 남겠네.'],
  inventor: ['새로운 수선 방법을 해볼까요?', '새로운 수선 방법을 해보자.'],
};
export function dialogueFor(npc: Npc, value = 0, actorId = 'player', informal?: boolean): DialogueTemplate {
  const authored = dialogueTemplates[npc.id];
  if (authored && (informal === undefined || (npc.id === 'lise' ? informal : !informal))) return authored;
  const generated = npc as Partial<GeneratedNpc>;
  const archetype = archetypes.find(a => a.id === generated.archetypeId)
    ?? archetypes.find(a => a.traits.every((trait, i) => trait === npc.traits[i])) ?? archetypes[0];
  const speech = generated.speech ?? archetype.speech;
  const privateSpeech = informal === true;
  informal = informal !== false && value >= speech.informalAt;
  const address = (informal ? speech.informalAddress : speech.politeAddress).replace('{name}', actorId === 'player' ? '플레이어' : actorId);
  const [polite, casual] = archetypeLines[archetype.id], line = `${address}, ${informal ? casual : polite}`;
  return { greeting: !informal && authored ? authored.greeting : line,
    familiar: privateSpeech && informal ? `${line} 너와 있으니 마음이 놓여.` : line, chat: line, repeat: informal ? '그 얘기는 아까 했지.' : '그 얘기는 아까 했어요.',
    gift: informal ? '마음 써 줘서 고마워.' : '마음 써 줘서 고마워요.', dislikedGift: informal ? '마음만 받을게.' : '마음만 받을게요.',
    accept: informal ? '좋아. 함께 시간을 보내자.' : '좋아요. 함께 시간을 보내요.', refuse: informal ? '아직은 준비가 안 됐어.' : '아직은 준비가 안 됐어요.' };
}

export const marketHintLines = {
  good: '둘만 있으니 말인데, {company} 쪽 수요가 곧 늘 거래. 며칠 뒤엔 좋은 소식이 들릴 거야.',
  bad: '둘만 있으니 말인데, {company} 쪽 물량에 차질이 생겼대. 며칠 뒤엔 안 좋은 소식이 들릴 거야.',
};
