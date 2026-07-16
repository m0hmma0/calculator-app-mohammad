#!/usr/bin/env python3
"""يولّد أيقونات التطبيق و شاشة البداية (splash) لمشروع Expo."""
import os
from PIL import Image, ImageDraw

ASSETS = os.path.join(os.path.dirname(__file__), "..", "assets")
os.makedirs(ASSETS, exist_ok=True)

BG = (23, 23, 28, 255)        # #17171C
DIGIT = (46, 47, 56, 255)     # #2E2F38
ORANGE = (255, 159, 10, 255)  # #FF9F0A
WHITE = (255, 255, 255, 255)


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def draw_keypad(img, cx, cy, size):
    """يرسم شبكة 2x2 من الأزرار توحي بآلة حاسبة."""
    draw = ImageDraw.Draw(img)
    gap = size * 0.10
    cell = (size - gap) / 2
    r = cell * 0.28
    x0 = cx - size / 2
    y0 = cy - size / 2
    cells = [
        (0, 0, DIGIT), (1, 0, DIGIT),
        (0, 1, DIGIT), (1, 1, ORANGE),
    ]
    for col, row, color in cells:
        bx = x0 + col * (cell + gap)
        by = y0 + row * (cell + gap)
        rounded(draw, [bx, by, bx + cell, by + cell], r, color)
    # علامة "=" داخل الخانة البرتقالية للإيحاء بالنتيجة
    bx = x0 + 1 * (cell + gap)
    by = y0 + 1 * (cell + gap)
    lw = max(2, int(cell * 0.10))
    ly1 = by + cell * 0.40
    ly2 = by + cell * 0.60
    lx1 = bx + cell * 0.28
    lx2 = bx + cell * 0.72
    draw.line([lx1, ly1, lx2, ly1], fill=WHITE, width=lw)
    draw.line([lx1, ly2, lx2, ly2], fill=WHITE, width=lw)


def make_icon(path, canvas, glyph, bg=BG, rounded_bg=False):
    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    if bg is not None:
        d = ImageDraw.Draw(img)
        if rounded_bg:
            rounded(d, [0, 0, canvas, canvas], canvas * 0.22, bg)
        else:
            d.rectangle([0, 0, canvas, canvas], fill=bg)
    draw_keypad(img, canvas / 2, canvas / 2, glyph)
    img.save(path)
    print("wrote", path)


# icon.png للتطبيق (1024x1024)
make_icon(os.path.join(ASSETS, "icon.png"), 1024, 620, bg=BG)

# adaptive-icon.png (الأمامية) — أكبر قليلاً لأن أندرويد يقصّ الحواف
make_icon(os.path.join(ASSETS, "adaptive-icon.png"), 1024, 520, bg=None)

# favicon.png للويب
make_icon(os.path.join(ASSETS, "favicon.png"), 96, 64, bg=BG)

# splash.png (شاشة البداية) — شعار في المنتصف على خلفية داكنة
splash = Image.new("RGBA", (1284, 2778), BG)
draw_keypad(splash, 1284 / 2, 2778 / 2, 520)
splash.save(os.path.join(ASSETS, "splash.png"))
print("wrote splash.png")
