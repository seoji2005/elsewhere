// from research R001
import { Color, ColorRepresentation, Fog, Scene } from 'three';

// Simplifies the references' custom fog to the stock r170 fog path.
export function cornerAtmosphere(scene: Scene,
  color: ColorRepresentation = '#b8c8d2', near = 22, far = 65) {
  if (!(near >= 0 && far > near)) throw new RangeError('Invalid fog range');
  const previous = { fog: scene.fog, background: scene.background };
  const fog = new Fog(color, near, far);
  const background = new Color(color);
  scene.fog = fog;
  scene.background = background;
  return { fog, setColor(value: ColorRepresentation) {
    fog.color.set(value);
    background.set(value);
  }, dispose() {
    scene.fog = previous.fog;
    scene.background = previous.background;
  } };
}
