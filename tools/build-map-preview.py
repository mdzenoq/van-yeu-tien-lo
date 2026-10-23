#!/usr/bin/env python3
"""Render a compact PNG overview from a finite Tiled map and its tilesets."""
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image


map_path = Path(sys.argv[1]).resolve()
output_path = Path(sys.argv[2]).resolve()
map_data = json.loads(map_path.read_text())
width = map_data["width"]
height = map_data["height"]
scale = min(4, 1024 / max(width, height))
canvas_size = (max(1, round(width * scale)), max(1, round(height * scale)))
canvas = Image.new("RGBA", canvas_size, (23, 42, 50, 255))

tilesets = []
for ref in map_data["tilesets"]:
    if ref.get("source"):
        tsx_path = (map_path.parent / ref["source"]).resolve()
        root = ET.parse(tsx_path).getroot()
        image_node = root.find("image")
        if image_node is None:
            raise ValueError(f'Tileset "{root.get("name", tsx_path.name)}" has no image.')
        definition = dict(root.attrib)
        definition.update(image_node.attrib)
        image_path = (tsx_path.parent / image_node.get("source", "")).resolve()
        offset_node = root.find("tileoffset")
        offset = (
            int(offset_node.get("x", "0")) if offset_node is not None else 0,
            int(offset_node.get("y", "0")) if offset_node is not None else 0,
        )
    else:
        definition = ref
        image_path = (map_path.parent / ref["image"]).resolve()
        offset = tuple(ref.get("tileoffset", {}).get(axis, 0) for axis in ("x", "y"))

    image = Image.open(image_path).convert("RGBA")
    transparent = definition.get("trans", "").lstrip("#")
    if transparent:
        rgb = tuple(int(transparent[index:index + 2], 16) for index in (0, 2, 4))
        pixels = image.load()
        for py in range(image.height):
            for px in range(image.width):
                if pixels[px, py][:3] == rgb:
                    pixels[px, py] = (*rgb, 0)
    tile_width = int(definition.get("tilewidth", 0))
    tile_height = int(definition.get("tileheight", 0))
    spacing = int(definition.get("spacing", 0))
    margin = int(definition.get("margin", 0))
    columns = int(definition.get("columns", 0)) or max(
        1, (image.width - 2 * margin + spacing) // (tile_width + spacing)
    )
    tilesets.append({
        "firstgid": ref["firstgid"],
        "image": image,
        "tilewidth": tile_width,
        "tileheight": tile_height,
        "spacing": spacing,
        "margin": margin,
        "columns": columns,
        "offset": offset,
    })


def stagger_offset(value):
    shifted = int(value) % 2 == (0 if map_data.get("staggerindex") == "even" else 1)
    return 0.5 if shifted else 0


def tile_center(x, y):
    tw = map_data["tilewidth"]
    th = map_data["tileheight"]
    if map_data["orientation"] == "staggered":
        if map_data.get("staggeraxis", "y") == "y":
            return (x + 0.5 + stagger_offset(y)) * scale, (y + 0.5) * scale
        return (x + 0.5) * scale, (y + 0.5 + stagger_offset(x)) * scale
    return ((x - y) * tw / 2 + tw / 2) * scale / tw, ((x + y + 1) * th / 2) * scale / th


for layer in map_data["layers"]:
    if layer.get("type") != "tilelayer" or layer.get("visible") is False:
        continue
    layer_width = layer.get("width", width)
    layer_height = layer.get("height", height)
    if "data" not in layer or len(layer["data"]) != layer_width * layer_height:
        raise ValueError(f'Layer "{layer.get("name", "")}" must have uncompressed tile data.')
    offset_x = layer.get("startx", layer.get("x", 0))
    offset_y = layer.get("starty", layer.get("y", 0))
    for row in range(layer_height):
        for col in range(layer_width):
            gid_flags = layer["data"][row * layer_width + col] & 0xFFFFFFFF
            gid = gid_flags & 0x1FFFFFFF
            x = col + offset_x
            y = row + offset_y
            if not gid or x < 0 or y < 0 or x >= width or y >= height:
                continue
            tileset = next((item for item in reversed(tilesets) if item["firstgid"] <= gid), None)
            if tileset is None:
                continue
            local_id = gid - tileset["firstgid"]
            source_x = tileset["margin"] + (local_id % tileset["columns"]) * (
                tileset["tilewidth"] + tileset["spacing"]
            )
            source_y = tileset["margin"] + (local_id // tileset["columns"]) * (
                tileset["tileheight"] + tileset["spacing"]
            )
            tile = tileset["image"].crop((
                source_x,
                source_y,
                source_x + tileset["tilewidth"],
                source_y + tileset["tileheight"],
            ))
            if gid_flags & 0x80000000:
                tile = tile.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            if gid_flags & 0x40000000:
                tile = tile.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
            target_size = (
                max(1, round(tileset["tilewidth"] * scale / map_data["tilewidth"] * (2 if map_data["orientation"] == "staggered" and map_data.get("staggeraxis", "y") == "x" else 1))),
                max(1, round(tileset["tileheight"] * scale / map_data["tileheight"] * (2 if map_data["orientation"] == "staggered" and map_data.get("staggeraxis", "y") == "y" else 1))),
            )
            tile = tile.resize(target_size, Image.Resampling.LANCZOS)
            center_x, center_y = tile_center(x, y)
            center_x += tileset["offset"][0] * scale / map_data["tilewidth"]
            center_y += tileset["offset"][1] * scale / map_data["tileheight"]
            canvas.alpha_composite(tile, (
                round(center_x - tile.width / 2),
                round(center_y - tile.height / 2),
            ))

output_path.parent.mkdir(parents=True, exist_ok=True)
canvas.save(output_path, format="PNG", optimize=True)
print(f"Generated {canvas.width}x{canvas.height} mini-map preview at {output_path}.")
