#!/usr/bin/env python3
"""Generate the original resume-and-leaf mark using Python's standard library."""
from pathlib import Path
import math
import struct
import zlib

ROOT = Path(__file__).resolve().parent.parent


def rounded(x, y, left, top, right, bottom, radius):
    dx = max(left + radius - x, 0, x - (right - radius))
    dy = max(top + radius - y, 0, y - (bottom - radius))
    return left <= x <= right and top <= y <= bottom and dx * dx + dy * dy <= radius * radius


def color(x, y):
    if not rounded(x, y, 3, 3, 125, 125, 29):
        return (0, 0, 0, 0)
    pixel = (14, 83, 73, 255)
    if rounded(x, y, 32, 22, 93, 106, 9):
        pixel = (247, 249, 238, 255)
    for right, top in [(78, 40), (78, 54), (62, 68), (57, 82)]:
        if rounded(x, y, 44, top, right, top + 5, 2.5):
            pixel = (114, 146, 130, 255)
    # Rotated oval leaf plus an off-centre vein; all coordinates are original.
    u = (x - 86) * math.cos(-0.72) + (y - 85) * math.sin(-0.72)
    v = -(x - 86) * math.sin(-0.72) + (y - 85) * math.cos(-0.72)
    if u * u / 27**2 + v * v / 14**2 <= 1:
        pixel = (187, 221, 114, 255)
        if abs(v) < 1.5 and -22 < u < 19:
            pixel = (43, 111, 72, 255)
    return pixel


def chunk(kind, payload):
    return struct.pack('!I', len(payload)) + kind + payload + struct.pack('!I', zlib.crc32(kind + payload) & 0xffffffff)


def generate(size):
    data = bytearray()
    for row in range(size):
        data.append(0)
        for col in range(size):
            samples = [color((col + (sx + .5) / 4) * 128 / size,
                             (row + (sy + .5) / 4) * 128 / size)
                       for sy in range(4) for sx in range(4)]
            alpha = sum(p[3] for p in samples)
            data.extend([round(sum(p[c] * p[3] for p in samples) / alpha) if alpha else 0 for c in range(3)])
            data.append(round(alpha / 16))
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('!IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(data), 9))
    png += chunk(b'IEND', b'')
    destination = ROOT / 'public' / 'icon' / f'{size}.png'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(png)
    print(destination.relative_to(ROOT))


if __name__ == '__main__':
    for icon_size in (16, 32, 48, 128):
        generate(icon_size)
