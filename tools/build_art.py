"""Prepare generated art for the game.

    python3 tools/build_art.py

Reads the approved files in art/incoming/ (see ASSETS below), and writes
public/art/<key>.png plus public/art/manifest.json:

- sprites: background cut out (tools/cut.py), colour graded towards the
  reference picture, scaled to a sensible size;
- textures: brightness flattened (generated tiles are darker at the edges)
  and made seamless.

The game loads manifest.json at start; every key listed there replaces the
vector placeholder of the same name.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, os.path.dirname(__file__))
from bay_shape import shoreline  # noqa: E402
from cut import cut  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'art', 'incoming')
OUT = os.path.join(ROOT, 'public', 'art')

# key: source file, height in world units (1 unit ≈ 1 m), colour grade.
# Grade: gain multiplies brightness, sat scales saturation, warm shifts red/blue.
HERO = {'gain': 1.22, 'sat': 1.02, 'warm': 0.0}
ASSETS = {
    'hero_front': ('hero_ref', 1.75, HERO),
    'hero_side': ('hero_side', 1.75, HERO),
    'hero_back': ('hero_back', 1.75, HERO),
    'pose_swing_up': ('pose_swing_up', 1.95, HERO),
    'pose_swing_down': ('pose_swing_down', 1.55, HERO),
    'pose_thrust': ('pose_thrust', 1.6, HERO),
    'pose_hold_forward': ('pose_hold_forward', 1.75, HERO),
    'pose_pickup': ('pose_pickup', 1.15, HERO),
    'pose_paddle': ('pose_paddle', 1.15, HERO),
    'campfire': ('campfire', 1.5, {'gain': 1.0, 'sat': 1.0, 'warm': 0.0}),
    'tent': ('tent', 2.0, {'gain': 1.0, 'sat': 0.95, 'warm': 0.0}),
    'boulder_1': ('boulder_1', 1.05, {'gain': 1.06, 'sat': 0.9, 'warm': -0.02}),
    'boulder_2': ('boulder_2', 0.9, {'gain': 1.06, 'sat': 0.9, 'warm': -0.02}),
    'boulder_3': ('boulder_3', 0.95, {'gain': 1.06, 'sat': 0.9, 'warm': -0.02}),
    # High three-quarter cliffs (their base sits flat on the ground); three kinds so neighbours differ.
    'cliff_1': ('cliff_1', 2.3, {'gain': 0.95, 'sat': 0.88, 'warm': 0.0}),
    'cliff_2': ('cliff_2', 2.3, {'gain': 0.95, 'sat': 0.88, 'warm': 0.0}),
    'cliff_3': ('cliff_3', 2.2, {'gain': 0.95, 'sat': 0.88, 'warm': 0.0}),
    # Campfire flame: two drawings, alternated for flicker. Drawn on black.
    'flame': ('flame', 0.6, {'gain': 1.0, 'sat': 1.0, 'warm': 0.0}),
    'flame_2': ('flame_2', 0.6, {'gain': 1.0, 'sat': 1.0, 'warm': 0.0}),
    # Earlier, sunnier generation: pulled down to the reference's grey-brown.
    'stones_1': ('stones_1', 0.45, {'gain': 0.68, 'sat': 0.7, 'warm': -0.05}),
    # Grass tufts: all four kept for variety; colours as painted (they already match the reference).
    'tuft_1': ('tuft_1', 0.5, {'gain': 1.0, 'sat': 1.0, 'warm': 0.0, 'strict': True}),
    'tuft_2': ('tuft_2', 0.5, {'gain': 1.0, 'sat': 1.0, 'warm': 0.0, 'strict': True}),
    'tuft_3': ('tuft_3', 0.45, {'gain': 1.0, 'sat': 1.0, 'warm': 0.0, 'strict': True}),
    'tuft_4': ('tuft_4', 0.45, {'gain': 1.0, 'sat': 1.0, 'warm': 0.0, 'strict': True}),
}
TEXTURES = {
    'ground_grass': 'ground_grass',
}
# Sheets with several small objects: split into <key>_1, <key>_2, ... Height in metres of the
# tallest piece; the others keep their size relative to it.
SHEETS = {
    'shell': ('shells', 0.2, {'gain': 1.0, 'sat': 0.9, 'warm': 0.0}),
    'pebble': ('pebbles', 0.16, {'gain': 1.0, 'sat': 0.85, 'warm': 0.0}),
}
# Painted top-down backgrounds: key -> (source, size of the square in metres).
BACKDROPS = {
    'bay': ('bay_topdown', 18.0),
}
BAY_TS = os.path.join(ROOT, 'src', 'game', 'bay_shape.ts')
MAX_SPRITE_HEIGHT = 640  # px; enough for close-ups, keeps memory in check


def find(name: str) -> str:
    for ext in ('.png', '.webp', '.jpg', '.jpeg'):
        p = os.path.join(SRC, name + ext)
        if os.path.exists(p):
            return p
    raise FileNotFoundError(name)


def grade(im: Image.Image, gain: float, sat: float, warm: float) -> Image.Image:
    a = np.asarray(im).astype(np.float32) / 255
    rgb, alpha = a[..., :3], a[..., 3:]
    lum = (rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32))[..., None]
    rgb = lum + (rgb - lum) * sat
    # Gain on midtones (gamma-like), so highlights do not clip.
    rgb = 1 - (1 - np.clip(rgb, 0, 1)) ** gain if gain > 1 else np.clip(rgb, 0, 1) ** (1 / gain)
    rgb[..., 0] += warm
    rgb[..., 2] -= warm
    out = np.concatenate([np.clip(rgb, 0, 1), alpha], axis=2)
    return Image.fromarray((out * 255).astype(np.uint8), 'RGBA')


def seamless(im: Image.Image, size: int = 1024) -> Image.Image:
    """Removes the dark vignette and blends opposite edges so the tile repeats without a grid."""
    a = np.asarray(im.convert('RGB').resize((size, size), Image.LANCZOS)).astype(np.float32)
    # Flatten large-scale brightness: divide by a heavy blur, keep the average colour.
    blur = np.asarray(im.convert('RGB').resize((size, size)).filter(ImageFilter.GaussianBlur(size / 6))).astype(np.float32)
    mean = a.reshape(-1, 3).mean(axis=0)
    a = a / np.maximum(blur, 1) * mean
    # Cross-fade with a copy shifted by half a tile: the edges then come from the middle.
    shifted = np.roll(np.roll(a, size // 2, axis=0), size // 2, axis=1)
    y, x = np.mgrid[0:size, 0:size] / size
    w = np.minimum(np.minimum(x, 1 - x), np.minimum(y, 1 - y)) * 2  # 0 at edges, 1 in the middle
    w = np.clip(w * 2.5, 0, 1)[..., None]
    out = a * w + shifted * (1 - w)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGB')


def anchors(im: Image.Image, key: str) -> dict:
    """Feet position (so sprites stand where the object is) and, for hero poses, the hand.

    Coordinates are fractions of the sprite: x from the left, y from the bottom.
    """
    a = np.asarray(im)[..., 3] > 128
    h, w = a.shape
    ys, xs = np.nonzero(a[int(h * 0.82):])
    # Middle between the outermost boots, so a wide stance stays centred.
    out = {'footX': round(float(xs.min() + xs.max()) / 2 / w, 3) if len(xs) else 0.5}
    if key.startswith('pose_'):
        ys, xs = np.nonzero(a)
        fy = 1 - ys / h  # height above the feet, 0..1
        if key == 'pose_swing_up':
            i = ys.argmin()  # fists high above the head
        elif key == 'pose_pickup':
            sel = np.nonzero((xs > w * 0.5) & (fy < 0.35))[0]  # hand by the ground in front
            i = sel[ys[sel].argmax()]
        else:
            sel = np.nonzero((fy > 0.3) & (fy < 0.92))[0]  # arms, not boots or ponytail
            i = sel[xs[sel].argmax()]
        out['handX'] = round(float(xs[i]) / w, 3)
        out['handY'] = round(float(fy[i]), 3)
    return out


def green_base(im: Image.Image) -> Image.Image:
    """Grass tufts come with a patch of brown earth and litter at the root. Repaint it in the
    meadow's olive (keeping light and shade) and fade the very bottom, so the tuft grows out of
    the grass instead of sitting on a brown disc."""
    a = np.asarray(im).astype(np.float32)
    h = a.shape[0]
    rgb, alpha = a[..., :3], a[..., 3]
    y = (np.arange(h) / h)[:, None]
    lower = np.clip((y - 0.6) / 0.2, 0, 1)  # from 60% down, full from 80%
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    brown = np.clip((r - g) / 30 + 0.3, 0, 1) * np.clip((g - b) / 25 + 0.5, 0, 1)
    lum = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    olive = np.array([150, 140, 76], dtype=np.float32)
    target = olive[None, None, :] * (lum / 136.0)[..., None] * 0.95
    k = (brown * lower)[..., None]
    rgb = rgb * (1 - k) + target * k
    alpha = alpha * (1 - np.clip((y - 0.9) / 0.1, 0, 1) * 0.85)
    out = np.dstack([np.clip(rgb, 0, 255), alpha]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def split_sheet(im: Image.Image) -> list[Image.Image]:
    """Separate objects on a cut-out sheet: connected areas of the alpha mask, left to right, top to bottom."""
    k = 4
    small = np.asarray(im.split()[3].resize((im.size[0] // k, im.size[1] // k))) > 40
    h, w = small.shape
    label = np.zeros((h, w), np.int32)
    boxes = []
    for y0 in range(h):
        for x0 in range(w):
            if not small[y0, x0] or label[y0, x0]:
                continue
            n = len(boxes) + 1
            stack = [(y0, x0)]
            label[y0, x0] = n
            box = [x0, y0, x0, y0]
            count = 0
            while stack:
                y, x = stack.pop()
                count += 1
                box = [min(box[0], x), min(box[1], y), max(box[2], x), max(box[3], y)]
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w and small[yy, xx] and not label[yy, xx]:
                        label[yy, xx] = n
                        stack.append((yy, xx))
            boxes.append((count, box))
    big = [b for c, b in boxes if c > 200]
    big.sort(key=lambda b: (round(b[1] / (h / 3)), b[0]))
    out = []
    for x0, y0, x1, y1 in big:
        out.append(im.crop((max(0, x0 * k - 6), max(0, y0 * k - 6), min(im.size[0], (x1 + 1) * k + 6), min(im.size[1], (y1 + 1) * k + 6))))
    return out


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    manifest = {'sprites': {}, 'textures': {}}
    tmp = os.path.join(OUT, '_cut.png')
    for key, (src, height, g) in ASSETS.items():
        cut(find(src), tmp, strict=g.get('strict', False))
        im = Image.open(tmp)
        im = grade(im, g['gain'], g['sat'], g['warm'])
        if key.startswith('tuft_'):
            im = green_base(im)
        if im.size[1] > MAX_SPRITE_HEIGHT:
            im = im.resize((im.size[0] * MAX_SPRITE_HEIGHT // im.size[1], MAX_SPRITE_HEIGHT), Image.LANCZOS)
        im.save(os.path.join(OUT, key + '.png'))
        entry = {'file': f'art/{key}.png', 'w': im.size[0], 'h': im.size[1], 'size': height}
        entry.update(anchors(im, key))
        manifest['sprites'][key] = entry
    for key, (src, height, g) in SHEETS.items():
        cut(find(src), tmp)
        parts = split_sheet(grade(Image.open(tmp), g['gain'], g['sat'], g['warm']))
        tallest = max(p.size[1] for p in parts)
        for i, part in enumerate(parts, 1):
            size = round(height * part.size[1] / tallest, 3)
            if part.size[1] > 160:
                part = part.resize((part.size[0] * 160 // part.size[1], 160), Image.LANCZOS)
            name = f'{key}_{i}'
            part.save(os.path.join(OUT, name + '.png'))
            entry = {'file': f'art/{name}.png', 'w': part.size[0], 'h': part.size[1], 'size': size}
            entry.update(anchors(part, name))
            manifest['sprites'][name] = entry
        print(key, len(parts), 'pieces')
    os.remove(tmp)
    manifest['backdrops'] = {}
    for key, (src, size) in BACKDROPS.items():
        path = find(src)
        Image.open(path).convert('RGB').resize((2048, 2048), Image.LANCZOS).save(os.path.join(OUT, key + '.jpg'), quality=88)
        manifest['backdrops'][key] = {'file': f'art/{key}.jpg', 'size': size}
        if key == 'bay':
            water, grass = shoreline(path)
            with open(BAY_TS, 'w') as f:
                f.write('// Generated by tools/build_art.py from the painted bay; do not edit by hand.\n')
                f.write('/** Shoreline of the painted start bay, row by row from the top: fractions of the picture width. */\n')
                f.write(f'export const BAY_SHAPE = {{\n  size: {size},\n')
                f.write(f'  water: {json.dumps(water)},\n  grass: {json.dumps(grass)},\n}};\n')
    for key, src in TEXTURES.items():
        seamless(Image.open(find(src))).save(os.path.join(OUT, key + '.jpg'), quality=90)
        manifest['textures'][key] = {'file': f'art/{key}.jpg'}
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    print('art ready:', len(manifest['sprites']), 'sprites,', len(manifest['textures']), 'textures,', len(manifest['backdrops']), 'backdrops')


if __name__ == '__main__':
    main()
