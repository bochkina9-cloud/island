"""Reads the shoreline from the painted bay (art/incoming/bay_topdown.*).

For every row of the picture: where the water ends (waterline) and where the
grass begins, as fractions of the picture width. Used by build_art.py, which
writes them into src/game/bay_shape.ts so the terrain matches the painting.
"""
import numpy as np
from PIL import Image, ImageFilter

N = 500  # analysis resolution


def _blur(mask: np.ndarray, r: int) -> np.ndarray:
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(r))) / 255


def shoreline(path: str, rows: int = 64) -> tuple[list[float], list[float]]:
    a = np.asarray(Image.open(path).convert('RGB').resize((N, N), Image.LANCZOS)).astype(float)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    grass = _blur(((r - g < 22) & (g - b > 35)).astype(float), 4)
    sand = _blur(((r - b > 55) & (r - g >= 16)).astype(float), 2)
    water_x, grass_x = [], []
    for y in range(N):
        # Grass edge: walking left from the right side until grass stops for a while.
        x = N - 1
        while x > 0 and grass[y, max(0, x - 6):x + 1].max() > 0.5:
            x -= 1
        ge = x
        # Waterline: keep walking left over sand until the sand ends.
        while x > 0 and sand[y, max(0, x - 3):x + 1].max() > 0.5:
            x -= 1
        water_x.append(x / N)
        grass_x.append(ge / N)
    def smooth(v: list[float]) -> list[float]:
        v = np.array(v)
        k = np.ones(15) / 15
        v = np.convolve(np.pad(v, 7, mode='edge'), k, mode='valid')
        idx = np.linspace(0, N - 1, rows)
        return [round(float(np.interp(i, np.arange(N), v)), 4) for i in idx]
    return smooth(water_x), smooth(grass_x)


if __name__ == '__main__':
    import sys
    w, gr = shoreline(sys.argv[1])
    im = Image.open(sys.argv[1]).convert('RGB').resize((N, N))
    from PIL import ImageDraw
    d = ImageDraw.Draw(im)
    for i in range(len(w) - 1):
        y0 = i / (len(w) - 1) * N
        y1 = (i + 1) / (len(w) - 1) * N
        d.line([(w[i] * N, y0), (w[i + 1] * N, y1)], fill=(255, 0, 0), width=2)
        d.line([(gr[i] * N, y0), (gr[i + 1] * N, y1)], fill=(255, 0, 255), width=2)
    im.save(sys.argv[2])
