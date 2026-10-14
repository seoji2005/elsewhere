// from research R002
import { NoBlending, Data3DTexture, GLSL3, LinearFilter, RGBAFormat, Texture, UnsignedByteType } from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** New 16³ sRGB LUT; no reference texture. The one full-screen post pass:
 *  HDR input (+ bloom glow) -> Reinhard -> LUT -> sRGB screen, so no separate bloom-add or output pass. */
export function duskLUT(size = 16, grade = true) {
  if (!Number.isInteger(size) || size < 2 || size > 64) throw new Error('LUT size: integer 2..64');
  const bytes = new Uint8Array(size ** 3 * 4);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const rgb = [r, g, b].map(v => v / (size - 1));
    const y = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    const shadow = (1 - y) ** 2, highlight = y ** 2;
    const tint = [-0.008, 0.002, 0.018], warm = [0.022, 0.009, -0.012];
    const index = ((b * size + g) * size + r) * 4;
    for (let c = 0; c < 3; c++) bytes[index + c] = Math.round(255 * clamp(
      y + (rgb[c] - y) * 0.9 + tint[c] * shadow + warm[c] * highlight));
    bytes[index + 3] = 255;
  }
  const texture = new Data3DTexture(bytes, size, size, size);
  texture.format = RGBAFormat; texture.type = UnsignedByteType;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.generateMipmaps = false; texture.unpackAlignment = 1; texture.needsUpdate = true;
  const pass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, tGlow: { value: null }, strength: { value: 0.16 },
      lut: { value: texture }, size: { value: size }, intensity: { value: 0.65 }, exposure: { value: 1.15 } },
    vertexShader: `varying vec2 vUv;
      void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `precision highp sampler3D;
      uniform sampler2D tDiffuse,tGlow; uniform sampler3D lut;
      uniform float size,intensity,exposure,strength; varying vec2 vUv; out vec4 outColor;
      vec3 encode(vec3 x){return mix(12.92*x,1.055*pow(x,vec3(1./2.4))-.055,step(vec3(.0031308),x));}
      void main(){vec4 source=texture(tDiffuse,vUv);
        #ifdef GLOW
        source.rgb+=texture(tGlow,vUv).rgb*strength;
        #endif
        vec3 hdr=max(source.rgb*exposure,vec3(0.));
        vec3 srgb=encode(hdr/(vec3(1.)+hdr));
        #ifdef GRADE
        vec3 uvw=(clamp(srgb,0.,1.)*(size-1.)+.5)/size;
        srgb=mix(srgb,texture(lut,uvw).rgb,clamp(intensity,0.,1.));
        #endif
        outColor=vec4(srgb,source.a);}`
  });
  pass.material.glslVersion = GLSL3; pass.material.blending = NoBlending;
  pass.uniforms.lut.value = texture; pass.material.toneMapped = false;
  if (grade) pass.material.defines.GRADE = '';
  const disposePass = pass.dispose.bind(pass);
  pass.dispose = () => { disposePass(); texture.dispose(); };
  /** Bloom texture to add, or null for none (recompiles once per state; programs are cached). */
  function glow(map: Texture | null) {
    if (!map === !pass.uniforms.tGlow.value) return;
    pass.uniforms.tGlow.value = map;
    if (map) pass.material.defines.GLOW = ''; else delete pass.material.defines.GLOW;
    pass.material.needsUpdate = true;
  }
  return Object.assign(pass, { glow });
}
