import type { Trait } from './npcs';

export interface Archetype {
  id: string; name: string; traits: readonly Trait[];
  likes: readonly string[]; dislikes: readonly string[];
  speech: {
    // Start polite; switch only in private, at this relationship value, by mutual agreement.
    informalAt: number; publicPolite: true; requiresAgreement: true;
    politeEndings: readonly string[]; informalEndings: readonly string[];
    politeAddress: string; informalAddress: string; maxSentences: number;
  };
}

export const archetypes: readonly Archetype[] = [
  { id: 'composed', name: '차분한 공적·사적 반전형', traits: ['quiet', 'practical'],
    likes: ['약속', '빛씨'], dislikes: ['큰 소리', '서두르기'],
    speech: { informalAt: 30, publicPolite: true, requiresAgreement: true,
      politeEndings: ['해요', '입니다'], informalEndings: ['네', '지'],
      politeAddress: '{name} 님', informalAddress: '너', maxSentences: 2 } },
  { id: 'warm', name: '다정한 수다형', traits: ['social', 'playful'],
    likes: ['잔향 차', '새로운 생각'], dislikes: ['고립', '무시'],
    speech: { informalAt: 10, publicPolite: true, requiresAgreement: true,
      politeEndings: ['네요', '죠'], informalEndings: ['잖아', '야'],
      politeAddress: '{name} 씨', informalAddress: '{name}', maxSentences: 4 } },
  { id: 'artisan', name: '무뚝뚝한 장인형', traits: ['practical', 'quiet'],
    likes: ['수선', '약속'], dislikes: ['낭비', '허풍'],
    speech: { informalAt: 60, publicPolite: true, requiresAgreement: true,
      politeEndings: ['합니다', '예요'], informalEndings: ['다', '해'],
      politeAddress: '{name} 씨', informalAddress: '자네', maxSentences: 1 } },
  { id: 'explorer', name: '호기심 많은 탐색형', traits: ['curious', 'social'],
    likes: ['새로운 생각', '빛씨'], dislikes: ['반복', '단정'],
    speech: { informalAt: 30, publicPolite: true, requiresAgreement: true,
      politeEndings: ['일까요', '군요'], informalEndings: ['일까', '구나'],
      politeAddress: '{name} 님', informalAddress: '{name}', maxSentences: 3 } },
  { id: 'dreamer', name: '조용한 몽상형', traits: ['quiet', 'curious'],
    likes: ['잔향', '고요'], dislikes: ['서두르기', '큰 소리'],
    speech: { informalAt: 60, publicPolite: true, requiresAgreement: true,
      politeEndings: ['같아요', '네요'], informalEndings: ['같아', '네'],
      politeAddress: '{name} 씨', informalAddress: '{name}', maxSentences: 2 } },
  { id: 'jester', name: '장난스러운 분위기형', traits: ['playful', 'social'],
    likes: ['큰 소리', '놀이'], dislikes: ['무시', '엄숙함'],
    speech: { informalAt: 10, publicPolite: true, requiresAgreement: true,
      politeEndings: ['죠', '볼까요'], informalEndings: ['거든', '볼래'],
      politeAddress: '{name} 씨', informalAddress: '친구', maxSentences: 2 } },
  { id: 'organizer', name: '꼼꼼한 계획형', traits: ['practical', 'curious'],
    likes: ['약속', '정리'], dislikes: ['낭비', '지각'],
    speech: { informalAt: 60, publicPolite: true, requiresAgreement: true,
      politeEndings: ['입니다', '해주세요'], informalEndings: ['하자', '해야 해'],
      politeAddress: '{name} 님', informalAddress: '{name}', maxSentences: 3 } },
  { id: 'keeper', name: '살뜰한 돌봄형', traits: ['social', 'practical'],
    likes: ['수선', '잔향 차'], dislikes: ['무리', '고립'],
    speech: { informalAt: 30, publicPolite: true, requiresAgreement: true,
      politeEndings: ['드릴게요', '괜찮아요'], informalEndings: ['줄게', '괜찮아'],
      politeAddress: '{name} 씨', informalAddress: '{name}', maxSentences: 3 } },
  { id: 'wit', name: '건조한 농담형', traits: ['quiet', 'playful'],
    likes: ['잔향', '놀이'], dislikes: ['허풍', '큰 소리'],
    speech: { informalAt: 30, publicPolite: true, requiresAgreement: true,
      politeEndings: ['겠네요', '인가요'], informalEndings: ['겠네', '인가'],
      politeAddress: '{name} 님', informalAddress: '너', maxSentences: 1 } },
  { id: 'inventor', name: '즉흥적인 발명형', traits: ['curious', 'playful'],
    likes: ['새로운 생각', '수선'], dislikes: ['반복', '포기'],
    speech: { informalAt: 10, publicPolite: true, requiresAgreement: true,
      politeEndings: ['해볼까요', '거예요'], informalEndings: ['해보자', '거야'],
      politeAddress: '{name} 씨', informalAddress: '짝꿍', maxSentences: 3 } },
];
