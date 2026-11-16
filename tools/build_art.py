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
    'tent': ('tent', 2.3, {'gain': 1.0, 'sat': 0.95, 'warm': 0.0}),
    'boulder_1': ('boulder_1', 1.5, {'gain': 1.06, 'sat': 0.9, 'warm': -0.02}),
    'boulder_2': ('boulder_2', 1.3, {'gain': 1.06, 'sat': 0.9, 'warm': -0.02}),
    'boulder_3': ('boulder_3', 1.4, {'gain': 1.06, 'sat': 0.9, 'warm': -0.02}),
    # Earlier, sunnier generations: pulled down to the reference's grey-brown.
    'cliff_1': ('cliff_1', 3.2, {'gain': 0.74, 'sat': 0.8, 'warm': 0.0}),
    'stones_1': ('stones_1', 0.55, {'gain': 0.68, 'sat': 0.7, 'warm': -0.05}),
}
TEXTURES = {
    'ground_grass': 'ground_grass',
}
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


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    manifest = {'sprites': {}, 'textures': {}}
    tmp = os.path.join(OUT, '_cut.png')
    for key, (src, height, g) in ASSETS.items():
        cut(find(src), tmp)
        im = Image.open(tmp)
        im = grade(im, g['gain'], g['sat'], g['warm'])
        if im.size[1] > MAX_SPRITE_HEIGHT:
            im = im.resize((im.size[0] * MAX_SPRITE_HEIGHT // im.size[1], MAX_SPRITE_HEIGHT), Image.LANCZOS)
        im.save(os.path.join(OUT, key + '.png'))
        entry = {'file': f'art/{key}.png', 'w': im.size[0], 'h': im.size[1], 'size': height}
        entry.update(anchors(im, key))
        manifest['sprites'][key] = entry
    os.remove(tmp)
    for key, src in TEXTURES.items():
        seamless(Image.open(find(src))).save(os.path.join(OUT, key + '.jpg'), quality=90)
        manifest['textures'][key] = {'file': f'art/{key}.jpg'}
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    print('art ready:', len(manifest['sprites']), 'sprites,', len(manifest['textures']), 'textures')


if __name__ == '__main__':
    main()
