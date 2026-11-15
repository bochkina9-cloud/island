import { makeRng } from './rng';

/** 2D simplex noise (Stefan Gustavson's formulation), seeded. Returns roughly -1..1. */
export class Noise2D {
  private perm = new Uint8Array(512);

  constructor(seed: number) {
    const rng = makeRng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  noise(xin: number, yin: number): number {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    const perm = this.perm;
    const corner = (gi: number, x: number, y: number) => {
      let tt = 0.5 - x * x - y * y;
      if (tt < 0) return 0;
      tt *= tt;
      const h = gi & 7;
      const u = h < 4 ? x : y;
      const v = h < 4 ? y : x;
      return tt * tt * ((h & 1 ? -u : u) + (h & 2 ? -2 * v : 2 * v));
    };
    const n0 = corner(perm[ii + perm[jj]], x0, y0);
    const n1 = corner(perm[ii + i1 + perm[jj + j1]], x1, y1);
    const n2 = corner(perm[ii + 1 + perm[jj + 1]], x2, y2);
    return 40 * (n0 + n1 + n2);
  }

  /** Fractal sum of several octaves for natural-looking shapes. */
  fbm(x: number, y: number, octaves = 4): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this.noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
}
