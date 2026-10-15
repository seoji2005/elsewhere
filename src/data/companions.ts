export interface CompanionEvent {
  id: string; npcId: string; fromMinute: number; untilMinute: number;
  placeId: string; activityName: string; recallLine: string;
}
export const companionEvents: readonly CompanionEvent[] = [
  { id: 'lantern-round', npcId: 'lise', fromMinute: 1320, untilMinute: 1380,
    placeId: 'park', activityName: '등불 순찰',
    recallLine: '함께 등불을 살피던 밤이 생각나요. 덕분에 떠오름 뜰이 한결 환했어요.' },
  { id: 'night-record', npcId: 'velo', fromMinute: 0, untilMinute: 240,
    placeId: 'office', activityName: '밤결 기록',
    recallLine: '함께 적은 밤결 기록, 다시 읽어 봤어요. 혼자서는 놓쳤을 잔향이 남아 있더라고요.' },
];
