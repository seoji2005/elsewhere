import * as T from 'three';
import { paint } from '../scene/props';

// Anime cumulus: one painted card (lobes, flat base, cool shaded underside), instanced around the horizon as a
// single unlit, unfogged draw call. Add it to the sky dome so it follows the camera.
export function cloudCards(tint: T.ColorRepresentation, count = 16) {
  const map = paint(256, 128, g => {
    g.fillStyle = '#fff';
    for (const [x, y, r] of [[52, 92, 26], [88, 70, 38], [132, 54, 46], [176, 70, 36], [210, 92, 24], [130, 92, 34]]) {
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.clearRect(0, 112, 256, 16);
    g.globalCompositeOperation = 'source-atop';
    const shade = g.createLinearGradient(0, 30, 0, 112);
    shade.addColorStop(0, 'rgba(150,170,210,0)'); shade.addColorStop(1, 'rgba(150,170,210,.55)');
    g.fillStyle = shade; g.fillRect(0, 0, 256, 128);
  });
  const cards = new T.InstancedMesh(new T.PlaneGeometry(1, 0.5), new T.MeshBasicMaterial({ map, color: tint,
    transparent: true, depthWrite: false, fog: false }), count);
  const card = new T.Object3D(), random = (i: number, k: number) => Math.abs(Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1;
  for (let i = 0; i < count; i++) {
    const angle = (i + random(i, 1) * 0.6) / count * Math.PI * 2, height = 0.04 + 0.3 * random(i, 2) ** 1.5;
    card.position.set(Math.cos(angle) * 220, 220 * height, Math.sin(angle) * 220);
    card.lookAt(0, card.position.y, 0);
    card.scale.setScalar(90 + 90 * random(i, 3));
    card.updateMatrix();
    cards.setMatrixAt(i, card.matrix);
  }
  cards.frustumCulled = false;
  return cards;
}
