import './hud.css';

// Thumb UI over the canvas: joystick ring, door button, toast. Removes the HTML loading label when ready.
export function hud() {
  const make = (className: string, parent: HTMLElement = document.body, tag = 'div') => {
    const element = document.createElement(tag);
    element.className = className;
    parent.append(element);
    return element;
  };
  const stick = make('stick'), knob = make('knob', stick);
  const enter = make('enter', document.body, 'button'), toast = make('toast');
  enter.textContent = '들어가기';
  enter.hidden = true;
  let timer = 0;
  enter.addEventListener('click', () => {
    toast.textContent = '곧 열려요';
    toast.classList.add('show');
    clearTimeout(timer);
    timer = window.setTimeout(() => toast.classList.remove('show'), 1600);
  });
  return { stick, knob, ready: () => document.getElementById('loading')?.remove(),
    door(near: boolean) { if (enter.hidden === near) enter.hidden = !near; } };
}
