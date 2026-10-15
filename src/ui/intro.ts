/// <reference types="vite/client" />
// C106 시작 안내 한 화면(R5b 문안 5줄) — 새 체험 세계의 첫 실행에만. 열려 있는 동안 시간은 멈춘다(main).
const lines = ['작은 가게의 첫날입니다. 상자를 받아 가게로 옮겨 보세요.',
  '진열하고 첫 손님을 받은 뒤, 가격과 직원을 정할 수 있어요.',
  '결폰에서는 업무와 약속을 확인해요. 읽는 동안 시간은 멈춰요.',
  '기다릴 때는 ‘다음 일까지’를 눌러 보세요.',
  '30분 동안 끌리는 일을 해 보세요. 전부 끝내지 않아도 괜찮아요.'];
/** Build number (short commit) in a corner: set VITE_COMMIT at build time, e.g. VITE_COMMIT=$(git rev-parse --short HEAD). */
export function buildTag(): void {
  const tag = document.createElement('div');
  tag.className = 'build-tag';
  tag.textContent = `빌드 ${import.meta.env.VITE_COMMIT || 'dev'}`;
  document.body.append(tag);
}
export function intro() {
  const box = document.createElement('div'), card = document.createElement('div'), start = document.createElement('button');
  box.className = 'intro'; card.className = 'intro-card'; start.className = 'hud-open';
  card.append(...lines.map(text => Object.assign(document.createElement('p'), { textContent: text })), start);
  start.textContent = '시작하기';
  start.onclick = () => box.remove();
  box.append(card); document.body.append(box);
  return { open: () => box.isConnected };
}
