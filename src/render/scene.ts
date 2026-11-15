import * as THREE from 'three';
import { DUSK_START, NIGHT_START } from '../game/data';
import type { Game } from '../game/sim';
import type { Entity } from '../game/state';
import { MAP_SIZE, SHORE, type Terrain } from '../game/world';
import type { LoadedSprite } from './art';
import { paintGround } from './ground';

const PITCH = (52 * Math.PI) / 180;
const MAX_LIGHTS = 8;

/** Uniforms shared by every material: one place to set daylight and fire light. */
const shared = {
  uAmbient: { value: new THREE.Color(1, 1, 1) },
  uLights: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4()) },
  uLightCount: { value: 0 },
  uTime: { value: 0 },
  uStorm: { value: 0 },
  uDry: { value: 0 },
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
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
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
  void main() {
    vec4 c = texture2D(map, vUv);
    if (c.a < 0.45) discard;
    vec3 col = c.rgb * uTint;
    col = mix(applyLight(applySeason(col), vWorld), col, uUnlit);
    col = mix(col, vec3(1.0, 0.35, 0.3), uFlash);
    gl_FragColor = vec4(col, uOpacity);
  }
`;

const SHADOW_FRAG = /* glsl */ `
  ${LIGHT_GLSL}
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vec4 c = texture2D(map, vUv);
    float day = clamp(uAmbient.r, 0.0, 1.0);
    gl_FragColor = vec4(0.0, 0.0, 0.0, c.a * 0.45 * day);
  }
`;

const GROUND_FRAG = /* glsl */ `
  ${LIGHT_GLSL}
  uniform sampler2D map;
  uniform sampler2D uHeight;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    // Fine height channel: -0.25..0.25 around the shoreline.
    float h = texture2D(uHeight, vWorld.xz / ${MAP_SIZE.toFixed(1)}).g * 0.5 - 0.25;
    float a = smoothstep(-0.012, 0.022, h);
    if (a < 0.01) discard;
    vec4 c = texture2D(map, vUv);
    gl_FragColor = vec4(applyLight(applySeason(c.rgb), vWorld), a);
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
    vec3 shallow = vec3(0.50, 0.88, 0.83);
    vec3 mid = vec3(0.22, 0.71, 0.77);
    vec3 deep = vec3(0.12, 0.47, 0.66);
    vec3 col = mix(shallow, mid, smoothstep(0.0, 0.12, depth));
    col = mix(col, deep, smoothstep(0.12, 0.6, depth));
    float w = sin(vWorld.x * 0.9 + uTime * 0.8) + sin(vWorld.z * 0.7 - uTime * 1.1) + sin((vWorld.x + vWorld.z) * 0.35 + uTime * 0.5);
    col = mix(col, vec3(0.16, 0.30, 0.38), uStorm * 0.55);
    col += vec3(0.03 + uStorm * 0.05) * w;
    // Surf: animated foam lines running towards the shore.
    float band = 1.0 - smoothstep(0.0, 0.07, depth);
    float lines = smoothstep(0.55, 0.9, sin(depth * 140.0 - uTime * (2.2 + uStorm * 3.0)));
    float foam = band * (0.35 + 0.65 * lines);
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
  private player: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; shadow: THREE.Mesh; tool: THREE.Mesh; toolMat: THREE.ShaderMaterial };
  private ghost: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; key: string } | null = null;
  private shadowMat: THREE.ShaderMaterial;
  private bobber!: THREE.Mesh;
  private fishLine!: THREE.Line;
  private arrows: THREE.Mesh[] = [];
  private heightTex!: THREE.DataTexture;
  private clock = 0;
  zoom = 26;
  readonly groundCanvas: HTMLCanvasElement;

  constructor(
    container: HTMLElement,
    private game: Game,
    private art: Record<string, LoadedSprite>,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x1e78a8);
    container.appendChild(this.renderer.domElement);
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

    const pm = this.spriteMaterial('player_0');
    const pmesh = new THREE.Mesh(this.geometry('player_0'), pm);
    pmesh.rotation.x = -PITCH;
    const toolMat = this.spriteMaterial('item_axe');
    const tool = new THREE.Mesh(this.geometry('item_axe', 0.9), toolMat);
    tool.rotation.x = -PITCH;
    tool.visible = false;
    this.player = { mesh: pmesh, mat: pm, shadow: this.makeShadow(0.9), tool, toolMat };
    this.scene.add(pmesh, tool, this.player.shadow);

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
      const s = this.art[key];
      t = new THREE.CanvasTexture(s.canvas);
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = 4;
      this.textures.set(key, t);
    }
    return t;
  }

  /** Plane sized from the sprite, anchored at its bottom centre. */
  private geometry(key: string, scale = 1): THREE.PlaneGeometry {
    const id = `${key}@${scale}`;
    let g = this.geometries.get(id);
    if (!g) {
      const d = this.art[key].def;
      const h = d.size * scale;
      const w = (h * d.w) / d.h;
      g = new THREE.PlaneGeometry(w, h);
      g.translate(0, h / 2, 0);
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
      },
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
    });
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
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...shared, map: { value: tex }, uHeight: { value: this.heightTex } },
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
      case 'palm': return `palm_${v % 3}`;
      case 'tree': return `tree_${v % 3}`;
      case 'boulder': return `boulder_${v % 2}`;
      case 'sapling': return e.regrowOn !== undefined ? 'sapling_bare' : 'sapling';
      case 'grass_tuft': return e.regrowOn !== undefined ? 'grass_cut' : 'grass_tuft';
      case 'berry_bush': return e.regrowOn !== undefined ? 'berry_bush_empty' : 'berry_bush';
      case 'boar': return 'boar_0';
      case 'vines': return e.regrowOn !== undefined ? 'vines_cut' : 'vines';
      case 'nest': return e.regrowOn !== undefined ? 'nest_empty' : 'nest';
      case 'salt_pan': return (e.salt ?? 0) >= 1 ? 'salt_pan_full' : 'salt_pan';
      case 'rain_catcher': return (e.water ?? 0) >= 1 ? 'rain_catcher_full' : 'rain_catcher';
      case 'drop': return `item_${e.item?.item ?? 'stone'}`;
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
        const mesh = new THREE.Mesh(this.geometry(key, e.kind === 'drop' ? 0.7 : 1), mat);
        mesh.rotation.x = -PITCH;
        const d = this.art[key].def;
        const shadowW = Math.min(3.2, ((d.size * d.w) / d.h) * (e.kind === 'palm' ? 0.35 : 0.8));
        const shadow = this.makeShadow(shadowW);
        v = { entity: e, mesh, mat, shadow, key };
        if (e.kind === 'campfire') {
          const fm = this.spriteMaterial('flame');
          fm.uniforms.uUnlit.value = 1;
          v.flame = new THREE.Mesh(this.geometry('flame'), fm);
          v.flame.rotation.x = -PITCH;
          this.scene.add(v.flame);
        }
        this.scene.add(mesh, shadow);
        this.views.set(e.id, v);
      }
      v.entity = e;
    }
    for (const [id, v] of this.views) if (!alive.has(id)) this.removeView(v);
  }

  private removeView(v: SpriteView) {
    this.scene.remove(v.mesh, v.shadow);
    if (v.flame) this.scene.remove(v.flame);
    if (v.fire) this.scene.remove(v.fire);
    v.mat.dispose();
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

    // Player.
    const sailing = p.onRaft !== undefined;
    const bob = sailing ? 0.28 + Math.sin(this.clock * 2.2) * 0.05 : g.moving ? Math.abs(Math.sin(this.clock * 11)) * 0.12 : 0;
    const frame = g.moving && !sailing && Math.sin(this.clock * 11) > 0 ? 'player_1' : 'player_0';
    this.player.mat.uniforms.map.value = this.texture(frame);
    this.player.mat.uniforms.uFlash.value = g.hurtPulse > 0 ? 0.5 : 0;
    this.player.mesh.position.set(p.x, bob, p.z);
    this.player.mesh.scale.set(g.facing * (1 + g.actionPulse * 0.15), 1 - g.actionPulse * 0.12, 1);
    this.player.shadow.position.set(p.x, 0.02, p.z + 0.05);
    this.player.shadow.visible = !sailing;
    const hand = p.hand;
    this.player.tool.visible = !!hand;
    if (hand) {
      this.player.toolMat.uniforms.map.value = this.texture(`item_${hand.item}`);
      this.player.toolMat.uniforms.uUnlit.value = hand.item === 'torch' ? 1 : 0;
      const swing = g.actionPulse > 0 ? Math.sin((g.actionPulse / 0.3) * Math.PI) * 0.9 : 0;
      this.player.tool.position.set(p.x + g.facing * 0.45, 0.45 + bob, p.z + 0.08);
      this.player.tool.scale.set(g.facing, 1, 1);
      this.player.tool.rotation.set(-PITCH, 0, -g.facing * swing);
    }

    // Fishing: the float bobs, and dips when a fish bites.
    const float = g.bobber;
    this.bobber.visible = this.fishLine.visible = !!float;
    if (float) {
      const dip = g.biting ? -0.12 + Math.sin(this.clock * 30) * 0.06 : Math.sin(this.clock * 3) * 0.03;
      this.bobber.position.set(float.x, dip, float.z);
      const tip = new THREE.Vector3(p.x + g.facing * 0.9, 1.6 + (sailing ? 0.28 : 0), p.z + 0.1);
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
      if (v.flame) v.flame.visible = !far;
      if (far && e.kind !== 'boar') continue;
      let sx = 1;
      let sy = 1;
      let y = 0;
      if (e.kind === 'boar') {
        const b = g.brain(e);
        const walking = b.moving && Math.sin(this.clock * (b.mode === 'wander' ? 8 : 16) + e.id) > 0;
        v.mat.uniforms.map.value = this.texture(walking ? 'boar_1' : 'boar_0');
        v.mat.uniforms.uFlash.value = b.hurt > 0 ? 0.6 : 0;
        sx = b.facing;
        y = b.moving ? Math.abs(Math.sin(this.clock * 12 + e.id)) * 0.06 : 0;
      } else if (e.kind === 'palm' || e.kind === 'tree') {
        // Sway in the wind; much stronger in a storm.
        v.mesh.rotation.z = Math.sin(this.clock * (0.9 + g.storm * 2) + e.id) * (0.015 + g.storm * 0.06);
      } else if (e.kind === 'raft') {
        y = Math.sin(this.clock * 2.2 + e.id) * 0.05 + 0.02;
        v.mesh.rotation.z = Math.sin(this.clock * 1.7 + e.id) * (0.02 + g.storm * 0.05);
        v.shadow.visible = false;
      } else if (e.kind === 'drop') {
        y = 0.05 + Math.sin(this.clock * 3 + e.id) * 0.04;
      }
      const wobble = (e.work ?? 0) > 0 ? Math.sin(this.clock * 40) * 0.03 : 0;
      v.mesh.position.set(e.x + wobble, y, e.z);
      v.mesh.scale.set(sx, sy, 1);
      v.shadow.position.set(e.x, 0.02, e.z + 0.05);
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
          v.fire.position.set(e.x, 0.1, e.z + 0.05);
          v.fire.scale.set(big * (1 + Math.sin(this.clock * 15 + e.id) * 0.08), big * (1 + Math.sin(this.clock * 9 + e.id) * 0.12), 1);
        }
      }
      if (v.flame) {
        const burning = (e.fuel ?? 0) > 0;
        v.flame.visible = burning;
        if (burning) {
          const k = 0.45 + 0.55 * Math.min(1, (e.fuel ?? 0) / 120);
          v.flame.position.set(e.x, 0.15, e.z + 0.02);
          v.flame.scale.set(k * (1 + Math.sin(this.clock * 17 + e.id) * 0.06), k * (1 + Math.sin(this.clock * 11) * 0.1), 1);
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
      const d = this.art[v.key].def;
      const h = d.size * (e.kind === 'drop' ? 0.7 : 1);
      const w = (h * d.w) / d.h;
      const base = this.project(v3.set(e.x, 0, e.z));
      const top = this.project(v3.set(e.x, h * Math.cos(PITCH), e.z - h * Math.sin(PITCH)));
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
  const day = new THREE.Color(1, 1, 1);
  const dusk = new THREE.Color(0.95, 0.72, 0.58);
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
