import { Noise2D } from '../core/noise';
import { makeRng } from '../core/rng';
import { type Biome, MAP_SIZE, type Terrain } from '../game/world';

const PX = 8; // canvas pixels per world unit

const COLORS: Record<Biome, [number, number, number]> = {
  deep: [0, 0, 0],
  shallow: [0, 0, 0],
  sand: [233, 213, 160],
  grass: [138, 178, 84],
  forest: [96, 140, 64],
  rock: [160, 152, 136],
};

/**
 * Paints the island as one big watercolour-like texture: soft colour patches,
 * darker ink edges between areas, grass strokes and pebbles.
 */
export function paintGround(terrain: Terrain): HTMLCanvasElement {
  const size = MAP_SIZE * PX;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const wash = new Noise2D(terrain.seed ^ 0x1234);

  // Biome colours on a grid, blended smoothly between samples like wet paint.
  const g = 4; // samples per unit
  const gn = MAP_SIZE * g;
  const grid = new Float32Array(gn * gn * 3);
  for (let j = 0; j < gn; j++) {
    for (let i = 0; i < gn; i++) {
      let b = terrain.biome((i + 0.5) / g, (j + 0.5) / g);
      if (b === 'deep' || b === 'shallow') b = 'sand';
      grid.set(COLORS[b], (j * gn + i) * 3);
    }
  }
  blurGrid(grid, gn, 3);
  blurGrid(grid, gn, 3);
  const colorAt = (x: number, z: number, out: number[]) => {
    const fx = Math.max(0, Math.min(gn - 1.001, x * g - 0.5));
    const fz = Math.max(0, Math.min(gn - 1.001, z * g - 0.5));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    for (let c = 0; c < 3; c++) {
      const a = grid[(j * gn + i) * 3 + c];
      const b = grid[(j * gn + i + 1) * 3 + c];
      const cc = grid[((j + 1) * gn + i) * 3 + c];
      const d = grid[((j + 1) * gn + i + 1) * 3 + c];
      out[c] = (a * (1 - tx) + b * tx) * (1 - tz) + (cc * (1 - tx) + d * tx) * tz;
    }
  };
  const col = [0, 0, 0];

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / PX;
      const z = (py + 0.5) / PX;
      const h = terrain.height(x, z);
      const o = (py * size + px) * 4;
      if (h < -0.03) {
        d[o + 3] = 0;
        continue;
      }
      // Warp the lookup a little so borders wander like brush edges.
      const wx = x + wash.noise(x * 0.35, z * 0.35) * 0.9;
      const wz = z + wash.noise(x * 0.35 + 50, z * 0.35 + 50) * 0.9;
      colorAt(wx, wz, col);
      let [r, gr, bl] = col;
      // Sand hugs the waterline regardless of the biome grid.
      if (h < 0.05) {
        const k = Math.max(0, Math.min(1, (0.05 - h) / 0.03));
        r += (COLORS.sand[0] - r) * k; gr += (COLORS.sand[1] - gr) * k; bl += (COLORS.sand[2] - bl) * k;
      }
      // Watercolour wash: large soft patches of lighter and darker paint.
      const w = wash.noise(x * 0.12, z * 0.12) * 14 + wash.noise(x * 0.6, z * 0.6) * 6;
      r += w; gr += w; bl += w * 0.6;
      // Relief shading from the slope, light from the upper left.
      const sx = terrain.height(x + 0.5, z) - terrain.height(x - 0.5, z);
      const sz = terrain.height(x, z + 0.5) - terrain.height(x, z - 0.5);
      const shade = (-sx - sz) * 160;
      r += shade; gr += shade; bl += shade;
      // Wet sand at the waterline, fading into transparency.
      if (h < 0.025) {
        const k = Math.max(0, Math.min(1, (h + 0.03) / 0.055));
        r = r * 0.82; gr = gr * 0.8; bl = bl * 0.78;
        d[o + 3] = Math.round(255 * k);
      } else {
        d[o + 3] = 255;
      }
      if (terrain.inPond(x, z)) {
        r = 96; gr = 176; bl = 196;
        d[o + 3] = 255;
      }
      d[o] = clamp(r);
      d[o + 1] = clamp(gr);
      d[o + 2] = clamp(bl);
    }
  }

  ctx.putImageData(img, 0, 0);

  // Pond outlines.
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(61,43,31,0.6)';
  for (const p of terrain.ponds) {
    ctx.beginPath();
    ctx.ellipse(p.x * PX, p.z * PX, p.r * PX, p.r * PX, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse((p.x - p.r * 0.3) * PX, (p.z - p.r * 0.3) * PX, p.r * PX * 0.3, p.r * PX * 0.12, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Grass strokes and pebbles.
  const rng = makeRng(terrain.seed ^ 0x777);
  ctx.lineCap = 'round';
  for (let i = 0; i < 14000; i++) {
    const x = rng() * MAP_SIZE;
    const z = rng() * MAP_SIZE;
    const b = terrain.biome(x, z);
    if (terrain.inPond(x, z)) continue;
    const px = x * PX;
    const py = z * PX;
    if (b === 'grass' || b === 'forest') {
      ctx.strokeStyle = b === 'grass' ? 'rgba(80,120,44,0.55)' : 'rgba(58,92,40,0.55)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - 2 + rng() * 1.5, py - 5 - rng() * 3);
      ctx.moveTo(px + 2, py);
      ctx.lineTo(px + 3 + rng() * 1.5, py - 4 - rng() * 3);
      ctx.stroke();
    } else if (b === 'sand' && rng() < 0.35) {
      ctx.fillStyle = 'rgba(150,130,100,0.5)';
      ctx.beginPath();
      ctx.ellipse(px, py, 1.5 + rng() * 1.5, 1 + rng(), 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (b === 'rock' && rng() < 0.5) {
      ctx.strokeStyle = 'rgba(80,72,64,0.45)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + 4 + rng() * 6, py + (rng() - 0.5) * 4);
      ctx.stroke();
    }
  }
  return canvas;
}

function clamp(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Separable box blur of an RGB grid, in place: soft colour bleeding between areas. */
function blurGrid(grid: Float32Array, n: number, r: number) {
  const tmp = new Float32Array(grid.length);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? grid : tmp;
    const dst = pass === 0 ? tmp : grid;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          let cnt = 0;
          for (let k = -r; k <= r; k++) {
            const ii = pass === 0 ? i + k : i;
            const jj = pass === 0 ? j : j + k;
            if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
            sum += src[(jj * n + ii) * 3 + c];
            cnt++;
          }
          dst[(j * n + i) * 3 + c] = sum / cnt;
        }
      }
    }
  }
}
