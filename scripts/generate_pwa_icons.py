from __future__ import annotations

import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT / "apps" / "web" / "public"

AMBER = (245, 158, 11, 255)
CREAM = (255, 247, 237, 255)
SLATE = (23, 32, 51, 255)


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def write_png(path: Path, width: int, height: int, pixels: list[tuple[int, int, int, int]]) -> None:
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        row = pixels[y * width : (y + 1) * width]
        for pixel in row:
            raw.extend(pixel)

    data = b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)),
            png_chunk(b"IDAT", zlib.compress(bytes(raw), level=9)),
            png_chunk(b"IEND", b""),
        ],
    )
    path.write_bytes(data)


def in_circle(x: float, y: float, cx: float, cy: float, radius: float) -> bool:
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius**2


def in_ellipse(x: float, y: float, cx: float, cy: float, rx: float, ry: float) -> bool:
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1


def icon_pixels(size: int) -> list[tuple[int, int, int, int]]:
    pixels: list[tuple[int, int, int, int]] = []
    scale = 512 / size
    for py in range(size):
        for px in range(size):
            x = (px + 0.5) * scale
            y = (py + 0.5) * scale
            color = AMBER

            if in_circle(x, y, 256, 188, 78):
                color = CREAM
            if in_ellipse(x, y, 258, 374, 142, 88) and y >= 270:
                color = SLATE
            if in_ellipse(x, y, 214, 390, 86, 55) and y >= 330:
                color = SLATE
            if 242 <= x <= 270 and 119 <= y <= 231:
                color = SLATE
            if 212 <= x <= 324 and 161 <= y <= 189:
                color = SLATE
            if in_circle(x, y, 256, 119, 14) or in_circle(x, y, 256, 231, 14):
                color = SLATE
            if in_circle(x, y, 212, 175, 14) or in_circle(x, y, 324, 175, 14):
                color = SLATE

            pixels.append(color)
    return pixels


def main() -> int:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        write_png(PUBLIC_DIR / f"pwa-{size}.png", size, size, icon_pixels(size))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
