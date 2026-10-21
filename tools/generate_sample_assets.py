#!/usr/bin/env python3
"""Sinh asset mẫu: tileset PNG + .tsx, sprite người chơi và map.json (Tiled, isometric).
Chỉ để chạy thử — hãy thay bằng map/tileset của bạn trong public/assets/.
Cần: pip install pillow
"""
import json
import random
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent / "public" / "assets"
TW, TH, CELL_H = 64, 32, 64  # tile map 64x32, ảnh tile 64x64 (cao hơn ô lưới)
COLS = 4
random.seed(7)


def shade(c, f):
    return tuple(max(0, min(255, int(v * f))) for v in c[:3]) + (255,)


def flat_diamond(color, noise=10):
    img = Image.new("RGBA", (TW, CELL_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pts = [(32, 32), (63, 48), (32, 63), (0, 48)]
    d.polygon(pts, fill=color + (255,), outline=shade(color, 0.75))
    px = img.load()
    for y in range(32, 64):
        for x in range(TW):
            if px[x, y][3] and random.random() < 0.25:
                f = 1 + random.uniform(-noise, noise) / 100
                px[x, y] = shade(px[x, y], f)
    return img


def cube(top, h, pattern=None):
    img = Image.new("RGBA", (TW, CELL_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    T = [(32, 32 - h), (63, 48 - h), (32, 63 - h), (0, 48 - h)]
    L = [(0, 48 - h), (32, 63 - h), (32, 63), (0, 48)]
    R = [(32, 63 - h), (63, 48 - h), (63, 48), (32, 63)]
    d.polygon(L, fill=shade(top, 0.62), outline=shade(top, 0.4))
    d.polygon(R, fill=shade(top, 0.8), outline=shade(top, 0.4))
    d.polygon(T, fill=shade(top, 1.0), outline=shade(top, 0.55))
    if pattern == "brick":
        for k in range(1, h // 8 + 1):
            o = k * 8
            d.line([(0, 48 - h + o), (32, 63 - h + o)], fill=shade(top, 0.45))
            d.line([(32, 63 - h + o), (63, 48 - h + o)], fill=shade(top, 0.5))
    if pattern == "plank":
        d.line([(32, 63 - h), (32, 63)], fill=shade(top, 0.4))
        d.line([(0, 48 - h // 2), (32, 63 - h // 2)], fill=shade(top, 0.45))
        d.line([(32, 63 - h // 2), (63, 48 - h // 2)], fill=shade(top, 0.5))
    return img


def tree():
    img = Image.new("RGBA", (TW, CELL_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([20, 44, 44, 54], fill=(0, 0, 0, 70))
    d.rectangle([29, 30, 35, 50], fill=(102, 70, 40, 255), outline=(60, 40, 22, 255))
    for cx, cy, r, col in [(32, 22, 14, (46, 140, 70)), (22, 29, 10, (38, 120, 60)), (42, 29, 10, (52, 156, 78))]:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col + (255,), outline=(24, 80, 40, 255))
    return img


def build_tileset():
    tiles = [
        flat_diamond((88, 164, 82)),      # 0 cỏ
        flat_diamond((150, 112, 72)),     # 1 đất
        flat_diamond((140, 144, 152)),    # 2 đá
        flat_diamond((58, 118, 196), 6),  # 3 nước (chặn)
        flat_diamond((226, 206, 140)),    # 4 cát
        cube((178, 86, 70), 32, "brick"), # 5 tường gạch (chặn)
        tree(),                           # 6 cây (chặn)
        cube((190, 140, 80), 16, "plank"),# 7 thùng gỗ (chặn)
    ]
    rows = (len(tiles) + COLS - 1) // COLS
    sheet = Image.new("RGBA", (COLS * TW, rows * CELL_H), (0, 0, 0, 0))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % COLS) * TW, (i // COLS) * CELL_H))
    out = ROOT / "tilesets"
    sheet.save(out / "iso_tiles.png")

    solid = [3, 5, 6, 7]
    tile_xml = "".join(
        f' <tile id="{i}">\n  <properties>\n   <property name="collides" type="bool" value="true"/>\n  </properties>\n </tile>\n'
        for i in solid
    )
    tsx = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<tileset version="1.10" tiledversion="1.10.2" name="iso_tiles" tilewidth="{TW}" tileheight="{CELL_H}" '
        f'tilecount="{len(tiles)}" columns="{COLS}">\n'
        f' <grid orientation="isometric" width="{TW}" height="{TH}"/>\n'
        f' <image source="iso_tiles.png" width="{sheet.width}" height="{sheet.height}"/>\n'
        f'{tile_xml}</tileset>\n'
    )
    (out / "iso_tiles.tsx").write_text(tsx, encoding="utf-8")


def build_player():
    img = Image.new("RGBA", (48, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([10, 50, 38, 62], fill=(0, 0, 0, 90))                       # bóng
    d.rectangle([18, 40, 22, 55], fill=(52, 58, 110, 255))                # chân
    d.rectangle([26, 40, 30, 55], fill=(52, 58, 110, 255))
    d.rectangle([15, 22, 33, 42], fill=(66, 120, 210, 255), outline=(30, 60, 120, 255))  # thân
    d.rectangle([11, 24, 15, 38], fill=(66, 120, 210, 255))               # tay
    d.rectangle([33, 24, 37, 38], fill=(66, 120, 210, 255))
    d.ellipse([15, 6, 33, 24], fill=(244, 206, 170, 255), outline=(150, 110, 80, 255))   # đầu
    d.pieslice([14, 4, 34, 22], 180, 360, fill=(70, 46, 30, 255))         # tóc
    d.rectangle([20, 14, 21, 16], fill=(30, 30, 30, 255))                 # mắt
    d.rectangle([27, 14, 28, 16], fill=(30, 30, 30, 255))
    img.save(ROOT / "sprites" / "player_male.png")


def build_map():
    W = H = 24
    GRASS, DIRT, STONE, WATER, SAND, BRICK, TREE, CRATE = range(1, 9)
    ground = [[GRASS] * W for _ in range(H)]
    walls = [[0] * W for _ in range(H)]

    for i in range(W):
        ground[12][i] = DIRT
        ground[i][12] = DIRT
    for y in range(10, 15):
        for x in range(10, 15):
            ground[y][x] = STONE
    for y in range(14, 21):          # ao nước + viền cát
        for x in range(3, 10):
            ground[y][x] = SAND
    for y in range(15, 20):
        for x in range(4, 9):
            ground[y][x] = WATER

    for i in range(W):               # tường bao, chừa cổng ở giữa
        for (x, y) in [(i, 0), (i, H - 1), (0, i), (W - 1, i)]:
            if i not in (11, 12):
                walls[y][x] = BRICK
    for (x, y) in [(16, 5), (18, 7), (6, 6), (4, 9), (19, 17), (16, 19), (8, 3), (20, 12), (3, 21)]:
        walls[y][x] = TREE
    for (x, y) in [(9, 9), (15, 9), (9, 15), (15, 15), (14, 13)]:
        walls[y][x] = CRATE
    for y in range(4, 9):            # dãy tường nhỏ để thử đi vòng
        walls[y][13] = BRICK
    walls[6][13] = 0

    flat = lambda g: [v for row in g for v in row]
    layers = [
        {"id": 1, "name": "ground", "type": "tilelayer", "x": 0, "y": 0, "width": W, "height": H,
         "opacity": 1, "visible": True, "data": flat(ground)},
        {"id": 2, "name": "walls", "type": "tilelayer", "x": 0, "y": 0, "width": W, "height": H,
         "opacity": 1, "visible": True,
         "properties": [{"name": "sorted", "type": "bool", "value": True}], "data": flat(walls)},
        {"id": 3, "name": "objects", "type": "objectgroup", "x": 0, "y": 0, "opacity": 1, "visible": True,
         "draworder": "topdown",
         "objects": [{"id": 1, "name": "spawn", "type": "spawn", "class": "spawn", "point": True,
                      "x": 12.5 * TH, "y": 12.5 * TH, "width": 0, "height": 0, "rotation": 0, "visible": True}]},
    ]
    tmap = {
        "compressionlevel": -1, "type": "map", "version": "1.10", "tiledversion": "1.10.2",
        "orientation": "isometric", "renderorder": "right-down", "infinite": False,
        "width": W, "height": H, "tilewidth": TW, "tileheight": TH,
        "nextlayerid": 4, "nextobjectid": 2,
        "layers": layers,
        "tilesets": [{"firstgid": 1, "source": "../tilesets/iso_tiles.tsx"}],
    }
    (ROOT / "maps" / "map.json").write_text(json.dumps(tmap, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    build_tileset()
    build_player()
    build_map()
    print("Đã sinh asset mẫu vào", ROOT)
