import * as THREE from 'three';
import { DUSK_START, NIGHT_START, RESOURCES, STRUCTURES } from '../game/data';
import type { Game } from '../game/sim';
import type { Entity } from '../game/state';
import { MAP_SIZE, SHORE, type Terrain } from '../game/world';
import type { Art, LoadedSprite } from './art';
import { paintGround } from './ground';

const PITCH = (46 * Math.PI) / 180;
const MAX_LIGHTS = 8;
/** Height of the logs in the painted campfire, as a fraction of the sprite. */
const FLAME_AT = 0.27;
/**
 * Sun from the right and in front of the scene: shadows fall to the left and a little away from
 * the camera, so they tuck in behind the feet as in the reference (towards the camera they look detached).
 */
const SUN_DIR = { x: -0.92, z: -0.38 };
const POSES = ['pose_swing_up', 'pose_swing_down', 'pose_thrust', 'pose_hold_forward', 'pose_pickup', 'pose_paddle'];
/** Where the tool hand is on the walking frames (fraction of the sprite, y from the feet). */
const WALK_HAND: Record<'front' | 'side' | 'back', [number, number]> = { front: [0.1, 0.41], side: [0.71, 0.36], back: [0.09, 0.38] };
/** How the tool turns in each pose (radians, counter-clockwise, hero facing right). */
const TOOL_ANGLE: Record<string, number> = {
  walk: -2.4,
  pose_swing_up: 1.0,
  pose_swing_down: -1.45,
  pose_thrust: -0.8,
  pose_hold_forward: -0.55,
  pose_pickup: -1.2,
  pose_paddle: -2.2,
};
const GATHER_TUFTS = ['tuft_1', 'tuft_4'];
/** Three tall palms for every young one. */
const PALMS = ['palm_1', 'palm_2', 'palm_3', 'palm_4', 'palm_1', 'palm_2', 'palm_3'];
/** Slim upright things: their shadow is thrown like a person's (see placeCast). */
const ROUND = new Set(['tree', 'palm', 'sapling', 'grass_tuft', 'boar', 'torch_post', 'vines']);
/** Natural things: every one a little different in size, proportions and colour. */
const NATURAL = new Set(['boulder', 'cliff', 'stones', 'tree', 'palm', 'berry_bush', 'grass_tuft', 'sapling', 'vines']);
/** Things that bend in the wind, and how much. */
const SWAY: Partial<Record<string, number>> = { palm: 0.6, tree: 0.5, sapling: 1, grass_tuft: 1.4, berry_bush: 0.7, vines: 0.8 };

/** Uniforms shared by every material: one place to set daylight and fire light. */
const shared = {
  uAmbient: { value: new THREE.Color(1, 1, 1) },
  uLights: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4()) },
  uLightCount: { value: 0 },
  uTime: { value: 0 },
  uStorm: { value: 0 },
  uDry: { value: 0 },
  /** Ponds (x, z, radius): shadows fade on their water. */
  uPonds: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
  uPondCount: { value: 0 },
};

const LIGHT_GLSL = /* glsl */ `
  uniform vec3 uAmbient;
  uniform vec4 uLights[${MAX_LIGHTS}];
  uniform int uLightCount;
  uniform float uTime;
  uniform float uStorm;
  uniform float uDry;
  /** Dry season: greens turn straw-yellow. */
  vec3 applySeason(vec3 col) {
    float green = smoothstep(0.0, 0.12, col.g - max(col.r, col.b));
    vec3 straw = col * vec3(1.22, 1.0, 0.6) + vec3(0.05, 0.02, 0.0);
    return mix(col, straw, green * uDry * 0.6);
  }
  vec3 applyLight(vec3 col, vec3 wpos) {
    vec3 l = uAmbient;
    // Firelight matters in the dark; in full daylight it is barely visible.
    float dark = clamp(1.15 - uAmbient.g, 0.0, 1.0);
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      if (i >= uLightCount) break;
      vec4 L = uLights[i];
      float d = distance(wpos.xz, vec2(L.x, L.z));
      float a = 1.0 - smoothstep(L.w * 0.25, L.w, d);
      l += vec3(1.0, 0.72, 0.42) * a * L.y * dark;
    }
    return col * min(l, vec3(1.3));
  }
`;

const SPRITE_VERT = /* glsl */ `
  uniform float uSway;
  uniform float uWindAmp;
  uniform float uTime;
  uniform float uStorm;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vInst;
  void main() {
    vUv = uv;
    vInst = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vInst = instanceColor;
    #endif
    // Wind: the top leans, the base stays put. uSway is set per object; uWindAmp lets shared
    // materials (decor grass) sway out of step, with the phase taken from where each one stands.
    mat4 mm = modelMatrix;
    #ifdef USE_INSTANCING
      mm = modelMatrix * instanceMatrix;
    #endif
    vec3 p = position;
    vec3 o = mm[3].xyz;
    float gust = sin(uTime * (1.3 + uStorm * 2.2) + o.x * 0.7 + o.z * 0.45) + 0.35 * sin(uTime * 2.9 + o.x * 1.3);
    p.x += (uSway + uWindAmp * (0.03 + uStorm * 0.1) * gust) * p.y;
    vec4 w = mm * vec4(p, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const SPRITE_FRAG = /* glsl */ `
  ${LIGHT_GLSL}
  uniform sampler2D map;
  uniform float uFlash;
  uniform float uOpacity;
  uniform vec3 uTint;
  uniform float uUnlit;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vInst;
  void main() {
    vec4 c = texture2D(map, vUv);
    if (c.a < 0.45) discard;
    vec3 col = c.rgb * uTint * vInst;
    col = mix(applyLight(applySeason(col), vWorld), col, uUnlit);
    col = mix(col, vec3(1.0, 0.35, 0.3), uFlash);
    gl_FragColor = vec4(col, uOpacity);
  }
`;

/**
 * The hero: legs are bent in the texture lookup, so one painted frame walks smoothly.
 * uStride spreads the legs (side view), uLift raises one foot (front and back views).
 */
const HERO_FRAG = /* glsl */ `
  ${LIGHT_GLSL}
  uniform sampler2D map;
  uniform float uFlash;
  uniform float uFootX;
  uniform float uStride;
  uniform float uSwing;
  uniform vec2 uLift;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vec2 uv = vUv;
    float leg = clamp(1.0 - uv.y / 0.42, 0.0, 1.0);
    float side = uv.x < uFootX ? -1.0 : 1.0;
    uv.x -= side * uStride * leg + uSwing * leg * leg;
    uv.y -= (side < 0.0 ? uLift.x : uLift.y) * leg;
    vec4 c = texture2D(map, uv);
    if (uv.y < 0.0 || c.a < 0.45) discard;
    vec3 col = applyLight(c.rgb, vWorld);
    col = mix(col, vec3(1.0, 0.35, 0.3), uFlash);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * The hero's fist, cut out of the hero picture and drawn again over the tool's handle, so the
 * fingers close round the handle instead of the tool lying on top of the hand.
 */
const HAND_FRAG = /* glsl */ `
  ${LIGHT_GLSL}
  uniform sampler2D map;
  uniform vec2 uHand;
  uniform float uAspect;
  uniform float uR;
  uniform float uFlash;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vec2 d = (vUv - uHand) * vec2(uAspect, 1.0);
    if (length(d) > uR) discard;
    vec4 c = texture2D(map, vUv);
    if (c.a < 0.45) discard;
    vec3 col = mix(applyLight(c.rgb, vWorld), vec3(1.0, 0.35, 0.3), uFlash);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Contact shadow right under an object. */
const SHADOW_FRAG = /* glsl */ `
  ${LIGHT_GLSL}
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vec4 c = texture2D(map, vUv);
    float day = clamp(uAmbient.r, 0.0, 1.0);
    gl_FragColor = vec4(0.07, 0.05, 0.02, c.a * 0.55 * day);
  }
`;

/**
 * Silhouette shadow: the sprite itself laid on the ground away from the sun.
 * Softer and lighter the further it is from the object's foot.
 */
/**
 * Contact edge: drawn in the sprite's own plane, just behind it, shifted down by uDrop, so a soft
 * dark rim peeks out along the painted bottom outline, including where that outline climbs
 * towards the back of a rock. Only the lower part of the sprite casts it (no rims under
 * overhangs in mid-air).
 */
const CONTACT_FRAG = /* glsl */ `
  ${LIGHT_GLSL}
  uniform sampler2D map;
  uniform float uDrop;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vec2 uv = vUv + vec2(0.0, uDrop);
    float r = uDrop * 0.6;
    float a = texture2D(map, uv).a * 0.4
      + (texture2D(map, uv + vec2(r, 0.0)).a + texture2D(map, uv - vec2(r, 0.0)).a
       + texture2D(map, uv + vec2(0.0, r)).a + texture2D(map, uv - vec2(0.0, r)).a) * 0.15;
    float day = smoothstep(0.35, 0.85, uAmbient.r);
    a *= 0.85 * (0.45 + 0.55 * day) * (1.0 - smoothstep(0.12, 0.4, vUv.y));
    if (a < 0.004) discard;
    gl_FragColor = vec4(0.06, 0.05, 0.02, a);
  }
`;

const SILHOUETTE_FRAG = /* glsl */ `
  ${LIGHT_GLSL}
  uniform sampler2D map;
  uniform vec3 uPonds[8];
  uniform int uPondCount;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    float r = 0.004 + 0.025 * vUv.y;
    float a = texture2D(map, vUv).a * 0.36
      + texture2D(map, vUv + vec2(r, 0.0)).a * 0.16 + texture2D(map, vUv - vec2(r, 0.0)).a * 0.16
      + texture2D(map, vUv + vec2(0.0, r)).a * 0.16 + texture2D(map, vUv - vec2(0.0, r)).a * 0.16;
    float day = smoothstep(0.35, 0.85, uAmbient.r);
    a *= 0.42 * day * (1.0 - 0.45 * vUv.y) * (1.0 - uStorm * 0.7);
    // Water does not take a shadow like grass: much fainter on a pond.
    for (int i = 0; i < 8; i++) {
      if (i >= uPondCount) break;
      float dd = distance(vWorld.xz, uPonds[i].xy) / uPonds[i].z;
      a *= mix(0.25, 1.0, smoothstep(0.9, 1.08, dd));
    }
    if (a < 0.004) discard;
    gl_FragColor = vec4(0.10, 0.08, 0.03, a);
  }
`;

const GROUND_FRAG = /* glsl */ `
  ${LIGHT_GLSL}
  uniform sampler2D map;
  uniform sampler2D uHeight;
  uniform sampler2D uGrass;
  uniform vec3 uGrassMean;
  uniform float uHasGrass;
  uniform sampler2D uSand;
  uniform vec3 uSandMean;
  uniform float uHasSand;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    // Fine height channel: -0.25..0.25 around the shoreline.
    float h = texture2D(uHeight, vWorld.xz / ${MAP_SIZE.toFixed(1)}).g * 0.5 - 0.25;
    float a = smoothstep(-0.012, 0.022, h);
    if (a < 0.01) discard;
    vec4 c = texture2D(map, vUv);
    // Painted grass detail where the ground is green; the base colour still comes from the map.
    float green = smoothstep(0.3, 0.42, (c.g - c.b) / max(c.g, 0.01)) * uHasGrass;
    vec3 detail = 1.0 + (texture2D(uGrass, vWorld.xz / 3.0).rgb / uGrassMean - 1.0) * 2.2;
    c.rgb *= mix(vec3(1.0), detail, green);
    // Painted sand grain on the beaches.
    float sandy = smoothstep(0.16, 0.26, c.r - c.b) * (1.0 - green) * uHasSand;
    vec3 grain = 1.0 + (texture2D(uSand, vWorld.xz / 3.5).rgb / uSandMean - 1.0) * 1.6;
    c.rgb *= mix(vec3(1.0), grain, sandy);
    gl_FragColor = vec4(applyLight(applySeason(c.rgb), vWorld), a);
  }
`;

/**
 * A painted top-down background (the start bay). The painting gives shapes and colours;
 * the shader adds grass detail, shimmering water, foam that breathes towards the shore,
 * storm darkening, and fades the edges into the generated island.
 */
const BACKDROP_FRAG = /* glsl */ `
  ${LIGHT_GLSL}
  uniform sampler2D map;
  uniform sampler2D uGrass;
  uniform vec3 uGrassMean;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vec3 c = texture2D(map, vUv).rgb;
    float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.86, vUv.x)
      * smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y);
    float water = smoothstep(0.0, 0.08, c.b - c.r);
    float foam = smoothstep(0.7, 0.86, min(min(c.r, c.g), c.b));
    float green = smoothstep(0.3, 0.42, (c.g - c.b) / max(c.g, 0.01)) * (1.0 - water);
    vec3 detail = 1.0 + (texture2D(uGrass, vWorld.xz / 3.0).rgb / uGrassMean - 1.0) * 1.6;
    vec3 col = c * mix(vec3(1.0), detail, green);
    col = mix(col, applySeason(col), 1.0 - water);
    // Water: slow light ripples and sparkles; foam brightens in waves running to the shore.
    float w = sin(vWorld.x * 0.9 + uTime * 0.8) + sin(vWorld.z * 0.7 - uTime * 1.1) + sin((vWorld.x + vWorld.z) * 0.35 + uTime * 0.5);
    col += vec3(0.022) * w * water;
    float sp = sin(vWorld.x * 3.1 + uTime * 1.7) * sin(vWorld.z * 2.7 - uTime * 1.3);
    col += vec3(0.1) * smoothstep(0.94, 1.0, sp) * water * (1.0 - foam);
    col += vec3(0.1) * foam * sin(uTime * 1.6 - vWorld.x * 1.4 + sin(vWorld.z * 0.5));
    col = mix(col, vec3(0.16, 0.30, 0.38), uStorm * 0.5 * water);
    gl_FragColor = vec4(applyLight(col, vWorld), edge);
  }
`;

/**
 * A pond: a wobbly round of fresh water, shallow and light at the edge, darker in the middle,
 * with ripples and glints, a bright line where it meets the bank and a rim of wet earth.
 */
const POND_FRAG = /* glsl */ `
  ${LIGHT_GLSL}
  uniform float uSeed;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    float ang = atan(q.y, q.x);
    float wob = 1.0 + 0.06 * sin(ang * 3.0 + uSeed) + 0.04 * sin(ang * 5.0 + uSeed * 2.0);
    float d = length(q) * 1.3 / wob; // 1.0 = the water's edge
    if (d > 1.22) discard;
    vec3 shallow = vec3(0.40, 0.64, 0.58);
    vec3 deep = vec3(0.15, 0.35, 0.41);
    vec3 water = mix(shallow, deep, smoothstep(0.05, 0.85, 1.0 - d));
    float w = sin(vWorld.x * 1.7 + uTime * 0.9) + sin(vWorld.z * 1.3 - uTime * 1.2);
    water += 0.022 * w;
    float sp = sin(vWorld.x * 4.1 + uTime * 1.5) * sin(vWorld.z * 3.3 - uTime * 1.1);
    water += vec3(0.05) * smoothstep(0.96, 1.0, sp) * (1.0 - smoothstep(0.7, 0.95, d));
    float edgeLine = smoothstep(0.88, 0.97, d) * (1.0 - smoothstep(0.97, 1.0, d));
    water = mix(water, vec3(0.86, 0.9, 0.82), edgeLine * 0.4);
    water = mix(water, vec3(0.16, 0.30, 0.38), uStorm * 0.4);
    vec3 mud = vec3(0.40, 0.34, 0.21);
    vec3 col = d < 1.0 ? water : mix(mud * 0.85, mud, (d - 1.0) / 0.22);
    float a = d < 1.0 ? 1.0 : (1.0 - smoothstep(1.06, 1.22, d)) * 0.85;
    gl_FragColor = vec4(applyLight(col, vWorld), a);
  }
`;

/**
 * A painted pond (seen from above): the picture gives water, lily pads, weed and the bank.
 * The shader adds slow ripples and glints on open water and the shadows of two fish that
 * circle under the surface.
 */
const POND_PAINTED_FRAG = /* glsl */ `
  ${LIGHT_GLSL}
  uniform sampler2D map;
  uniform float uSeed;
  varying vec2 vUv;
  varying vec3 vWorld;
  float fish(vec2 uv, float speed, float rad, float ph) {
    float t = uTime * speed + ph;
    vec2 c = vec2(0.5) + rad * vec2(cos(t), sin(t * 0.8));
    vec2 dir = normalize(vec2(-sin(t), cos(t * 0.8) * 0.8));
    vec2 d = uv - c;
    float along = dot(d, dir);
    float across = dot(d, vec2(-dir.y, dir.x));
    return 1.0 - smoothstep(0.6, 1.0, length(vec2(along / 0.045, across / 0.016)));
  }
  void main() {
    vec4 c = texture2D(map, vUv);
    if (c.a < 0.05) discard;
    float water = smoothstep(0.0, 0.08, c.b - c.r + 0.06) * (1.0 - smoothstep(0.35, 0.4, distance(vUv, vec2(0.5))));
    vec3 col = c.rgb;
    float w = sin(vWorld.x * 1.7 + uTime * 0.9) + sin(vWorld.z * 1.3 - uTime * 1.2);
    col += 0.02 * w * water;
    float sp = sin(vWorld.x * 4.1 + uTime * 1.5) * sin(vWorld.z * 3.3 - uTime * 1.1);
    col += vec3(0.06) * smoothstep(0.95, 1.0, sp) * water;
    float f = max(fish(vUv, 0.35, 0.16, uSeed), fish(vUv, -0.27, 0.22, uSeed * 1.7 + 2.0));
    col = mix(col, col * 0.55, f * water * 0.6);
    col = mix(col, vec3(0.16, 0.30, 0.38), uStorm * 0.35 * water);
    gl_FragColor = vec4(applyLight(col, vWorld), c.a);
  }
`;

const WATER_FRAG = /* glsl */ `
  ${LIGHT_GLSL}
  uniform sampler2D uHeight;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vec2 m = vWorld.xz / ${MAP_SIZE.toFixed(1)};
    float h = -1.0;
    if (m.x > 0.0 && m.y > 0.0 && m.x < 1.0 && m.y < 1.0) h = texture2D(uHeight, m).r * 2.0 - 1.0;
    float depth = clamp(-h, 0.0, 1.0);
    vec3 shallow = vec3(0.36, 0.68, 0.64);
    vec3 mid = vec3(0.20, 0.47, 0.50);
    vec3 deep = vec3(0.15, 0.29, 0.37);
    vec3 col = mix(shallow, mid, smoothstep(0.0, 0.1, depth));
    col = mix(col, deep, smoothstep(0.1, 0.45, depth));
    float w = sin(vWorld.x * 0.9 + uTime * 0.8) + sin(vWorld.z * 0.7 - uTime * 1.1) + sin((vWorld.x + vWorld.z) * 0.35 + uTime * 0.5);
    col = mix(col, vec3(0.16, 0.30, 0.38), uStorm * 0.55);
    col += vec3(0.03 + uStorm * 0.05) * w;
    // Surf: animated foam lines running towards the shore.
    float band = 1.0 - smoothstep(0.0, 0.045, depth);
    float lines = smoothstep(0.6, 0.92, sin(depth * 200.0 - uTime * (2.2 + uStorm * 3.0) + sin(vWorld.x * 0.8 + vWorld.z * 0.5) * 1.5));
    float edge = 1.0 - smoothstep(0.0, 0.008, depth);
    float foam = band * (0.12 + 0.8 * lines) + edge * 0.6;
    col = mix(col, vec3(0.97, 0.98, 0.95), foam * 0.85);
    // Small sparkles in deeper water.
    float sp = sin(vWorld.x * 3.1 + uTime * 1.7) * sin(vWorld.z * 2.7 - uTime * 1.3);
    col += vec3(0.12) * smoothstep(0.93, 1.0, sp) * smoothstep(0.05, 0.3, depth);
    gl_FragColor = vec4(applyLight(col, vWorld), 1.0);
  }
`;

interface SpriteView {
  entity: Entity;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  shadow: THREE.Mesh;
  /** How far behind the base line the contact shadow sits. */
  shadowDepth: number;
  /** Width of the object on the ground, metres. */
  width: number;
  /** How far in front of the entity's position the picture stands (see footOffset). */
  off: number;
  /** This object's own size and proportions (natural things differ from one another). */
  vw: number;
  vh: number;
  /** Silhouette cast on the ground. */
  cast: THREE.Mesh;
  /** Dark footprint right under the object (same silhouette, squashed straight back). */
  ao: THREE.Mesh;
  /** Dark rim along the painted bottom outline (broad painted objects only). */
  contact?: THREE.Mesh;
  castMat: THREE.ShaderMaterial;
  key: string;
  flame?: THREE.Mesh;
  /** Wildfire flames on a burning object. */
  fire?: THREE.Mesh;
}

export class WorldView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private textures = new Map<string, THREE.Texture>();
  private geometries = new Map<string, THREE.PlaneGeometry>();
  private views = new Map<number, SpriteView>();
  private hero!: {
    group: THREE.Group;
    mesh: THREE.Mesh;
    mat: THREE.ShaderMaterial;
    shadow: THREE.Mesh;
    cast: THREE.Mesh;
    castMat: THREE.ShaderMaterial;
    tool: THREE.Mesh;
    toolMat: THREE.ShaderMaterial;
    view: 'front' | 'side' | 'back';
    phase: number;
    lastX: number;
    lastZ: number;
  };
  private ghost: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; key: string } | null = null;
  private shadowMat: THREE.ShaderMaterial;
  private bobber!: THREE.Mesh;
  private fishLine!: THREE.Line;
  private arrows: THREE.Mesh[] = [];
  private heightTex!: THREE.DataTexture;
  private grassTex!: THREE.Texture;
  private heroAo!: THREE.Mesh;
  private heroBody!: THREE.Group;
  private heroHand!: THREE.Mesh;
  private clock = 0;
  private sprites: Record<string, LoadedSprite>;
  zoom = 13;
  readonly groundCanvas: HTMLCanvasElement;

  constructor(
    container: HTMLElement,
    private game: Game,
    private art: Art,
  ) {
    this.sprites = art.sprites;
    // Painted sprites fall back to the vector placeholders when missing.
    const alias = (key: string, fallback: string) => {
      if (!this.sprites[key]) this.sprites[key] = this.sprites[fallback];
    };
    for (const k of ['hero_front', 'hero_side', 'hero_back', ...POSES]) alias(k, 'player_0');
    alias('tent', 'shelter');
    alias('boulder_2', 'boulder_0');
    alias('boulder_3', 'boulder_1');
    alias('cliff_1', 'boulder_0');
    alias('cliff_2', 'cliff_1');
    alias('cliff_3', 'cliff_1');
    alias('flame_2', 'flame');
    for (let i = 1; i <= 3; i++) {
      alias(`bush_${i}`, 'berry_bush_empty');
      alias(`bush_berries_${i}`, 'berry_bush');
      alias(`sapling_${i}`, 'sapling');
      alias(`sticks_${i}`, 'item_twigs');
    }
    alias('stones_1', 'item_stone');

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x2b525f);
    container.appendChild(this.renderer.domElement);
    // Soft warm darkening at the edges, like the reference painting.
    const vignette = document.createElement('div');
    vignette.className = 'vignette';
    container.appendChild(vignette);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 400);
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.groundCanvas = paintGround(game.terrain);
    this.buildWater(game.terrain);
    this.buildGround();

    this.shadowMat = new THREE.ShaderMaterial({
      uniforms: { ...shared, map: { value: this.texture('shadow') } },
      vertexShader: SPRITE_VERT,
      fragmentShader: SHADOW_FRAG,
      transparent: true,
      depthWrite: false,
    });

    this.buildBackdrop();
    this.buildPonds();
    this.buildHero();
    this.buildDecor();

    // Fishing float and line.
    const bm = this.spriteMaterial('bobber');
    this.bobber = new THREE.Mesh(this.geometry('bobber'), bm);
    this.bobber.rotation.x = -PITCH;
    this.bobber.visible = false;
    this.fishLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0x3d2b1f }),
    );
    this.fishLine.visible = false;
    this.scene.add(this.bobber, this.fishLine);
    this.syncEntities();
  }

  private buildHero() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        map: { value: this.texture('hero_front') },
        uFlash: { value: 0 },
        uFootX: { value: 0.5 },
        uStride: { value: 0 },
        uSwing: { value: 0 },
        uLift: { value: new THREE.Vector2() },
      },
      vertexShader: SPRITE_VERT,
      fragmentShader: HERO_FRAG,
    });
    const mesh = new THREE.Mesh(this.geometry('hero_front'), mat);
    const toolMat = this.spriteMaterial('item_axe');
    // The handle end of an item icon (lower left) is the pivot, so the tool turns in the fist.
    const tg = new THREE.PlaneGeometry(0.8, 0.8);
    tg.translate(0.8 * 0.22, 0.8 * 0.3, 0);
    const tool = new THREE.Mesh(tg, toolMat);
    tool.visible = false;
    const handMat = new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        map: { value: this.texture('hero_front') },
        uHand: { value: new THREE.Vector2() },
        uAspect: { value: 0.4 },
        uR: { value: 0.035 },
        uFlash: { value: 0 },
      },
      vertexShader: SPRITE_VERT,
      fragmentShader: HAND_FRAG,
    });
    const handMesh = new THREE.Mesh(mesh.geometry, handMat);
    handMesh.position.z = 0.03;
    handMesh.visible = false;
    tool.position.z = 0.015;
    // body leans and sways as a whole: picture, tool and fist together.
    const body = new THREE.Group();
    body.add(mesh, tool, handMesh);
    const group = new THREE.Group();
    group.rotation.x = -PITCH;
    group.add(body);
    this.heroBody = body;
    this.heroHand = handMesh;
    const castMat = this.castMaterial('hero_front');
    const cast = new THREE.Mesh(this.geometry('hero_front'), castMat);
    cast.renderOrder = 1;
    const shadow = this.makeShadow(0.6);
    const ao = new THREE.Mesh(cast.geometry, castMat);
    ao.renderOrder = 1;
    this.heroAo = ao;
    this.scene.add(group, shadow, cast, ao);
    this.hero = { group, mesh, mat, shadow, cast, castMat, tool, toolMat, view: 'front', phase: 0, lastX: this.game.player.x, lastZ: this.game.player.z };
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private texture(key: string): THREE.Texture {
    let t = this.textures.get(key);
    if (!t) {
      const s = this.sprites[key];
      t = new THREE.CanvasTexture(s.canvas);
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = 4;
      this.textures.set(key, t);
    }
    return t;
  }

  /** World size of a sprite. */
  private size(key: string, scale = 1): { w: number; h: number } {
    const d = this.sprites[key].def;
    const h = d.size * scale;
    return { w: (h * d.w) / d.h, h };
  }

  /** Plane sized from the sprite, anchored where its feet are (bottom centre for placeholders). */
  private geometry(key: string, scale = 1): THREE.PlaneGeometry {
    const id = `${key}@${scale}`;
    let g = this.geometries.get(id);
    if (!g) {
      const { w, h } = this.size(key, scale);
      g = new THREE.PlaneGeometry(w, h);
      g.translate((0.5 - (this.sprites[key].footX ?? 0.5)) * w, h / 2, 0);
      this.geometries.set(id, g);
    }
    return g;
  }

  private spriteMaterial(key: string): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        map: { value: this.texture(key) },
        uFlash: { value: 0 },
        uOpacity: { value: 1 },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uUnlit: { value: 0 },
        uSway: { value: 0 },
      },
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
    });
  }

  private castMaterial(key: string): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { ...shared, map: { value: this.texture(key) }, uSway: { value: 0 } },
      vertexShader: SPRITE_VERT,
      fragmentShader: SILHOUETTE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  /**
   * Lays a silhouette on the ground: its height thrown away from the sun (left and back), its width
   * across the sun's direction, as for a round object. It starts from the middle of the object's
   * footprint, which for a picture drawn from above lies behind the bottom edge of the sprite;
   * starting at the bottom edge would put half the shadow in front and make things seem to hover.
   */
  private placeCast(m: THREE.Mesh, x: number, z: number, mirror: number, width: number, round: boolean, tall = 1) {
    const len = this.castLength * tall;
    m.matrixAutoUpdate = false;
    if (round) {
      const back = width * 0.45;
      m.matrix.set(
        -SUN_DIR.z * mirror, SUN_DIR.x * len, 0, x,
        0, 0, 1, 0.012,
        SUN_DIR.x * mirror, SUN_DIR.z * len, 0, z - back,
        0, 0, 0, 1,
      );
    } else {
      // Broad, solid things (rocks, the tent): the width stays along the object and the shadow
      // spreads from its base to the left, so it touches the ground line instead of hanging
      // beside the object's upper half.
      m.matrix.set(
        mirror, SUN_DIR.x * len, 0, x,
        0, 0, 1, 0.012,
        0, SUN_DIR.z * len * 0.6, 0, z - 0.05,
        0, 0, 0, 1,
      );
    }
    m.matrixWorldNeedsUpdate = true;
  }

  /**
   * The footprint: the silhouette squashed straight back from the bottom edge, a little wider and
   * a touch in front, so a soft dark rim shows where the object meets the ground.
   */
  private placeAo(m: THREE.Mesh, x: number, z: number, mirror: number, height: number, tall = 1) {
    const depth = Math.min(0.6, 1.0 / Math.max(0.3, height)) * tall;
    m.matrixAutoUpdate = false;
    m.matrix.set(
      mirror * 1.08, 0, 0, x,
      0, 0, 1, 0.011,
      0, -depth, 0, z + 0.05,
      0, 0, 0, 1,
    );
    m.matrixWorldNeedsUpdate = true;
  }

  private makeShadow(width: number): THREE.Mesh {
    const g = new THREE.PlaneGeometry(width, width * 0.5);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, this.shadowMat);
    m.position.y = 0.02;
    m.renderOrder = 1;
    return m;
  }

  private buildGround() {
    const tex = new THREE.CanvasTexture(this.groundCanvas);
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 8;
    const grassImg = this.art.textures.ground_grass;
    let grass: THREE.Texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    grass.needsUpdate = true;
    if (grassImg) {
      grass = new THREE.Texture(grassImg);
      grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
      grass.colorSpace = THREE.NoColorSpace;
      grass.anisotropy = 8;
      grass.needsUpdate = true;
    }
    this.grassTex = grass;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        map: { value: tex },
        uHeight: { value: this.heightTex },
        uGrass: { value: grass },
        uGrassMean: { value: new THREE.Vector3(...meanColor(grassImg)) },
        uHasGrass: { value: grassImg ? 1 : 0 },
        uSand: { value: this.repeatTexture(this.art.textures.ground_sand) },
        uSandMean: { value: new THREE.Vector3(...meanColor(this.art.textures.ground_sand)) },
        uHasSand: { value: this.art.textures.ground_sand ? 1 : 0 },
      },
      vertexShader: SPRITE_VERT,
      fragmentShader: GROUND_FRAG,
      transparent: true,
    });
    const g = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE);
    g.rotateX(-Math.PI / 2);
    g.translate(MAP_SIZE / 2, 0, MAP_SIZE / 2);
    // PlaneGeometry's UV v grows upwards; after rotation that is towards -z, matching canvas rows from the top.
    const ground = new THREE.Mesh(g, mat);
    ground.renderOrder = 0;
    this.scene.add(ground);
  }

  /** The painted start bay, laid on the ground where the terrain was shaped after it. */
  private buildBackdrop() {
    const bay = this.art.backdrops.bay;
    const at = this.game.terrain.bayPicture;
    if (!bay || !at) return;
    const tex = new THREE.Texture(bay.img);
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        map: { value: tex },
        uGrass: { value: this.grassTex },
        uGrassMean: { value: new THREE.Vector3(...meanColor(this.art.textures.ground_grass)) },
      },
      vertexShader: SPRITE_VERT,
      fragmentShader: BACKDROP_FRAG,
      transparent: true,
      depthWrite: false,
    });
    const g = new THREE.PlaneGeometry(at.size, at.size);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set(at.x + at.size / 2, 0.006, at.z + at.size / 2);
    m.renderOrder = 0.5;
    this.scene.add(m);
  }

  private repeatTexture(img: HTMLImageElement | undefined): THREE.Texture {
    if (!img) {
      const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
      t.needsUpdate = true;
      return t;
    }
    const t = new THREE.Texture(img);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  }

  private buildPonds() {
    const ponds = this.game.terrain.ponds;
    ponds.slice(0, 8).forEach((p, i) => shared.uPonds.value[i].set(p.x, p.z, p.r));
    shared.uPondCount.value = Math.min(8, ponds.length);
    ponds.forEach((p, i) => {
      const painted = this.sprites[`pond_${(i % 3) + 1}`];
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          ...shared,
          uSeed: { value: i * 2.3 + p.x },
          map: { value: painted?.painted ? this.texture(`pond_${(i % 3) + 1}`) : null },
        },
        vertexShader: SPRITE_VERT,
        fragmentShader: painted?.painted ? POND_PAINTED_FRAG : POND_FRAG,
        transparent: true,
        depthWrite: false,
      });
      // In the painted ponds the water fills about 76% of the picture; the rest is the bank.
      const side = painted?.painted ? (p.r * 2) / 0.76 : p.r * 2.6;
      const g = new THREE.PlaneGeometry(side, side);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mat);
      m.position.set(p.x, 0.007, p.z);
      m.renderOrder = 0.6;
      this.scene.add(m);
    });
  }

  /**
   * Decoration that nobody interacts with: shells and pebbles on the beaches, grass tufts in the
   * meadows and around the bases of rocks, trees and the camp (as in the reference, grass hides
   * the line where things meet the ground). The same for a given seed; drawn instanced.
   */
  private buildDecor() {
    const painted = (prefix: string) => Array.from({ length: 12 }, (_, i) => `${prefix}_${i + 1}`).filter((k) => this.sprites[k]?.painted);
    const shells = painted('shell');
    const pebbles = painted('pebble');
    // Decor grass: not the kinds you can pick (those would look pickable), and smaller.
    const tufts = painted('tuft').filter((k) => !GATHER_TUFTS.includes(k));
    const t = this.game.terrain;
    let seed = t.seed ^ 0x5eaf00d;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const items = new Map<string, { m: THREE.Matrix4; c: THREE.Color }[]>();
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-PITCH, 0, 0));
    const put = (list: string[], x: number, z: number, scale: number) => {
      if (!list.length || t.inPond(x, z)) return;
      const key = list[Math.floor(rnd() * list.length)];
      // Each piece its own: proportions and a slightly different shade. Pebbles and shells may be
      // flipped (no strong light in such small drawings); grass may too.
      const sx = scale * (0.88 + rnd() * 0.24) * (rnd() < 0.5 ? -1 : 1);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0.01, z), tilt, new THREE.Vector3(sx, scale, scale));
      const b = 0.88 + rnd() * 0.22;
      const warm = (rnd() - 0.5) * 0.1;
      (items.get(key) ?? items.set(key, []).get(key)!).push({ m, c: new THREE.Color(b * (1 + warm), b, b * (1 - warm)) });
    };
    const grassy = (x: number, z: number) => t.height(x, z) > 0.075 && t.biome(x, z) !== 'rock';
    const flowers = painted('flowers');
    const reeds = painted('reed');

    for (let z = 2; z < MAP_SIZE - 2; z += 1) {
      for (let x = 2; x < MAP_SIZE - 2; x += 1) {
        const r = rnd();
        const px = x + rnd();
        const pz = z + rnd();
        const h = t.height(px, pz);
        const beach = h >= 0.008 && h <= 0.05;
        if (beach && r < 0.05) put(shells, px, pz, 0.8 + rnd() * 0.5);
        else if (beach && r < 0.12) put(pebbles, px, pz, 0.8 + rnd() * 0.5);
        else if (h > 0.05 && t.biome(px, pz) === 'grass' && r < 0.012) put(pebbles, px, pz, 0.8 + rnd() * 0.5);
        else if (grassy(px, pz) && r < 0.1) put(tufts, px, pz, 0.5 + rnd() * 0.3);
        else if (grassy(px, pz) && r < 0.125 && t.biome(px, pz) === 'grass') put(flowers, px, pz, 0.8 + rnd() * 0.4);
      }
    }
    // Tufts at the foot of things, a little in front of their bottom edge so they overlap it.
    const rooted = new Set(['boulder', 'cliff', 'stones', 'shelter', 'chest', 'tree', 'palm', 'berry_bush', 'sapling', 'rain_catcher', 'salt_pan']);
    for (const e of this.game.state.entities) {
      if (!rooted.has(e.kind)) continue;
      const w = e.kind === 'tree' || e.kind === 'palm' ? 0.7 : this.size(this.keyFor(e)).w;
      const n = 2 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const side = rnd() < 0.5 ? -1 : 1;
        const x = e.x + side * w * (0.25 + rnd() * 0.3);
        const z = e.z + this.footOffset(e) + 0.04 + rnd() * 0.18;
        // Grass on the meadow, small pebbles on the sand.
        if (grassy(x, z)) put(tufts, x, z, 0.5 + rnd() * 0.35);
        else if (t.height(x, z) > 0.005) put(pebbles, x, z, 0.7 + rnd() * 0.6);
      }
    }
    // Reeds and cattails round the ponds, thickest at the back and the sides.
    for (const p of t.ponds) {
      const n = 10 + Math.floor(rnd() * 6);
      for (let i = 0; i < n; i++) {
        const a = Math.PI + (rnd() - 0.5) * Math.PI * 1.6 + (rnd() < 0.3 ? Math.PI : 0); // mostly the far side
        const rr = p.r * (0.95 + rnd() * 0.2);
        const x = p.x + Math.cos(a) * rr;
        const z = p.z + Math.sin(a) * rr * 0.9;
        if (!reeds.length) break;
        const key = reeds[Math.floor(rnd() * reeds.length)];
        const sc = 0.7 + rnd() * 0.5;
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0.01, z), tilt, new THREE.Vector3(rnd() < 0.5 ? -sc : sc, sc, sc));
        (items.get(key) ?? items.set(key, []).get(key)!).push({ m, c: new THREE.Color(1, 1, 1) });
      }
    }
    // Camp things from the reference: a water jug by the tent, a mooring post by the raft.
    const sp = this.game.terrain.bay;
    const near = (kind: string) => this.game.state.entities.find((e) => e.kind === kind && Math.hypot(e.x - sp.x, e.z - sp.z) < 14);
    const tent = near('shelter');
    if (tent && this.sprites.jug?.painted) put(['jug'], tent.x + 1.3, tent.z + this.footOffset(tent) + 0.35, 1);
    const raft = near('raft');
    if (raft && this.sprites.post?.painted) {
      for (let x = raft.x + 1; x < raft.x + 6; x += 0.25) {
        if (t.walkable(x, raft.z - 0.6)) {
          put(['post'], x + 0.2, raft.z - 0.6, 1);
          break;
        }
      }
    }
    for (const [key, list] of items) {
      const mat = this.spriteMaterial(key);
      if (key.startsWith('tuft') || key.startsWith('reed') || key.startsWith('flowers')) mat.uniforms.uWindAmp = { value: key.startsWith('reed') ? 0.7 : 1 };
      const mesh = new THREE.InstancedMesh(this.geometry(key), mat, list.length);
      list.forEach((it, i) => {
        mesh.setMatrixAt(i, it.m);
        mesh.setColorAt(i, it.c);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
    }
  }

  private buildWater(terrain: Terrain) {
    // R: coarse height -1..1 for water depth; G: fine height -0.25..0.25 for a smooth shoreline.
    const n = 1024;
    const data = new Uint8Array(n * n * 4);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const h = terrain.height(((i + 0.5) / n) * MAP_SIZE, ((j + 0.5) / n) * MAP_SIZE) - SHORE;
        const coarse = Math.max(0, Math.min(255, Math.round((h + 1) * 127.5)));
        const fine = Math.max(0, Math.min(255, Math.round(((h + 0.25) / 0.5) * 255)));
        data.set([coarse, fine, 0, 255], (j * n + i) * 4);
      }
    }
    const heightTex = new THREE.DataTexture(data, n, n);
    heightTex.magFilter = THREE.LinearFilter;
    heightTex.minFilter = THREE.LinearFilter;
    heightTex.needsUpdate = true;
    this.heightTex = heightTex;
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...shared, uHeight: { value: heightTex } },
      vertexShader: SPRITE_VERT,
      fragmentShader: WATER_FRAG,
    });
    const g = new THREE.PlaneGeometry(MAP_SIZE * 5, MAP_SIZE * 5);
    g.rotateX(-Math.PI / 2);
    g.translate(MAP_SIZE / 2, -0.03, MAP_SIZE / 2);
    const water = new THREE.Mesh(g, mat);
    water.renderOrder = -1;
    this.scene.add(water);
  }

  /** Which sprite an entity should show right now. */
  private keyFor(e: Entity): string {
    const v = e.v ?? 0;
    switch (e.kind) {
      case 'palm': return this.sprites.palm_4?.painted ? PALMS[e.id % PALMS.length] : `palm_${v % 3}`;
      case 'tree': return this.sprites.tree_6?.painted ? `tree_${(e.id % 6) + 1}` : `tree_${v % 3}`;
      case 'boulder': return `boulder_${(v % 3) + 1}`;
      case 'cliff': return `cliff_${(v % 3) + 1}`;
      case 'stones': return 'stones_1';
      case 'shelter': return 'tent';
      // Picked saplings keep their picture and are drawn shorter (see render).
      case 'sapling': return this.sprites.sapling_1?.painted ? `sapling_${(e.id % 3) + 1}` : e.regrowOn !== undefined ? 'sapling_bare' : 'sapling';
      // Grass you can pick: the two fullest tufts, full size. Decor grass uses the others, smaller.
      case 'grass_tuft': return GATHER_TUFTS[e.id % GATHER_TUFTS.length];
      case 'berry_bush':
        if (this.sprites.bush_1?.painted) return `${e.regrowOn !== undefined ? 'bush' : 'bush_berries'}_${(e.id % 3) + 1}`;
        return e.regrowOn !== undefined ? 'berry_bush_empty' : 'berry_bush';
      case 'boar': return this.sprites.boar_6?.painted ? 'boar_1' : 'boar_0';
      case 'vines': return e.regrowOn !== undefined ? 'vines_cut' : 'vines';
      case 'nest': return e.regrowOn !== undefined ? 'nest_empty' : 'nest';
      case 'salt_pan': return (e.salt ?? 0) >= 1 ? 'salt_pan_full' : 'salt_pan';
      case 'rain_catcher': return (e.water ?? 0) >= 1 ? 'rain_catcher_full' : 'rain_catcher';
      case 'drop':
        if (e.item?.item === 'twigs' && this.sprites.sticks_1?.painted) return `sticks_${(e.id % 3) + 1}`;
        return `item_${e.item?.item ?? 'stone'}`;
      default: return e.kind;
    }
  }

  /** Creates and removes meshes so they match the entity list. */
  syncEntities() {
    const alive = new Set<number>();
    for (const e of this.game.state.entities) {
      if (e.kind === 'pond') continue;
      alive.add(e.id);
      const key = this.keyFor(e);
      let v = this.views.get(e.id);
      if (v && v.key !== key && !key.startsWith('boar')) {
        this.removeView(v);
        v = undefined;
      }
      if (!v) {
        const mat = this.spriteMaterial(key);
        const mesh = new THREE.Mesh(this.geometry(key, e.kind === 'drop' && !key.startsWith('sticks') ? 0.7 : 1), mat);
        mesh.rotation.x = -PITCH;
        const { w } = this.size(key);
        const sw = Math.min(3.2, w * (e.kind === 'palm' ? 0.35 : 0.75));
        const shadow = this.makeShadow(sw);
        const castMat = this.castMaterial(key);
        const cast = new THREE.Mesh(this.geometry(key, e.kind === 'drop' ? 0.7 : 1), castMat);
        cast.renderOrder = 1;
        cast.visible = e.kind !== 'drop' && e.kind !== 'raft';
        const ao = new THREE.Mesh(cast.geometry, castMat);
        ao.renderOrder = 1;
        shadow.visible = false;
        let contact: THREE.Mesh | undefined;
        if (this.sprites[key].painted && !ROUND.has(e.kind) && e.kind !== 'drop' && e.kind !== 'raft') {
          const cm = new THREE.ShaderMaterial({
            uniforms: { ...shared, map: { value: this.texture(key) }, uDrop: { value: 0.1 / this.size(key).h }, uSway: { value: 0 } },
            vertexShader: SPRITE_VERT,
            fragmentShader: CONTACT_FRAG,
            transparent: true,
            depthWrite: false,
          });
          contact = new THREE.Mesh(mesh.geometry, cm);
          contact.rotation.x = -PITCH;
          contact.renderOrder = 1;
          this.scene.add(contact);
        }
        // Natural objects: each one slightly different, decided by its id (so stable across saves).
        let vw = 1;
        let vh = 1;
        if (NATURAL.has(e.kind)) {
          const hsh = (n: number) => {
            const x = Math.sin(e.id * 12.9898 + n * 78.233) * 43758.5453;
            return x - Math.floor(x);
          };
          vh = 0.87 + 0.26 * hsh(1);
          vw = vh * (0.9 + 0.2 * hsh(2));
          const b = 0.9 + 0.18 * hsh(3);
          const warm = (hsh(4) - 0.5) * 0.08;
          mat.uniforms.uTint.value.setRGB(b * (1 + warm), b, b * (1 - warm));
        }
        v = { entity: e, mesh, mat, shadow, cast, castMat, ao, contact, key, off: this.footOffset(e), vw, vh, shadowDepth: sw * 0.25 - 0.05, width: e.kind === 'palm' || e.kind === 'tree' ? 0.5 : w };
        if (e.kind === 'campfire') {
          const fm = this.spriteMaterial('flame');
          fm.uniforms.uUnlit.value = 1;
          v.flame = new THREE.Mesh(this.geometry('flame'), fm);
          v.flame.rotation.x = -PITCH;
          this.scene.add(v.flame);
        }
        this.scene.add(mesh, shadow, cast, ao);
        this.views.set(e.id, v);
      }
      v.entity = e;
    }
    for (const [id, v] of this.views) if (!alive.has(id)) this.removeView(v);
  }

  private removeView(v: SpriteView) {
    this.scene.remove(v.mesh, v.shadow, v.cast, v.ao);
    if (v.contact) {
      this.scene.remove(v.contact);
      (v.contact.material as THREE.ShaderMaterial).dispose();
    }
    if (v.flame) this.scene.remove(v.flame);
    if (v.fire) this.scene.remove(v.fire);
    v.mat.dispose();
    v.castMat.dispose();
    this.views.delete(v.entity.id);
  }

  /** Placement preview for buildings. */
  setGhost(key: string | null, x = 0, z = 0, valid = true) {
    if (!key) {
      if (this.ghost) this.scene.remove(this.ghost.mesh);
      this.ghost = null;
      return;
    }
    if (!this.ghost || this.ghost.key !== key) {
      if (this.ghost) this.scene.remove(this.ghost.mesh);
      const mat = this.spriteMaterial(key);
      mat.transparent = true;
      mat.uniforms.uOpacity.value = 0.6;
      const mesh = new THREE.Mesh(this.geometry(key), mat);
      mesh.rotation.x = -PITCH;
      mesh.renderOrder = 5;
      this.ghost = { mesh, mat, key };
      this.scene.add(mesh);
    }
    this.ghost.mesh.position.set(x, 0, z);
    this.ghost.mat.uniforms.uTint.value.set(valid ? 0.8 : 1.4, valid ? 1.3 : 0.5, valid ? 0.8 : 0.5);
  }

  // ---------------- Per frame ----------------

  render(dt: number) {
    this.clock += dt;
    shared.uTime.value = this.clock;
    const g = this.game;
    const p = g.player;

    // Daylight.
    shared.uStorm.value = g.storm;
    shared.uDry.value = g.dryness;
    const gloom = Math.max(g.storm, g.rain * 0.35);
    shared.uAmbient.value.copy(ambientFor(g.state.time)).multiply(new THREE.Color(1 - 0.42 * gloom, 1 - 0.36 * gloom, 1 - 0.25 * gloom));
    const lights = g.lights().sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    const n = Math.min(MAX_LIGHTS, lights.length);
    for (let i = 0; i < n; i++) {
      const flicker = 1 + Math.sin(this.clock * 13 + i * 3) * 0.04 + Math.sin(this.clock * 7.3 + i) * 0.05;
      shared.uLights.value[i].set(lights[i].x, 1.1, lights[i].z, lights[i].r * flicker);
    }
    shared.uLightCount.value = n;

    this.updateHero(dt);

    // Fishing: the float bobs, and dips when a fish bites.
    const float = g.bobber;
    this.bobber.visible = this.fishLine.visible = !!float;
    if (float) {
      const dip = g.biting ? -0.12 + Math.sin(this.clock * 30) * 0.06 : Math.sin(this.clock * 3) * 0.03;
      this.bobber.position.set(float.x, dip, float.z);
      const tip = new THREE.Vector3(p.x + g.facing * 0.9, 1.6 + (p.onRaft !== undefined ? 0.28 : 0), p.z + 0.1);
      const pos = this.fishLine.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, tip.x, tip.y, tip.z);
      pos.setXYZ(1, float.x, 0.25 + dip, float.z);
      pos.needsUpdate = true;
    }

    // Arrows in flight follow a low arc.
    while (this.arrows.length < g.projectiles.length) {
      const m = new THREE.Mesh(this.geometry('item_arrow', 1.1), this.spriteMaterial('item_arrow'));
      m.rotation.x = -PITCH;
      this.scene.add(m);
      this.arrows.push(m);
    }
    this.arrows.forEach((m, i) => {
      const pr = g.projectiles[i];
      m.visible = !!pr;
      if (!pr) return;
      const k = pr.t / pr.dur;
      const x = pr.x0 + (pr.x1 - pr.x0) * k;
      const z = pr.z0 + (pr.z1 - pr.z0) * k;
      m.position.set(x, 0.6 + Math.sin(k * Math.PI) * 0.8, z);
      // The icon points up-right (45°); turn it along the screen direction of flight.
      const ang = Math.atan2(-(pr.z1 - pr.z0) * Math.sin(PITCH), pr.x1 - pr.x0);
      m.rotation.set(-PITCH, 0, ang - Math.PI / 4);
    });

    // Entities. Far ones are hidden and skipped.
    for (const v of this.views.values()) {
      const e = v.entity;
      const far = Math.abs(e.x - p.x) > 40 || Math.abs(e.z - p.z) > 34;
      v.mesh.visible = !far;
      v.shadow.visible = !far;
      v.cast.visible = !far && e.kind !== 'drop' && e.kind !== 'raft';
      v.ao.visible = v.cast.visible;
      if (v.contact) v.contact.visible = !far;
      v.shadow.visible = false;
      if (v.flame) v.flame.visible = !far;
      if (far && e.kind !== 'boar') continue;
      let sx = 1;
      let sy = 1;
      let y = 0;
      if (e.kind === 'boar') {
        const b = g.brain(e);
        v.mat.uniforms.uFlash.value = b.hurt > 0 ? 0.6 : 0;
        sx = b.facing;
        if (this.sprites.boar_6?.painted) {
          // Painted gallop: six frames, faster when charging; standing = the first frame.
          const fps = b.mode === 'wander' ? 7 : 15;
          const f = b.moving ? (Math.floor(this.clock * fps + e.id * 0.7) % 6) + 1 : 1;
          v.mat.uniforms.map.value = v.castMat.uniforms.map.value = this.texture(`boar_${f}`);
        } else {
          const walking = b.moving && Math.sin(this.clock * (b.mode === 'wander' ? 8 : 16) + e.id) > 0;
          v.mat.uniforms.map.value = v.castMat.uniforms.map.value = this.texture(walking ? 'boar_1' : 'boar_0');
          y = b.moving ? Math.abs(Math.sin(this.clock * 12 + e.id)) * 0.06 : 0;
        }
      } else if (SWAY[e.kind]) {
        // Sway in the wind: gentle gusts on a calm day, hard bending in a storm.
        const gust = 0.6 + 0.4 * Math.sin(this.clock * 0.37 + e.x * 0.05);
        const swing = Math.sin(this.clock * (1.1 + g.storm * 2.2) + e.id * 1.7) + 0.35 * Math.sin(this.clock * 2.9 + e.id);
        const lean = g.storm * 0.12 * Math.sign(g.wind.x || 1);
        v.mat.uniforms.uSway.value = v.castMat.uniforms.uSway.value = SWAY[e.kind]! * ((0.018 + g.storm * 0.07) * gust * swing + lean) * (1 + g.rain * 0.3);
      } else if (e.kind === 'raft') {
        y = Math.sin(this.clock * 2.2 + e.id) * 0.05 + 0.02;
        v.mesh.rotation.z = Math.sin(this.clock * 1.7 + e.id) * (0.02 + g.storm * 0.05);
        v.shadow.visible = false;
      } else if (e.kind === 'drop') {
        // (handled below)
      }
      if (e.kind === 'grass_tuft' && e.regrowOn !== undefined) sy = 0.3; // cut down to stubble
      if (e.kind === 'sapling' && e.regrowOn !== undefined && this.sprites[v.key].painted) sy = 0.55; // twigs broken off
      if (e.kind === 'drop') {
        y = 0.05 + Math.sin(this.clock * 3 + e.id) * 0.04;
      }
      const wobble = (e.work ?? 0) > 0 ? Math.sin(this.clock * 40) * 0.03 : 0;
      // The picture's bottom edge is the front of the object's footprint; the entity's position
      // (and its collision circle) is the middle of it.
      const z = e.z + v.off;
      sx *= v.vw;
      sy *= v.vh;
      v.mesh.position.set(e.x + wobble, y, z);
      v.mesh.scale.set(sx, sy, 1);
      v.shadow.position.set(e.x, 0.02, z - v.shadowDepth);
      if (v.cast.visible) {
        this.placeCast(v.cast, e.x, z, sx, v.width * v.vw, ROUND.has(e.kind), v.vh);
        this.placeAo(v.ao, e.x, z, sx, this.size(v.key).h * v.vh, v.vh);
      }
      if (v.contact) {
        // Same place as the sprite, 3 cm behind its plane so the sprite covers all but the rim.
        v.contact.position.set(e.x + wobble, y - 0.03 * Math.sin(PITCH), z - 0.03 * Math.cos(PITCH));
        v.contact.scale.set(sx, sy, 1);
      }
      const onFire = (e.burn ?? 0) > 0;
      if (onFire && !v.fire) {
        const fm = this.spriteMaterial('flame');
        fm.uniforms.uUnlit.value = 1;
        v.fire = new THREE.Mesh(this.geometry('flame'), fm);
        v.fire.rotation.x = -PITCH;
        this.scene.add(v.fire);
      }
      if (v.fire) {
        v.fire.visible = onFire;
        if (onFire) {
          const big = e.kind === 'tree' || e.kind === 'palm' || e.kind === 'shelter' ? 2 : 1;
          v.fire.position.set(e.x, 0.1, z + 0.05);
          v.fire.material = this.flameFrame(e.id);
          v.fire.scale.set(big * (1 + Math.sin(this.clock * 15 + e.id) * 0.08), big * (1 + Math.sin(this.clock * 9 + e.id) * 0.12), 1);
        }
      }
      if (v.flame) {
        const burning = (e.fuel ?? 0) > 0;
        v.flame.visible = burning;
        if (burning) {
          const k = 0.45 + 0.55 * Math.min(1, (e.fuel ?? 0) / 120);
          // Over the logs in the middle of the painted fire ring: up the sprite's plane by
          // FLAME_AT of its height, then a little towards the camera so the flame is in front.
          const s = this.size(v.key).h * (this.sprites[v.key].painted ? FLAME_AT : 0.1);
          v.flame.position.set(e.x, s * Math.cos(PITCH) + 0.06 * Math.sin(PITCH), z - s * Math.sin(PITCH) + 0.06 * Math.cos(PITCH));
          v.flame.material = this.flameFrame(e.id);
          // A small fire under the pot, as in the reference. The painted flame is drawn small already.
          const f = this.sprites.flame.painted ? 1 : this.sprites[v.key].painted ? 0.4 : 1;
          v.flame.scale.set(f * k * (1 + Math.sin(this.clock * 17 + e.id) * 0.06), f * k * (1 + Math.sin(this.clock * 11) * 0.1), 1);
        }
      }
    }

    // Camera follows the player.
    const desired = new THREE.Vector3(p.x, 0.8 + Math.sin(PITCH) * this.zoom, p.z + Math.cos(PITCH) * this.zoom);
    this.camera.position.lerp(desired, Math.min(1, dt * 6));
    if (this.camera.position.distanceTo(desired) > 30) this.camera.position.copy(desired);
    // Fixed pitch: look along the same direction wherever the camera is.
    const cam = this.camera.position;
    this.camera.lookAt(cam.x, cam.y - Math.sin(PITCH) * this.zoom, cam.z - Math.cos(PITCH) * this.zoom);

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * How far in front of an entity's position its picture stands. A painted rock's bottom edge is
   * the front of its footprint, which reaches back about as far as the object is wide; the
   * collision circle must sit in the middle of that footprint, or the hero walks into the back
   * half of the rock. Slim things (trees, the hero) stand on their own base point.
   */
  private footOffset(e: Entity): number {
    if (ROUND.has(e.kind)) return 0;
    const res = (RESOURCES as Record<string, { solid?: number }>)[e.kind];
    const str = (STRUCTURES as Record<string, { solid: number }>)[e.kind];
    return (res?.solid ?? str?.solid ?? 0) * 0.85;
  }

  /** Two painted flame drawings, alternated quickly: the fire flickers. */
  private flameMats: THREE.ShaderMaterial[] = [];
  private flameFrame(id: number): THREE.ShaderMaterial {
    if (!this.flameMats.length) {
      for (const k of ['flame', 'flame_2']) {
        const m = this.spriteMaterial(this.sprites[k] ? k : 'flame');
        m.uniforms.uUnlit.value = 1;
        this.flameMats.push(m);
      }
    }
    return this.flameMats[Math.floor(this.clock * 7 + id * 0.37) % 2];
  }

  /** Shadow length over the day: short around noon, long towards evening. */
  private get castLength(): number {
    const t = this.game.state.time;
    return 0.45 + 0.65 * smooth(t / NIGHT_START) ** 2;
  }

  /** The hero: view by direction, walking legs, action poses and the tool in hand. */
  private updateHero(dt: number) {
    const g = this.game;
    const p = g.player;
    const h = this.hero;
    const sailing = p.onRaft !== undefined;
    const dx = p.x - h.lastX;
    const dz = p.z - h.lastZ;
    h.lastX = p.x;
    h.lastZ = p.z;
    if (g.moving && Math.hypot(dx, dz) > 1e-4) {
      h.view = Math.abs(dz) > Math.abs(dx) * 1.2 ? (dz < 0 ? 'back' : 'front') : 'side';
      h.phase += dt * 11; // a jog: about three steps a second
    } else {
      // Settle into a standing pose.
      const k = h.phase % Math.PI;
      if (k > 0.05) h.phase += Math.min(dt * 9, Math.PI - k);
    }

    // Which painted frame shows right now.
    let key = `hero_${h.view}`;
    const act = g.actionPulse > 0 ? 1 - g.actionPulse / 0.3 : -1;
    if (sailing) key = 'pose_paddle';
    else if (act >= 0) {
      switch (g.action) {
        case 'chop':
          if (this.sprites.chop_4?.painted) {
            // Painted swing with the axe in both hands: raise, swing, strike (and hold).
            key = act < 0.3 ? 'chop_2' : act < 0.55 ? 'chop_3' : 'chop_4';
            break;
          }
        // falls through
        case 'mine':
        case 'strike':
          key = act < 0.45 ? 'pose_swing_up' : 'pose_swing_down';
          break;
        case 'thrust': key = 'pose_thrust'; break;
        case 'shoot': key = 'pose_hold_forward'; break;
        case 'pick': key = 'pose_pickup'; break;
        case 'eat': key = 'hero_front'; break;
      }
    } else if (g.bobber) key = 'pose_hold_forward';
    // Running sideways: the painted run cycle, six frames per two steps.
    const runFrames = h.view === 'side' && g.moving && !sailing && act < 0 && this.sprites.run_1?.painted;
    if (runFrames) key = `run_${(Math.floor((h.phase / (Math.PI * 2)) * 6) % 6) + 1}`;
    const posed = key.startsWith('pose_') || key.startsWith('run_') || key.startsWith('chop_') || act >= 0;
    if (posed && key !== 'hero_front') h.view = 'side';
    const sprite = this.sprites[key];
    const drawnTool = key.startsWith('chop_');
    const mirror = h.view === 'side' || key.startsWith('pose_') || key.startsWith('run_') || drawnTool ? g.facing : 1;

    h.mat.uniforms.map.value = h.castMat.uniforms.map.value = this.texture(key);
    h.mesh.geometry = h.cast.geometry = this.geometry(key);
    h.mat.uniforms.uFootX.value = sprite.footX ?? 0.5;
    h.mat.uniforms.uFlash.value = g.hurtPulse > 0 ? 0.5 : 0;
    const walking = g.moving && !sailing && !posed;
    const running = !!runFrames;
    const s = Math.sin(h.phase);
    const stride = walking || h.phase % Math.PI > 0.05 ? s : 0;
    if (h.view === 'side' && !posed) {
      // Side view: both legs are drawn over each other, so spread them only a little and swing the
      // feet back and forth like a pendulum in time with the steps.
      h.mat.uniforms.uStride.value = Math.abs(stride) * 0.06;
      h.mat.uniforms.uSwing.value = Math.cos(h.phase) * 0.09 * (walking ? 1 : 0);
      h.mat.uniforms.uLift.value.set(0, 0);
    } else if (!posed) {
      h.mat.uniforms.uStride.value = 0;
      h.mat.uniforms.uSwing.value = 0;
      h.mat.uniforms.uLift.value.set(Math.max(0, stride) * 0.1, Math.max(0, -stride) * 0.1);
    } else {
      h.mat.uniforms.uStride.value = 0;
      h.mat.uniforms.uSwing.value = 0;
      h.mat.uniforms.uLift.value.set(0, 0);
    }
    // The body is highest when the legs pass each other.
    const bob = sailing ? 0.28 + Math.sin(this.clock * 2.2) * 0.05 : walking ? (1 - Math.abs(stride)) * 0.07 : 0;
    h.group.position.set(p.x, bob, p.z);
    h.mesh.scale.set(mirror, 1, 1);
    // A slight sway of the shoulders while walking towards or away from the camera.
    // Running: leaning into the step seen from the side, shoulders swinging seen from the front or back.
    h.mesh.rotation.z = 0;
    this.heroBody.rotation.z = walking ? (h.view === 'side' ? -mirror * 0.08 : stride * 0.045) : 0;
    if (running) this.heroBody.rotation.z = 0; // the painted frames already lean and bounce
    h.shadow.position.set(p.x, 0.02, p.z - 0.12);
    h.shadow.visible = false;
    h.cast.visible = !sailing;
    this.placeCast(h.cast, p.x, p.z, mirror, 0.45, true);
    this.heroAo.geometry = h.cast.geometry;
    this.heroAo.visible = !sailing;
    this.placeAo(this.heroAo, p.x, p.z, mirror, 1.75);

    // Tool in the fist.
    const hand = p.hand;
    h.tool.visible = !!hand && key !== 'pose_paddle' && !drawnTool; // the chop frames have the axe drawn in
    this.heroHand.visible = h.tool.visible && key !== 'pose_pickup';
    if (hand) {
      h.toolMat.uniforms.map.value = this.texture(`item_${hand.item}`);
      h.toolMat.uniforms.uUnlit.value = hand.item === 'torch' ? 1 : 0;
      const { w, h: ht } = this.size(key);
      const foot = sprite.footX ?? 0.5;
      const [hx, hy] = sprite.handX !== undefined ? [sprite.handX, sprite.handY ?? 0.5] : WALK_HAND[h.view];
      h.tool.position.set((hx - foot) * w * mirror, hy * ht, 0.015);
      // The fist over the handle (centre a little inside the outline the anchors were measured at).
      const hm = this.heroHand.material as THREE.ShaderMaterial;
      hm.uniforms.map.value = h.mat.uniforms.map.value;
      hm.uniforms.uFlash.value = h.mat.uniforms.uFlash.value;
      const inward = sprite.handX !== undefined ? (key === 'pose_swing_up' ? [0, -0.02] : [-0.025, 0]) : [0, 0];
      hm.uniforms.uHand.value.set(hx + inward[0], hy + inward[1]);
      hm.uniforms.uAspect.value = w / ht;
      this.heroHand.geometry = h.mesh.geometry;
      this.heroHand.scale.set(mirror, 1, 1);
      let ang = TOOL_ANGLE[key] ?? TOOL_ANGLE.walk;
      if (hand.item === 'torch' && !key.startsWith('pose_')) ang = -0.5;
      if (key.startsWith('hero_') && walking) ang += stride * 0.25; // the arm swings with the stride
      if (running) ang = -2.5; // hangs from the pumping fist
      h.tool.scale.set(mirror, 1, 1);
      h.tool.rotation.set(0, 0, ang * mirror);
    }
  }

  // ---------------- Picking ----------------

  /** Ground point under the cursor. */
  groundAt(clientX: number, clientY: number): { x: number; z: number } | null {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit) ? { x: hit.x, z: hit.z } : null;
  }

  /** Entity whose sprite is under the cursor; the front-most one wins. */
  entityAt(clientX: number, clientY: number): Entity | null {
    let best: Entity | null = null;
    let bestY = -Infinity;
    const v3 = new THREE.Vector3();
    for (const v of this.views.values()) {
      const e = v.entity;
      if (!v.mesh.visible) continue;
      const { w, h } = this.size(v.key, e.kind === 'drop' ? 0.7 : 1);
      const fz = e.z + v.off;
      const base = this.project(v3.set(e.x, 0, fz));
      const top = this.project(v3.set(e.x, h * Math.cos(PITCH), fz - h * Math.sin(PITCH)));
      const pxPerUnit = Math.abs(base.y - top.y) / Math.max(0.01, h);
      const halfW = Math.max(14, (w * pxPerUnit) / 2) * 0.7;
      const minY = top.y + (base.y - top.y) * 0.1;
      if (clientX > base.x - halfW && clientX < base.x + halfW && clientY > minY && clientY < base.y + 8) {
        if (base.y > bestY && this.game.actionLabel(e)) {
          bestY = base.y;
          best = e;
        }
      }
    }
    return best;
  }

  private project(v: THREE.Vector3): { x: number; y: number } {
    const p = v.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * window.innerWidth, y: ((1 - p.y) / 2) * window.innerHeight };
  }
}

/** Light colour over the day: bright day, warm dusk, dark blue night, gradual dawn. */
export function ambientFor(t: number): THREE.Color {
  // Warm all day, turning golden through the afternoon.
  const morning = new THREE.Color(1.0, 0.97, 0.9);
  const golden = new THREE.Color(1.05, 0.9, 0.7);
  const day = morning.clone().lerp(golden, smooth((Math.min(t, DUSK_START) - 0.1) / (DUSK_START - 0.1)) ** 1.5);
  const dusk = new THREE.Color(0.95, 0.66, 0.5);
  const night = new THREE.Color(0.13, 0.15, 0.27);
  const c = new THREE.Color();
  if (t < 0.06) return c.copy(night).lerp(day, smooth(t / 0.06));
  if (t < DUSK_START) return c.copy(day);
  if (t < NIGHT_START) {
    const k = (t - DUSK_START) / (NIGHT_START - DUSK_START);
    return k < 0.6 ? c.copy(day).lerp(dusk, smooth(k / 0.6)) : c.copy(dusk).lerp(night, smooth((k - 0.6) / 0.4));
  }
  return c.copy(night);
}

function smooth(x: number) {
  const k = Math.max(0, Math.min(1, x));
  return k * k * (3 - 2 * k);
}

/** Average colour of an image, 0..1: the painted grass is applied relative to it. */
function meanColor(img: HTMLImageElement | undefined): [number, number, number] {
  if (!img) return [1, 1, 1];
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data;
  const sum = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k];
  return sum.map((v) => v / 256 / 255) as [number, number, number];
}
