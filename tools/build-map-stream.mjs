import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configText = fs.readFileSync(path.join(root, 'src/config.ts'), 'utf8');
const mapUrlMatch = configText.match(/^\s*export const MAP_URL = ['"]([^'"]+)['"]/m);
if (!mapUrlMatch) throw new Error('Could not find MAP_URL in src/config.ts.');

const mapsDir = path.join(root, 'public/assets/maps');
const imagesDir = path.join(root, 'public/assets/images');
fs.mkdirSync(imagesDir, { recursive: true });
for (const name of fs.readdirSync(mapsDir).filter((file) => file.endsWith('.json'))) {
  const sourcePath = path.join(mapsDir, name);
  const imagePath = path.join(imagesDir, `${path.basename(name, '.json')}.png`);
  const preview = spawnSync(
    'python3',
    [path.join(root, 'tools/build-map-preview.py'), sourcePath, imagePath],
    { cwd: root, encoding: 'utf8' }
  );
  if (preview.error) throw preview.error;
  if (preview.status !== 0) {
    throw new Error(`Could not generate mini-map PNG for ${name}:\n${preview.stderr || preview.stdout}`);
  }
  if (preview.stdout.trim()) console.log(preview.stdout.trim());
}

const mapUrl = mapUrlMatch[1];
const mapPath = path.join(root, 'public', mapUrl);
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
if (!['isometric', 'staggered'].includes(map.orientation) || map.infinite) {
  throw new Error('Streamed maps must be finite Tiled isometric or staggered JSON maps.');
}
if (map.orientation === 'staggered' && !['x', 'y'].includes(map.staggeraxis)) {
  throw new Error('Staggered maps must define staggeraxis as "x" or "y".');
}
if (!Number.isInteger(map.width) || !Number.isInteger(map.height) || !map.tileheight) {
  throw new Error('Map is missing finite dimensions or tileheight.');
}

const mapId = path.basename(mapUrl, path.extname(mapUrl));
const outputDir = path.join(root, 'public/assets/map-stream', mapId);
const cellsDir = path.join(outputDir, 'cells');
fs.mkdirSync(cellsDir, { recursive: true });
for (const name of fs.readdirSync(cellsDir)) {
  if (/^\d+_\d+\.json$/.test(name)) fs.unlinkSync(path.join(cellsDir, name));
}

const layerId = (layer, index) => layer.id ?? index + 1;
const staggerOffset = (value) => {
  const lower = Math.floor(value);
  const fraction = value - lower;
  const shifted = Math.abs(lower % 2) === (map.staggerindex === 'even' ? 0 : 1);
  return (shifted ? 1 - fraction : fraction) * 0.5;
};
const worldToTile = (x, y) => {
  if (map.orientation !== 'staggered') {
    return { x: x / map.tileheight, y: y / map.tileheight };
  }
  if (map.staggeraxis === 'y') {
    const row = 2 * y / map.tileheight - 0.5;
    const col = (x - map.tilewidth / 2) / map.tilewidth - staggerOffset(row);
    return { x: col + 0.5, y: row + 0.5 };
  }
  const col = 2 * x / map.tilewidth - 0.5;
  const row = (y - map.tileheight / 2) / map.tileheight - staggerOffset(col);
  return { x: col + 0.5, y: row + 0.5 };
};
const cells = Array.from({ length: map.width * map.height }, (_, index) => ({
  x: index % map.width,
  y: Math.floor(index / map.width),
  tiles: [],
  objects: []
}));

for (const [index, layer] of map.layers.entries()) {
  const id = layerId(layer, index);
  if (layer.type === 'tilelayer') {
    if (!Array.isArray(layer.data)) {
      throw new Error(`Layer "${layer.name}" must use Tiled CSV/uncompressed array data.`);
    }
    const width = layer.width ?? map.width;
    const height = layer.height ?? map.height;
    if (layer.data.length !== width * height) {
      throw new Error(`Layer "${layer.name}" data length does not match its dimensions.`);
    }
    const offsetX = layer.startx ?? layer.x ?? 0;
    const offsetY = layer.starty ?? layer.y ?? 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const gid = layer.data[y * width + x] ?? 0;
        const mapX = x + offsetX;
        const mapY = y + offsetY;
        if (!gid || mapX < 0 || mapY < 0 || mapX >= map.width || mapY >= map.height) continue;
        cells[mapY * map.width + mapX].tiles.push({ layerId: id, gid });
      }
    }
  } else if (layer.type === 'objectgroup') {
    for (const object of layer.objects ?? []) {
      const corners = [
        worldToTile(object.x, object.y),
        worldToTile(object.x + (object.width ?? 0), object.y),
        worldToTile(object.x + (object.width ?? 0), object.y + (object.height ?? 0)),
        worldToTile(object.x, object.y + (object.height ?? 0))
      ];
      if (object.polygon?.length) {
        for (const point of object.polygon) {
          corners.push(worldToTile(object.x + point.x, object.y + point.y));
        }
      }
      const x0 = Math.max(0, Math.floor(Math.min(...corners.map(({ x }) => x))));
      const x1 = Math.min(map.width - 1, Math.floor(Math.max(...corners.map(({ x }) => x))));
      const y0 = Math.max(0, Math.floor(Math.min(...corners.map(({ y }) => y))));
      const y1 = Math.min(map.height - 1, Math.floor(Math.max(...corners.map(({ y }) => y))));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          cells[y * map.width + x].objects.push({ layerId: id, object });
        }
      }
    }
  }
}

const spawnObject = map.layers
  .filter((layer) => layer.type === 'objectgroup')
  .flatMap((layer) => layer.objects ?? [])
  .find((object) => (object.name || object.class || object.type || '').toLowerCase() === 'spawn');
const spawn = spawnObject
  ? (() => {
      const point = worldToTile(spawnObject.x, spawnObject.y);
      return { x: Math.floor(point.x), y: Math.floor(point.y) };
    })()
  : { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };

const layers = map.layers.map((layer, index) => {
  const metadata = { ...layer };
  delete metadata.data;
  delete metadata.objects;
  metadata.id = layerId(layer, index);
  return metadata;
});
const manifest = {
  ...map,
  layers,
  spawn
};

fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest));
for (const cell of cells) {
  fs.writeFileSync(path.join(cellsDir, `${cell.x}_${cell.y}.json`), JSON.stringify(cell));
}
console.log(`Generated ${cells.length} streamed cells for ${mapUrl} in ${path.relative(root, outputDir)}.`);
