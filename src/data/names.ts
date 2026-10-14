// Gyeol names join a light opening, an open vowel bridge and a resonant ending.
// Invented syllable combinations, not a list of real people; incidental matches are possible.
export const nameSyllables = {
  openings: ['아', '누', '소', '벨', '이', '리', '루', '네', '오', '세', '라', '유'],
  bridges: ['루', '오', '리', '에', '누', '아', '레', '소'],
  endings: ['엘', '안', '로', '엔', '온', '세', '린', '벨'],
} as const;
// Includes the planned resident Risé, even before she is added to the core roster.
const reserved = new Set(['아로', '누엘', '소리안', '벨로', '이리', '리세']);
export const generatedNames: readonly string[] = nameSyllables.openings.flatMap(opening =>
  nameSyllables.bridges.flatMap(bridge => nameSyllables.endings.map(ending => opening + bridge + ending)))
  .filter(name => !reserved.has(name));
