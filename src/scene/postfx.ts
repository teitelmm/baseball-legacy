import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export type GraphicsQuality = 'low' | 'medium' | 'high';

const QUALITY_KEY = 'baseball-legacy:graphics';

/** Saved choice, or a guess from the device (phones and software renderers start on Low). */
export function loadQuality(renderer: THREE.WebGLRenderer): GraphicsQuality {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    if (v === 'low' || v === 'medium' || v === 'high') return v;
  } catch {
    /* storage unavailable */
  }
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  if (/swiftshader|llvmpipe|software/i.test(name)) return 'low';
  if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) return 'low';
  return 'medium';
}

export function saveQuality(q: GraphicsQuality): void {
  try {
    localStorage.setItem(QUALITY_KEY, q);
  } catch {
    /* storage unavailable */
  }
}

/** Broadcast-style grade: a touch more contrast and warmth, plus the corner vignette. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 1.06);
      col = (col - 0.5) * 1.05 + 0.5;
      col *= vec3(1.015, 1.0, 0.985);
      vec2 d = vUv - 0.5;
      col *= 1.0 - smoothstep(0.42, 0.95, length(d * vec2(1.25, 1.0))) * 0.32;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

/**
 * The frame pipeline. High: ambient occlusion, bloom on the light banks, SMAA and a grade.
 * Medium: bloom, SMAA and the grade. Low: a plain render (with the vignette overlay drawn
 * by the caller), at a reduced resolution.
 */
export class PostFX {
  private composer: EffectComposer | null = null;
  private gtao: GTAOPass | null = null;
  quality: GraphicsQuality;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    quality: GraphicsQuality,
  ) {
    this.quality = quality;
    this.build();
  }

  /** True when the composer draws its own vignette (the caller should skip the overlay). */
  get graded(): boolean {
    return this.composer !== null;
  }

  setQuality(q: GraphicsQuality): void {
    if (q === this.quality) return;
    this.quality = q;
    saveQuality(q);
    this.build();
  }

  private build(): void {
    this.composer?.dispose();
    this.composer = null;
    this.gtao = null;
    const r = this.renderer;
    const dpr = Math.min(window.devicePixelRatio, 2);
    r.setPixelRatio(this.quality === 'low' ? Math.min(dpr, 1) * 0.85 : this.quality === 'medium' ? Math.min(dpr, 1.5) : dpr);
    r.shadowMap.needsUpdate = true;
    if (this.quality === 'low') return;
    const size = r.getSize(new THREE.Vector2());
    const c = new EffectComposer(r, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 }));
    c.setPixelRatio(r.getPixelRatio());
    c.setSize(size.x, size.y);
    c.addPass(new RenderPass(this.scene, this.camera));
    if (this.quality === 'high') {
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
      c.addPass(ao);
      this.gtao = ao;
    }
    // Only the brightest things bloom: the frame is linear HDR here (before tone mapping),
    // so the threshold sits above the sky and white uniforms and catches the lamp banks.
    c.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.45, 0.4, 2.4));
    c.addPass(new OutputPass());
    c.addPass(new ShaderPass(GradeShader));
    c.addPass(new SMAAPass());
    this.composer = c;
  }

  setSize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.gtao?.setSize(w, h);
  }

  render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
