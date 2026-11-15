/**
 * Placeholder art drawn as SVG in an ink-and-watercolour manner.
 * Every sprite can later be replaced by a hand-drawn PNG with the same key (see docs/ART_GUIDE.md).
 */

const INK = '#3d2b1f';
const S = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
const S2 = `stroke="${INK}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"`;

export interface SpriteDef {
  /** SVG viewBox size; the object's base point is the bottom centre. */
  w: number;
  h: number;
  /** Height in world units. */
  size: number;
  body: string;
}

function frond(cx: number, cy: number, angle: number, len: number, color: string): string {
  const a = (angle * Math.PI) / 180;
  const ex = cx + Math.cos(a) * len;
  const ey = cy + Math.sin(a) * len;
  const mx = cx + Math.cos(a) * len * 0.5 - Math.sin(a) * len * 0.18;
  const my = cy + Math.sin(a) * len * 0.5 + Math.cos(a) * len * 0.18 + len * 0.15;
  const nx = cx + Math.cos(a) * len * 0.5 + Math.sin(a) * len * 0.22;
  const ny = cy + Math.sin(a) * len * 0.5 - Math.cos(a) * len * 0.22 + len * 0.1;
  return `<path d="M${cx},${cy} Q${nx},${ny} ${ex},${ey} Q${mx},${my} ${cx},${cy}Z" fill="${color}" ${S2}/>
    <path d="M${cx},${cy} Q${(nx + mx) / 2},${(ny + my) / 2} ${ex},${ey}" fill="none" stroke="${INK}" stroke-width="1.2" opacity="0.6"/>`;
}

function palm(lean: number, tall: number): SpriteDef {
  const h = 260;
  const topX = 90 + lean;
  const topY = h - tall;
  const trunk = `<path d="M84,${h - 6} C${84 + lean * 0.2},${h - tall * 0.5} ${topX - 8},${topY + 30} ${topX - 5},${topY + 4}
     L${topX + 6},${topY + 6} C${topX + 4},${topY + 34} ${98 + lean * 0.25},${h - tall * 0.5} 100,${h - 6} Z" fill="#a9824f" ${S}/>`;
  let rings = '';
  for (let i = 1; i < 9; i++) {
    const t = i / 9;
    const y = h - 6 - t * (h - 6 - topY);
    const x = 92 + (topX - 92) * t * t;
    rings += `<path d="M${x - 7},${y} q7,4 14,0" fill="none" stroke="${INK}" stroke-width="1.5" opacity="0.7"/>`;
  }
  const greens = ['#5c9a3a', '#6fae44', '#4f8a33'];
  let fronds = '';
  [-170, -140, -110, -70, -40, -10, 20, 160].forEach((ang, i) => {
    fronds += frond(topX, topY + 6, ang, 62 + (i % 3) * 8, greens[i % 3]);
  });
  const nuts = `<circle cx="${topX - 6}" cy="${topY + 14}" r="7" fill="#7a5a32" ${S2}/><circle cx="${topX + 7}" cy="${topY + 15}" r="7" fill="#6b4c2a" ${S2}/>`;
  return { w: 180, h, size: 5.2, body: trunk + rings + fronds + nuts };
}

function broadTree(c1: string, c2: string): SpriteDef {
  const body = `
    <path d="M86,214 C88,170 84,150 78,128 L104,128 C98,150 96,170 100,214 Z" fill="#8a6440" ${S}/>
    <path d="M80,150 L58,128 M100,146 L122,124" ${S} fill="none"/>
    <circle cx="60" cy="112" r="34" fill="${c2}" ${S}/>
    <circle cx="126" cy="108" r="36" fill="${c2}" ${S}/>
    <circle cx="92" cy="78" r="46" fill="${c1}" ${S}/>
    <circle cx="70" cy="104" r="28" fill="${c1}" ${S2}/>
    <circle cx="116" cy="100" r="30" fill="${c1}" ${S2}/>
    <path d="M70,70 q8,-10 18,-8 M112,84 q8,-6 14,0 M58,110 q6,-6 12,-2" fill="none" stroke="#fff6c8" stroke-width="3" opacity="0.5"/>`;
  return { w: 184, h: 220, size: 4.6, body };
}

const ITEM_ART: Record<string, string> = {
  wood: `<rect x="14" y="30" width="62" height="22" rx="10" fill="#a07a4a" ${S} transform="rotate(-12 45 41)"/>
         <ellipse cx="74" cy="34" rx="8" ry="11" fill="#e2c58f" ${S2} transform="rotate(-12 45 41)"/>
         <rect x="22" y="50" width="56" height="20" rx="9" fill="#8d6a3f" ${S} transform="rotate(8 50 60)"/>`,
  twigs: `<path d="M18,70 L80,22 M40,54 L30,30 M58,40 L74,44 M24,74 L76,56 M50,64 L56,80" fill="none" stroke="#7a5432" stroke-width="6" stroke-linecap="round"/>
          <path d="M18,70 L80,22 M24,74 L76,56" fill="none" stroke="${INK}" stroke-width="1.5" opacity="0.6"/>`,
  grass: `<path d="M30,82 C28,60 22,40 14,22 M42,82 C42,56 40,36 44,14 M54,82 C56,60 62,40 74,24 M36,82 C34,62 30,50 26,44 M48,82 C50,64 54,50 60,40" fill="none" stroke="#7fa541" stroke-width="6" stroke-linecap="round"/>
          <path d="M26,82 h34" stroke="#c9a96a" stroke-width="8" stroke-linecap="round"/>`,
  flint: `<path d="M22,62 L38,24 L66,20 L78,50 L56,74 Z" fill="#6f7d8c" ${S}/>
          <path d="M38,24 L48,48 L66,20 M48,48 L56,74" fill="none" stroke="${INK}" stroke-width="1.5" opacity="0.6"/>
          <path d="M42,30 l10,-2" stroke="#e8f0f6" stroke-width="3" opacity="0.8"/>`,
  stone: `<path d="M16,64 C14,40 34,24 52,26 C72,26 84,44 80,62 C76,76 26,80 16,64 Z" fill="#9a9690" ${S}/>
          <path d="M30,44 q10,-8 20,-6" stroke="#f2efe8" stroke-width="3" fill="none" opacity="0.7"/>`,
  rope: `<ellipse cx="48" cy="50" rx="30" ry="22" fill="none" stroke="#c9a46a" stroke-width="9"/>
         <ellipse cx="48" cy="50" rx="18" ry="12" fill="none" stroke="#b08850" stroke-width="7"/>
         <ellipse cx="48" cy="50" rx="30" ry="22" fill="none" stroke="${INK}" stroke-width="1.5" opacity="0.6"/>
         <path d="M70,62 q10,10 6,20" fill="none" stroke="#c9a46a" stroke-width="7" stroke-linecap="round"/>`,
  coconut: `<circle cx="48" cy="50" r="28" fill="#6b4c2a" ${S}/>
            <circle cx="40" cy="42" r="3.5" fill="${INK}"/><circle cx="52" cy="40" r="3.5" fill="${INK}"/><circle cx="46" cy="52" r="3.5" fill="${INK}"/>
            <path d="M28,60 q6,8 18,10" fill="none" stroke="#a07a4a" stroke-width="3"/>`,
  berries: `<circle cx="36" cy="52" r="14" fill="#c23b4a" ${S2}/><circle cx="58" cy="48" r="14" fill="#d14a58" ${S2}/>
            <circle cx="48" cy="66" r="14" fill="#b33242" ${S2}/>
            <path d="M48,34 q6,-14 20,-16 q-4,12 -20,16" fill="#6fae44" ${S2}/>
            <circle cx="32" cy="48" r="3" fill="#fff" opacity="0.7"/><circle cx="54" cy="44" r="3" fill="#fff" opacity="0.7"/>`,
  berries_cooked: `<circle cx="36" cy="52" r="14" fill="#7a2a30" ${S2}/><circle cx="58" cy="48" r="14" fill="#8a3238" ${S2}/>
            <circle cx="48" cy="66" r="14" fill="#6a2228" ${S2}/>
            <path d="M30,40 q4,-8 0,-14 M50,36 q4,-8 0,-14" fill="none" stroke="#b9b1a8" stroke-width="2.5" opacity="0.8"/>`,
  meat: `<path d="M20,52 C18,30 44,18 64,26 C82,34 84,58 66,70 C50,80 22,72 20,52 Z" fill="#d6646a" ${S}/>
         <path d="M34,46 q14,-10 28,0 q-12,12 -28,0" fill="#f2b7b5" ${S2}/>
         <rect x="64" y="58" width="22" height="9" rx="4" fill="#f4ecd8" ${S2} transform="rotate(30 75 62)"/>`,
  meat_cooked: `<path d="M20,52 C18,30 44,18 64,26 C82,34 84,58 66,70 C50,80 22,72 20,52 Z" fill="#9a5a32" ${S}/>
         <path d="M30,44 l30,-6 M28,54 l36,-6 M32,64 l28,-4" stroke="#5a3418" stroke-width="3"/>
         <rect x="64" y="58" width="22" height="9" rx="4" fill="#f4ecd8" ${S2} transform="rotate(30 75 62)"/>`,
  axe: `<rect x="44" y="18" width="9" height="66" rx="4" fill="#a07a4a" ${S} transform="rotate(30 48 50)"/>
        <path d="M44,20 C58,12 74,18 76,30 C66,30 56,36 52,44 Z" fill="#8c98a4" ${S}/>
        <path d="M70,24 l5,6" stroke="#eef3f7" stroke-width="3"/>`,
  pickaxe: `<rect x="44" y="20" width="9" height="66" rx="4" fill="#a07a4a" ${S} transform="rotate(25 48 52)"/>
        <path d="M16,34 C30,16 64,10 84,24 C64,22 34,26 18,38 Z" fill="#8c98a4" ${S}/>`,
  spear: `<rect x="44" y="20" width="7" height="72" rx="3" fill="#a07a4a" ${S} transform="rotate(35 48 56)"/>
          <path d="M60,8 L76,16 L66,30 L56,22 Z" fill="#6f7d8c" ${S}/>
          <path d="M54,28 l8,6 M52,32 l8,6" stroke="#c9a46a" stroke-width="4"/>`,
  torch: `<rect x="42" y="36" width="10" height="54" rx="4" fill="#8a6440" ${S} transform="rotate(15 47 63)"/>
          <path d="M38,38 C34,22 48,8 50,4 C54,16 66,22 58,38 C54,44 42,44 38,38 Z" fill="#f2a33a" ${S2}/>
          <path d="M44,36 C42,28 50,20 50,16 C54,24 58,30 52,36 Z" fill="#ffe08a"/>`,
};

export const ITEM_KEYS = Object.keys(ITEM_ART);

function icon(key: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">${ITEM_ART[key]}</svg>`;
}

/** Data URL of an item icon, for the HTML interface. */
export function iconUrl(key: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(icon(key));
}

export const SPRITES: Record<string, SpriteDef> = {
  palm_0: palm(18, 210),
  palm_1: palm(-14, 190),
  palm_2: palm(30, 230),
  tree_0: broadTree('#5f9a3c', '#4a7f2f'),
  tree_1: broadTree('#6aa047', '#557f35'),
  tree_2: broadTree('#7aa843', '#5e8a33'),
  stump: {
    w: 100, h: 70, size: 0.9,
    body: `<path d="M24,60 L28,24 L72,24 L76,60 Z" fill="#8a6440" ${S}/>
           <ellipse cx="50" cy="24" rx="22" ry="8" fill="#e2c58f" ${S}/>
           <ellipse cx="50" cy="24" rx="11" ry="4" fill="none" stroke="${INK}" stroke-width="1.5" opacity="0.6"/>
           <path d="M24,60 l-10,6 M76,60 l10,6" ${S}/>`,
  },
  sapling: {
    w: 100, h: 120, size: 1.6,
    body: `<path d="M50,114 C50,90 46,70 50,40 M50,80 L30,56 M50,66 L70,46 M48,96 L66,84" fill="none" stroke="#7a5432" stroke-width="5" stroke-linecap="round"/>
           <ellipse cx="30" cy="52" rx="10" ry="6" fill="#7fb04a" ${S2}/><ellipse cx="72" cy="42" rx="10" ry="6" fill="#7fb04a" ${S2}/>
           <ellipse cx="50" cy="36" rx="9" ry="12" fill="#6fa040" ${S2}/><ellipse cx="68" cy="82" rx="8" ry="5" fill="#7fb04a" ${S2}/>`,
  },
  sapling_bare: {
    w: 100, h: 120, size: 1.6,
    body: `<path d="M50,114 C50,96 48,84 50,70" fill="none" stroke="#7a5432" stroke-width="5" stroke-linecap="round"/>
           <ellipse cx="50" cy="68" rx="5" ry="6" fill="#9cc060" ${S2}/>`,
  },
  grass_tuft: {
    w: 100, h: 90, size: 1.1,
    body: `<path d="M50,86 C46,60 30,40 18,30 M50,86 C50,56 48,30 54,8 M50,86 C56,60 70,40 84,32 M50,86 C44,66 36,56 28,52 M50,86 C58,68 64,58 72,54" fill="none" stroke="#6f9a38" stroke-width="7" stroke-linecap="round"/>
           <path d="M50,86 C50,56 48,30 54,8 M50,86 C46,60 30,40 18,30 M50,86 C56,60 70,40 84,32" fill="none" stroke="#a9cc6a" stroke-width="2.5" stroke-linecap="round"/>`,
  },
  grass_cut: {
    w: 100, h: 90, size: 1.1,
    body: `<path d="M50,86 l-10,-12 M50,86 l0,-14 M50,86 l10,-12" fill="none" stroke="#9aa04a" stroke-width="6" stroke-linecap="round"/>`,
  },
  berry_bush: {
    w: 120, h: 100, size: 1.4,
    body: `<path d="M14,90 C4,60 26,30 50,36 C60,14 96,18 100,44 C120,50 116,86 100,92 Z" fill="#4f8a33" ${S}/>
           <path d="M30,60 q10,-12 22,-6 M66,50 q10,-8 20,0" fill="none" stroke="#7fb04a" stroke-width="3"/>
           ${[[34, 70], [52, 58], [70, 72], [88, 60], [60, 82], [42, 84], [80, 84]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="#d23b4a" ${S2}/>`).join('')}`,
  },
  berry_bush_empty: {
    w: 120, h: 100, size: 1.4,
    body: `<path d="M14,90 C4,60 26,30 50,36 C60,14 96,18 100,44 C120,50 116,86 100,92 Z" fill="#5a8a3a" ${S}/>
           <path d="M30,60 q10,-12 22,-6 M66,50 q10,-8 20,0" fill="none" stroke="#7fb04a" stroke-width="3"/>`,
  },
  boulder_0: {
    w: 150, h: 110, size: 1.9,
    body: `<path d="M10,100 C2,64 26,22 66,16 C108,10 142,44 140,82 C138,102 30,110 10,100 Z" fill="#9a958d" ${S}/>
           <path d="M66,16 C58,40 62,70 74,104 M108,24 C100,50 110,74 130,92" fill="none" stroke="${INK}" stroke-width="2" opacity="0.5"/>
           <path d="M34,46 q16,-20 34,-22" fill="none" stroke="#f0ede6" stroke-width="5" opacity="0.6"/>`,
  },
  boulder_1: {
    w: 150, h: 110, size: 1.7,
    body: `<path d="M14,102 L20,52 L58,22 L104,26 L136,62 L132,100 Z" fill="#8f8a84" ${S}/>
           <path d="M58,22 L70,60 L136,62 M70,60 L60,104" fill="none" stroke="${INK}" stroke-width="2" opacity="0.5"/>
           <path d="M30,56 l26,-24" stroke="#f0ede6" stroke-width="5" opacity="0.6"/>`,
  },
  flint_ground: {
    w: 70, h: 40, size: 0.45,
    body: `<path d="M8,34 L20,10 L44,6 L60,24 L44,36 Z" fill="#6f7d8c" ${S}/><path d="M22,12 l12,-2" stroke="#eef3f7" stroke-width="3"/>`,
  },
  driftwood: {
    w: 140, h: 50, size: 0.6,
    body: `<path d="M8,36 C30,26 70,30 100,20 L132,12 L126,24 C100,34 60,44 12,46 Z" fill="#c2a27a" ${S}/>
           <path d="M70,30 l12,-18" ${S} fill="none"/>`,
  },
  coconut_ground: {
    w: 60, h: 50, size: 0.45,
    body: `<ellipse cx="30" cy="28" rx="22" ry="18" fill="#6b4c2a" ${S}/><circle cx="24" cy="22" r="3" fill="${INK}"/><circle cx="34" cy="21" r="3" fill="${INK}"/>`,
  },
  campfire: {
    w: 140, h: 70, size: 1.1,
    body: `${[[16, 52], [36, 60], [62, 64], [90, 62], [114, 54], [100, 42], [40, 42]].map(([x, y]) => `<ellipse cx="${x + 6}" cy="${y}" rx="14" ry="9" fill="#9a958d" ${S2}/>`).join('')}
           <rect x="34" y="34" width="70" height="12" rx="6" fill="#7a5432" ${S2} transform="rotate(-14 70 40)"/>
           <rect x="34" y="34" width="70" height="12" rx="6" fill="#8a6440" ${S2} transform="rotate(14 70 40)"/>`,
  },
  flame: {
    w: 80, h: 110, size: 1.4,
    body: `<path d="M14,100 C4,70 28,50 30,20 C40,40 46,30 48,6 C64,34 82,60 66,100 Z" fill="#f28a2e" ${S2}/>
           <path d="M26,100 C20,80 34,66 38,46 C46,62 54,58 56,44 C64,64 66,84 56,100 Z" fill="#f7c64a"/>
           <path d="M36,100 C34,90 40,82 44,72 C48,82 52,90 50,100 Z" fill="#fff2b0"/>`,
  },
  chest: {
    w: 120, h: 100, size: 1.2,
    body: `<rect x="12" y="44" width="96" height="50" rx="4" fill="#9a6a3a" ${S}/>
           <path d="M12,44 C12,14 108,14 108,44 Z" fill="#a8783f" ${S}/>
           <path d="M40,22 L40,94 M80,22 L80,94" stroke="#5a5048" stroke-width="7"/>
           <rect x="52" y="44" width="16" height="18" rx="2" fill="#d9b24a" ${S2}/>`,
  },
  shelter: {
    w: 220, h: 170, size: 3.0,
    body: `<path d="M20,160 L110,18 L200,160 Z" fill="#6f9a3e" ${S}/>
           ${Array.from({ length: 9 }, (_, i) => `<path d="M${40 + i * 18},${150 - (i % 2) * 6} L${110},${30}" stroke="#4f7a2c" stroke-width="2.5" opacity="0.7"/>`).join('')}
           <path d="M80,160 L110,96 L140,160 Z" fill="#3a2a1a" ${S2}/>
           <path d="M96,12 L124,40 M124,12 L96,40" stroke="#8a6440" stroke-width="7" stroke-linecap="round"/>
           <path d="M84,160 L136,160" stroke="#d9c07a" stroke-width="8"/>`,
  },
  boar_0: boar(0),
  boar_1: boar(1),
  player_0: person(0),
  player_1: person(1),
  shadow: {
    w: 100, h: 50, size: 1,
    body: `<defs><radialGradient id="g"><stop offset="0" stop-color="#000" stop-opacity="0.55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
           <ellipse cx="50" cy="25" rx="48" ry="23" fill="url(#g)"/>`,
  },
};

function boar(frame: number): SpriteDef {
  const legA = frame === 0 ? 0 : 6;
  const legB = frame === 0 ? 6 : 0;
  return {
    w: 150, h: 100, size: 1.15,
    body: `
      <path d="M38,70 l${-4 + legA},24 M56,72 l${4 - legA},22 M96,72 l${-4 + legB},22 M112,70 l${4 - legB},24" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
      <path d="M38,70 l${-4 + legA},24 M56,72 l${4 - legA},22 M96,72 l${-4 + legB},22 M112,70 l${4 - legB},24" stroke="#5a4232" stroke-width="5" stroke-linecap="round"/>
      <path d="M22,56 C20,30 60,18 96,22 C124,24 136,44 132,62 C128,78 40,84 22,56 Z" fill="#6e5240" ${S}/>
      <path d="M40,26 l6,-10 l6,9 l6,-10 l6,9 l6,-9 l6,9" fill="none" stroke="${INK}" stroke-width="3"/>
      <path d="M130,44 C142,44 148,52 146,60 L128,64 Z" fill="#8a6a54" ${S2}/>
      <ellipse cx="144" cy="56" rx="4" ry="5" fill="#d9a0a0" ${S2}/>
      <path d="M132,62 q8,6 4,14" fill="none" stroke="#f4ecd8" stroke-width="4" stroke-linecap="round"/>
      <circle cx="124" cy="44" r="3.5" fill="${INK}"/>
      <path d="M112,28 l6,-12 l6,12" fill="#6e5240" ${S2}/>
      <path d="M22,50 q-10,-4 -12,-14" fill="none" stroke="${INK}" stroke-width="3"/>`,
  };
}

function person(frame: number): SpriteDef {
  const step = frame === 0 ? 0 : 7;
  return {
    w: 100, h: 180, size: 1.85,
    body: `
      <path d="M40,${172 - step / 2} L42,120 M60,${172 - (7 - step) / 2} L58,120" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>
      <path d="M40,${172 - step / 2} L42,120 M60,${172 - (7 - step) / 2} L58,120" stroke="#6b5440" stroke-width="7" stroke-linecap="round"/>
      <path d="M34,${174 - step / 2} h12 M54,${174 - (7 - step) / 2} h12" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
      <path d="M32,118 L68,118 L64,96 L36,96 Z" fill="#7a6248" ${S2}/>
      <path d="M30,100 C28,72 34,60 50,58 C66,60 72,72 70,100 Z" fill="#3f8f8a" ${S}/>
      <path d="M36,62 L62,100" stroke="#8a6440" stroke-width="4"/>
      <path d="M30,68 C22,80 22,92 26,104 M70,68 C78,80 78,92 74,104" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>
      <path d="M30,68 C22,80 22,92 26,104 M70,68 C78,80 78,92 74,104" fill="none" stroke="#e0b088" stroke-width="6" stroke-linecap="round"/>
      <circle cx="50" cy="38" r="20" fill="#e8b98e" ${S}/>
      <path d="M30,34 C28,14 46,8 56,12 C70,14 74,26 70,34 C64,26 58,30 52,24 C46,30 38,28 30,34 Z" fill="#5a3a24" ${S2}/>
      <path d="M36,46 C40,62 60,62 64,46 C60,52 40,52 36,46 Z" fill="#5a3a24"/>
      <circle cx="44" cy="40" r="2.5" fill="${INK}"/><circle cx="58" cy="40" r="2.5" fill="${INK}"/>`,
  };
}

function toSvg(def: SpriteDef): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${def.w} ${def.h}" width="${def.w * 2}" height="${def.h * 2}">${def.body}</svg>`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export interface LoadedSprite {
  def: SpriteDef;
  canvas: HTMLCanvasElement;
}

/** Rasterises all sprites and item icons. Item icons are also available as sprites "item_<id>". */
export async function loadArt(): Promise<Record<string, LoadedSprite>> {
  const all: Record<string, SpriteDef> = { ...SPRITES };
  for (const key of ITEM_KEYS) all[`item_${key}`] = { w: 96, h: 96, size: 0.75, body: ITEM_ART[key] };
  const out: Record<string, LoadedSprite> = {};
  await Promise.all(
    Object.entries(all).map(async ([key, def]) => {
      const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(toSvg(def)));
      const canvas = document.createElement('canvas');
      canvas.width = def.w * 2;
      canvas.height = def.h * 2;
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      out[key] = { def, canvas };
    }),
  );
  return out;
}
