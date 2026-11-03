#!/usr/bin/env python3
"""gen-icon.py — Tái tạo icon Zalux (full-bleed, bubble lớn, đuôi bo mềm) bằng hình học thuần Pillow.

Không phóng to ảnh cũ: vẽ lại ở 2048² (siêu lấy mẫu 4x) rồi thu nhỏ bằng Lanczos để giữ nét.

    python3 scripts/gen-icon.py                 # ghi assets/zalux.png (512) + zalux-logo.png (128)
    python3 scripts/gen-icon.py --preview out.png
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = 512
SS = 4  # siêu lấy mẫu
S = OUT * SS

# --- bảng màu (lấy từ icon cũ) ---
BLUE_TOP_RIGHT = (26, 148, 255)
BLUE_BOTTOM_LEFT = (0, 96, 236)
GLYPH_Z = (8, 102, 250)
GLYPH_X = (22, 134, 255)


def px(v: float) -> int:
    return int(round(v * SS))


def pts(points):
    return [(x * SS, y * SS) for x, y in points]


def diag_gradient(c0, c1):
    """Gradient chéo: c1 ở góc trên-phải, c0 ở góc dưới-trái."""
    h = Image.linear_gradient("L").resize((S, S), Image.BILINEAR)  # đen trên → trắng dưới
    v = ImageChops.invert(h)  # trắng trên
    hx = h.rotate(90, expand=False).transpose(Image.FLIP_LEFT_RIGHT)  # sáng ở phải
    mask = Image.blend(v, hx.rotate(180).transpose(Image.FLIP_LEFT_RIGHT), 0.5)
    base0 = Image.new("RGB", (S, S), c0)
    base1 = Image.new("RGB", (S, S), c1)
    return Image.composite(base1, base0, mask)


def smooth_threshold(mask: Image.Image, radius_px: float, lo=122, hi=134):
    """Blur + ngưỡng mềm: bo tròn mũi lồi và bo fillet chỗ lõm, giữ viền chống răng cưa."""
    blurred = mask.filter(ImageFilter.GaussianBlur(radius_px))
    lut = [0 if i <= lo else 255 if i >= hi else int((i - lo) * 255 / (hi - lo)) for i in range(256)]
    return blurred.point(lut)


def bezier(p0, p1, p2, n=48):
    out = []
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t**2 * p2[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t**2 * p2[1]
        out.append((x, y))
    return out


def squircle_mask(radius: float) -> Image.Image:
    m = Image.new("L", (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, S - 1, S - 1), radius=px(radius), fill=255)
    return m


def bubble_mask() -> Image.Image:
    """Ellipse lớn + đuôi cong; fillet chỗ nối và mũi tròn nhờ smooth_threshold."""
    m = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(m)
    cx, cy, rx, ry = 256, 228, 192, 160
    d.ellipse((px(cx - rx), px(cy - ry), px(cx + rx), px(cy + ry)), fill=255)
    # đuôi: gốc nằm trong ellipse, mũi chếch xuống-trái; hai mép cong mềm
    base_a = (150, 318)
    tip = (100, 440)
    base_b = (246, 382)
    left_edge = bezier(base_a, (118, 372), tip)
    right_edge = bezier(tip, (168, 428), base_b)
    d.polygon(pts(left_edge + right_edge[1:]), fill=255)
    return smooth_threshold(m, px(15))


def stroke_poly(draw: ImageDraw.ImageDraw, points, width: float, fill=255):
    r = px(width / 2)
    for a, b in zip(points, points[1:]):
        draw.line([(a[0] * SS, a[1] * SS), (b[0] * SS, b[1] * SS)], fill=fill, width=px(width))
    for x, y in points:
        draw.ellipse((x * SS - r, y * SS - r, x * SS + r, y * SS + r), fill=fill)


def round_corners_of_path(points, radius, n=14):
    """Bo tròn các góc của polyline (dùng để Z có góc mềm như icon gốc)."""
    out = [points[0]]
    for i in range(1, len(points) - 1):
        p0, p1, p2 = points[i - 1], points[i], points[i + 1]
        v0 = (p0[0] - p1[0], p0[1] - p1[1])
        v2 = (p2[0] - p1[0], p2[1] - p1[1])
        l0 = math.hypot(*v0)
        l2 = math.hypot(*v2)
        r = min(radius, l0 / 2, l2 / 2)
        a = (p1[0] + v0[0] / l0 * r, p1[1] + v0[1] / l0 * r)
        b = (p1[0] + v2[0] / l2 * r, p1[1] + v2[1] / l2 * r)
        out.extend(bezier(a, p1, b, n))
    out.append(points[-1])
    return out


def glyph_mask(kind: str) -> Image.Image:
    m = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(m)
    if kind == "Z":
        z = [(146, 166), (254, 166), (146, 290), (256, 290)]
        stroke_poly(d, round_corners_of_path(z, 20), 40)
    else:
        stroke_poly(d, [(304, 228), (360, 294)], 33)
        stroke_poly(d, [(360, 228), (304, 294)], 33)
    return m


def build() -> Image.Image:
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sq = squircle_mask(114)

    # nền gradient full-bleed
    bg = diag_gradient(BLUE_BOTTOM_LEFT, BLUE_TOP_RIGHT).convert("RGBA")
    bg.putalpha(sq)
    canvas = Image.alpha_composite(canvas, bg)

    # ánh sáng nhẹ phía trên (không bóng đổ ngoài viền)
    sheen = Image.new("RGBA", (S, S), (255, 255, 255, 0))
    fade = Image.linear_gradient("L").resize((S, S), Image.BILINEAR)
    fade = ImageChops.invert(fade).point(lambda i: int(i * 0.10))
    sheen.putalpha(ImageChops.multiply(fade, sq))
    canvas = Image.alpha_composite(canvas, sheen)

    # viền sáng mảnh phía trên (inner stroke mờ dần xuống dưới)
    inner = squircle_mask(114)
    shrunk = Image.new("L", (S, S), 0)
    ImageDraw.Draw(shrunk).rounded_rectangle(
        (px(2.2), px(2.2), S - px(2.2), S - px(2.2)), radius=px(112), fill=255
    )
    ring = ImageChops.subtract(inner, shrunk)
    ring_fade = ImageChops.invert(Image.linear_gradient("L").resize((S, S), Image.BILINEAR)).point(
        lambda i: int(i * 0.34)
    )
    rim = Image.new("RGBA", (S, S), (255, 255, 255, 0))
    rim.putalpha(ImageChops.multiply(ring, ring_fade))
    canvas = Image.alpha_composite(canvas, rim)

    # bóng mềm dưới bubble
    bub = bubble_mask()
    shadow = Image.new("RGBA", (S, S), (0, 40, 140, 0))
    sh_mask = ImageChops.offset(bub, 0, px(9)).filter(ImageFilter.GaussianBlur(px(11))).point(lambda i: int(i * 0.30))
    shadow.putalpha(ImageChops.multiply(sh_mask, sq))
    canvas = Image.alpha_composite(canvas, shadow)

    # bubble trắng
    white = Image.new("RGBA", (S, S), (255, 255, 255, 255))
    white.putalpha(bub)
    canvas = Image.alpha_composite(canvas, white)

    # chữ Zx
    for kind, color in (("Z", GLYPH_Z), ("x", GLYPH_X)):
        g = Image.new("RGBA", (S, S), color + (255,))
        g.putalpha(glyph_mask(kind))
        canvas = Image.alpha_composite(canvas, g)

    return canvas


def export(img: Image.Image, size: int) -> Image.Image:
    out = img.resize((size, size), Image.LANCZOS)
    if size <= 160:
        out = out.filter(ImageFilter.UnsharpMask(radius=0.6, percent=60, threshold=2))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", help="ghi ảnh xem thử 512 vào đường dẫn này (không đụng assets)")
    ap.add_argument("--logo128", default=None, help="đường dẫn ghi bản 128 (zalux-logo.png)")
    args = ap.parse_args()

    img = build()
    if args.preview:
        export(img, 512).save(args.preview)
        print("preview ->", args.preview)
        return

    export(img, 512).save(ROOT / "assets" / "zalux.png", optimize=True)
    print("ghi", ROOT / "assets" / "zalux.png")
    if args.logo128:
        export(img, 128).save(args.logo128, optimize=True)
        print("ghi", args.logo128)


if __name__ == "__main__":
    main()
