// C095b: the shop floor's lines and crowd table (R6-claude 3장 ①②⑤⑥).
/** Crowd by customers in the shop this hour: simultaneous bubbles, seconds per bubble, chance of a customers' chat. */
export const crowdLevels = [
  { name: '한산', min: 0, bubbles: 1, seconds: 2.5, talk: 0 },
  { name: '보통', min: 2, bubbles: 2, seconds: 2, talk: 0.1 },
  { name: '북적', min: 4, bubbles: 3, seconds: 1.5, talk: 0.3 },
  { name: '아수라장', min: 7, bubbles: 4, seconds: 1.2, talk: 0.5 },
] as const;
/** Customers' two-line chats, one per kind of real record. {item} {price} {count} fill from that record. */
export const talks = {
  cheap: ['여기 {item} {price}결이네요. 괜찮다.', '그러니까 사람이 많지.'],
  dear: ['{item}, {price}결이나 해요?', '그래도 가까우니까요.'],
  fair: ['{item} {price}결, 딱 적당하네요.', '가격은 정직하네.'],
  soldout: ['{item} 다 떨어졌대요.', '아침에 와야겠네.'],
  parking: ['주차 자리 {count}칸 다 찼던데요.', '그래서 걸어왔어요.'],
  regular: ['여기 {item} 괜찮아요. 저 자주 와요.', '그래요? 하나 사 봐야겠다.'],
} as const;
export const sceneLines = {
  fast: ['손 빠르시네!', '와, 금방 됐다.'],
  first: '어, 개업하셨구나. 혹시 제가 첫 손님이에요?',
  again: '또 왔어요.',
  usual: '늘 사던 거요.',
  right: '역시, 기억하시네.',
  wrong: '아뇨, {item}요. 하하.',
  album: '첫 1결 · {name} 님 · {item} {price}결',
} as const;
export const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
