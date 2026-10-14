const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const ZOOM = [3.5, 14] as const;
const RADIUS = 56; // joystick travel in CSS pixels

// Left thumb: floating joystick. Other fingers / mouse: drag to orbit, pinch / wheel to zoom.
export function playerControls(surface: HTMLElement, stick: HTMLElement, knob: HTMLElement) {
  const state = { x: 0, y: 0, yaw: Math.PI / 4, pitch: 0.6, dist: 8 };
  const keys = new Set<string>(), pointers = new Map<number, { x: number; y: number }>();
  let stickId: number | undefined, originX = 0, originY = 0, pinch = 0;
  surface.addEventListener('pointerdown', event => {
    surface.setPointerCapture(event.pointerId);
    if (event.pointerType !== 'mouse' && stickId === undefined && event.clientX < innerWidth * 0.45) {
      stickId = event.pointerId; originX = event.clientX; originY = event.clientY;
      Object.assign(stick.style, { left: `${originX}px`, top: `${originY}px`, bottom: 'auto' });
      stick.classList.add('active');
      return;
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pinch = 0;
  });
  surface.addEventListener('pointermove', event => {
    if (event.pointerId === stickId) {
      let dx = event.clientX - originX, dy = event.clientY - originY;
      const length = Math.hypot(dx, dy);
      if (length > RADIUS) { dx *= RADIUS / length; dy *= RADIUS / length; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      state.x = dx / RADIUS; state.y = -dy / RADIUS;
      stick.classList.toggle('run', Math.hypot(state.x, state.y) >= 0.85);
      return;
    }
    const point = pointers.get(event.pointerId);
    if (!point) return;
    if (pointers.size === 1) {
      state.yaw -= (event.clientX - point.x) * 0.008;
      state.pitch = clamp(state.pitch + (event.clientY - point.y) * 0.005, 0.2, 1.2);
    }
    point.x = event.clientX; point.y = event.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], spread = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) state.dist = clamp(state.dist * pinch / spread, ...ZOOM);
      pinch = spread;
    }
  });
  const release = (event: PointerEvent) => {
    if (event.pointerId === stickId) {
      stickId = undefined; state.x = state.y = 0;
      knob.style.transform = stick.style.left = stick.style.top = stick.style.bottom = '';
      stick.classList.remove('run', 'active');
    }
    pointers.delete(event.pointerId);
    pinch = 0;
  };
  surface.addEventListener('pointerup', release);
  surface.addEventListener('pointercancel', release);
  surface.addEventListener('wheel', event => {
    state.dist = clamp(state.dist * Math.exp(event.deltaY * 0.001), ...ZOOM);
  }, { passive: true });
  addEventListener('keydown', event => keys.add(event.code));
  addEventListener('keyup', event => keys.delete(event.code));
  addEventListener('blur', () => keys.clear());
  const key = (...codes: string[]) => Number(codes.some(code => keys.has(code)));
  // Stick vector: x = right, y = forward, length 0..1 (≥ 0.85 = run).
  function stickInput() {
    const x = key('KeyD', 'ArrowRight') - key('KeyA', 'ArrowLeft');
    const y = key('KeyW', 'ArrowUp') - key('KeyS', 'ArrowDown');
    if (!x && !y) return { x: state.x, y: state.y };
    const scale = (key('ShiftLeft', 'ShiftRight') ? 1 : 0.6) / Math.hypot(x, y);
    return { x: x * scale, y: y * scale };
  }
  return { state, stickInput };
}
