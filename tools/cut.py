"""Cut the flat background out of generated sprites.

Usage: python3 tools/cut.py art/incoming/hero_ref.png public/art/hero_ref.png

The background colour is taken from the image border (so #FF00FF or any other flat
colour works). Edge pixels get partial transparency and the background tint is
removed from them ("despill"), so no pink fringe remains.
"""
import sys

import numpy as np
from PIL import Image

NEAR, FAR = 22.0, 60.0  # colour distance: below NEAR = background, above FAR = object


def cut(src: str, dst: str, pad: int = 6) -> None:
    im = Image.open(src).convert('RGB')
    a = np.asarray(im).astype(np.float32)
    b = 12
    border = np.concatenate([a[:b].reshape(-1, 3), a[-b:].reshape(-1, 3), a[:, :b].reshape(-1, 3), a[:, -b:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    dist = np.sqrt(((a - bg) ** 2).sum(axis=2))
    alpha = np.clip((dist - NEAR) / (FAR - NEAR), 0, 1)
    # Despill: un-mix the background from semi-transparent edge pixels.
    k = np.maximum(alpha, 1e-3)[..., None]
    rgb = np.clip((a - (1 - k) * bg) / k, 0, 255)
    rgb = np.where(alpha[..., None] > 0, rgb, 0)
    rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    ys, xs = np.where(alpha > 0.05)
    if len(xs) == 0:
        raise SystemExit(f'{src}: nothing left after removing the background')
    x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + pad + 1)
    y0, y1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + pad + 1)
    out = Image.fromarray(rgba[y0:y1, x0:x1], 'RGBA')
    out.save(dst)
    print(f'{src} -> {dst}: background {bg.round().astype(int).tolist()}, size {out.size}')


if __name__ == '__main__':
    cut(sys.argv[1], sys.argv[2])
