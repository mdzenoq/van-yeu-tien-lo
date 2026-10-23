import type { ResolvedTileset } from '../loaders/tilesets';
import { getProp, type TiledLayer, type TiledObject } from '../types/tiled';
import type { StreamedCell, StreamedMapManifest } from './StreamedMap';

export interface Vec2 {
  x: number;
  y: number;
}

/** Mặt nạ để bỏ các bit flip/rotate của Tiled khỏi gid. */
export const GID_MASK = 0x1fffffff;

const COVERAGE_MIN = 3;
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1]
];

function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

function pointInPolygon(x: number, y: number, poly: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Metadata and collision data for only the currently active streamed cells. */
export class MapModel {
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly orientation: string;
  readonly staggerAxis: 'x' | 'y';
  private readonly staggerIndex: 'odd' | 'even';
  readonly spawn: Vec2;

  private readonly layersById = new Map<number, TiledLayer>();
  private readonly tilesetsByGid: ResolvedTileset[];
  private activeCells = new Map<string, StreamedCell>();
  private blocked = new Map<string, boolean>();
  private readonly manualBlocks = new Set<string>();
  private shapes: Vec2[][] = [];

  constructor(manifest: StreamedMapManifest, tilesets: ResolvedTileset[]) {
    this.width = manifest.width;
    this.height = manifest.height;
    this.tileWidth = manifest.tilewidth;
    this.tileHeight = manifest.tileheight;
    this.orientation = manifest.orientation;
    this.staggerAxis = manifest.staggeraxis ?? 'y';
    this.staggerIndex = manifest.staggerindex ?? 'odd';
    this.spawn = {
      x: Math.min(Math.max(manifest.spawn.x, 0), this.width - 1),
      y: Math.min(Math.max(manifest.spawn.y, 0), this.height - 1)
    };
    this.tilesetsByGid = [...tilesets].sort((a, b) => a.firstgid - b.firstgid);
    manifest.layers.forEach((layer, index) => this.layersById.set(layer.id ?? index + 1, layer));
  }

  setActiveCells(cells: readonly StreamedCell[]): void {
    this.activeCells = new Map(cells.map((cell) => [keyOf(cell.x, cell.y), cell]));
    this.blocked = new Map();
    this.shapes = [];

    for (const cell of cells) {
      const key = keyOf(cell.x, cell.y);
      let tileBlocked = this.manualBlocks.has(key);
      for (const tile of cell.tiles) {
        const layer = this.layersById.get(tile.layerId);
        const gid = tile.gid & GID_MASK;
        if (gid && (getProp<boolean>(layer ?? {}, 'collides') === true || this.isSolidGid(gid))) {
          tileBlocked = true;
          break;
        }
      }
      this.blocked.set(key, tileBlocked);
    }

    const objects = new Map<string, { layer: TiledLayer; object: TiledObject }>();
    for (const cell of cells) {
      for (const entry of cell.objects) {
        const layer = this.layersById.get(entry.layerId);
        if (!layer || getProp<boolean>(layer, 'collides') === false) continue;
        if (entry.object.gid || entry.object.point) continue;
        objects.set(`${entry.layerId}:${entry.object.id}`, { layer, object: entry.object });
      }
    }
    for (const { object } of objects.values()) {
      const polygon = this.objectShape(object);
      if (polygon) this.shapes.push(polygon);
    }
    this.rasterizeShapes();
  }

  getShapes(): ReadonlyArray<ReadonlyArray<Vec2>> {
    return this.shapes;
  }

  isTileLoaded(tx: number, ty: number): boolean {
    return this.activeCells.has(keyOf(tx, ty));
  }

  isBlockedAt(fx: number, fy: number): boolean {
    const tx = Math.floor(fx);
    const ty = Math.floor(fy);
    const key = keyOf(tx, ty);
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height || !this.activeCells.has(key)) return true;
    if (this.blocked.get(key)) return true;
    return this.shapes.some((poly) => pointInPolygon(fx, fy, poly));
  }

  tilesetForGid(gid: number): ResolvedTileset | undefined {
    for (let i = this.tilesetsByGid.length - 1; i >= 0; i--) {
      if (this.tilesetsByGid[i].firstgid <= gid) return this.tilesetsByGid[i];
    }
    return undefined;
  }

  isBlocked(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return true;
    const key = keyOf(tx, ty);
    if (!this.activeCells.has(key)) return true;
    return this.blocked.get(key) === true;
  }

  block(tx: number, ty: number): void {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return;
    const key = keyOf(tx, ty);
    this.manualBlocks.add(key);
    if (this.activeCells.has(key)) this.blocked.set(key, true);
  }

  tileToWorld(fx: number, fy: number): Vec2 {
    if (this.orientation === 'staggered') {
      const col = fx - 0.5;
      const row = fy - 0.5;
      if (this.staggerAxis === 'y') {
        return {
          x: (col + 0.5 + this.staggerOffset(row)) * this.tileWidth,
          y: (row + 0.5) * this.tileHeight / 2
        };
      }
      return {
        x: (col + 0.5) * this.tileWidth / 2,
        y: (row + 0.5 + this.staggerOffset(col)) * this.tileHeight
      };
    }
    const hw = this.tileWidth / 2;
    const hh = this.tileHeight / 2;
    return { x: (fx - fy) * hw + hw, y: (fx + fy) * hh };
  }

  tileToPreview(fx: number, fy: number): Vec2 {
    const world = this.tileToWorld(fx, fy);
    if (this.orientation !== 'staggered') {
      return { x: world.x / this.tileWidth, y: world.y / this.tileHeight };
    }
    return this.staggerAxis === 'y'
      ? { x: world.x / this.tileWidth, y: (2 * world.y) / this.tileHeight }
      : { x: (2 * world.x) / this.tileWidth, y: world.y / this.tileHeight };
  }

  previewToTile(x: number, y: number): Vec2 {
    const world =
      this.orientation !== 'staggered'
        ? { x: x * this.tileWidth, y: y * this.tileHeight }
        : this.staggerAxis === 'y'
          ? { x: x * this.tileWidth, y: (y * this.tileHeight) / 2 }
          : { x: (x * this.tileWidth) / 2, y: y * this.tileHeight };
    return this.worldToTile(world.x, world.y);
  }

  worldToTile(wx: number, wy: number): Vec2 {
    if (this.orientation === 'staggered') {
      if (this.staggerAxis === 'y') {
        const row = 2 * wy / this.tileHeight - 0.5;
        const col = (wx - this.tileWidth / 2) / this.tileWidth - this.staggerOffset(row);
        return { x: col + 0.5, y: row + 0.5 };
      }
      const col = 2 * wx / this.tileWidth - 0.5;
      const row = (wy - this.tileHeight / 2) / this.tileHeight - this.staggerOffset(col);
      return { x: col + 0.5, y: row + 0.5 };
    }
    const hw = this.tileWidth / 2;
    const hh = this.tileHeight / 2;
    const u = (wx - hw) / hw;
    const v = wy / hh;
    return { x: 0.5 * (u + v), y: 0.5 * (-u + v) };
  }

  worldBounds(margin = 128): { x: number; y: number; width: number; height: number } {
    if (this.orientation === 'staggered') {
      const cols = new Set([0, this.width - 1]);
      const rows = new Set([0, this.height - 1]);
      if (this.staggerAxis === 'x' && this.width > 1) cols.add(1);
      if (this.staggerAxis === 'y' && this.height > 1) rows.add(1);
      const centers = [...cols].flatMap((col) =>
        [...rows].map((row) => this.tileToWorld(col + 0.5, row + 0.5))
      );
      const minCenterX = Math.min(...centers.map(({ x }) => x));
      const maxCenterX = Math.max(...centers.map(({ x }) => x));
      const minCenterY = Math.min(...centers.map(({ y }) => y));
      const maxCenterY = Math.max(...centers.map(({ y }) => y));
      return {
        x: minCenterX - this.tileWidth / 2 - margin,
        y: minCenterY - this.tileHeight / 2 - margin,
        width: maxCenterX - minCenterX + this.tileWidth + margin * 2,
        height: maxCenterY - minCenterY + this.tileHeight + margin * 2
      };
    }
    const hw = this.tileWidth / 2;
    const hh = this.tileHeight / 2;
    const minX = -(this.height - 1) * hw;
    const maxX = (this.width - 1) * hw + this.tileWidth;
    const maxY = (this.width + this.height - 2) * hh + this.tileHeight;
    return {
      x: minX - margin,
      y: -margin,
      width: maxX - minX + margin * 2,
      height: maxY + margin * 2
    };
  }

  nearestFree(tx: number, ty: number): Vec2 {
    const sx = Math.min(Math.max(tx, 0), this.width - 1);
    const sy = Math.min(Math.max(ty, 0), this.height - 1);
    const startKey = keyOf(sx, sy);
    const queue: Vec2[] = [{ x: sx, y: sy }];
    const seen = new Set([startKey]);
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      if (this.isTileLoaded(current.x, current.y) && !this.isBlocked(current.x, current.y)) return current;
      for (const [dx, dy] of DIRS) {
        const x = current.x + dx;
        const y = current.y + dy;
        const key = keyOf(x, y);
        if (!this.isTileLoaded(x, y) || seen.has(key)) continue;
        seen.add(key);
        queue.push({ x, y });
      }
    }
    throw new Error(`Không tìm thấy ô trống trong vùng map đang tải quanh (${tx}, ${ty}).`);
  }

  /** BFS is limited to the currently loaded tile region. */
  findPath(sx: number, sy: number, gx: number, gy: number): Vec2[] | null {
    if (this.isBlocked(gx, gy) || this.isBlocked(sx, sy)) return null;
    if (sx === gx && sy === gy) return [];
    const start = keyOf(sx, sy);
    const goal = keyOf(gx, gy);
    const previous = new Map<string, string>([[start, start]]);
    const queue: Vec2[] = [{ x: sx, y: sy }];

    for (let head = 0; head < queue.length && !previous.has(goal); head++) {
      const current = queue[head];
      for (const [dx, dy] of DIRS) {
        const x = current.x + dx;
        const y = current.y + dy;
        const key = keyOf(x, y);
        if (previous.has(key) || this.isBlocked(x, y)) continue;
        if (dx !== 0 && dy !== 0 && (this.isBlocked(current.x + dx, current.y) || this.isBlocked(current.x, current.y + dy))) {
          continue;
        }
        previous.set(key, keyOf(current.x, current.y));
        queue.push({ x, y });
      }
    }
    if (!previous.has(goal)) return null;
    const path: Vec2[] = [];
    for (let current = goal; current !== start; current = previous.get(current)!) {
      const [x, y] = current.split(',').map(Number);
      path.push({ x, y });
    }
    return path.reverse();
  }

  findPathToward(sx: number, sy: number, targetX: number, targetY: number): Vec2[] | null {
    if (this.isBlocked(sx, sy)) return null;
    const start = keyOf(sx, sy);
    const previous = new Map<string, string>([[start, start]]);
    const queue: Vec2[] = [{ x: sx, y: sy }];
    let best = queue[0];
    let bestDistance = this.distanceToTarget(best, targetX, targetY);

    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      const distance = this.distanceToTarget(current, targetX, targetY);
      if (distance < bestDistance) {
        best = current;
        bestDistance = distance;
      }
      for (const [dx, dy] of DIRS) {
        const x = current.x + dx;
        const y = current.y + dy;
        const key = keyOf(x, y);
        if (previous.has(key) || this.isBlocked(x, y)) continue;
        if (dx !== 0 && dy !== 0 && (this.isBlocked(current.x + dx, current.y) || this.isBlocked(current.x, current.y + dy))) {
          continue;
        }
        previous.set(key, keyOf(current.x, current.y));
        queue.push({ x, y });
      }
    }

    if (best.x === sx && best.y === sy) return null;
    const path: Vec2[] = [];
    const goal = keyOf(best.x, best.y);
    for (let current = goal; current !== start; current = previous.get(current)!) {
      const [x, y] = current.split(',').map(Number);
      path.push({ x, y });
    }
    return path.reverse();
  }

  private distanceToTarget(tile: Vec2, targetX: number, targetY: number): number {
    const point = this.tileToWorld(tile.x + 0.5, tile.y + 0.5);
    const target = this.tileToWorld(targetX + 0.5, targetY + 0.5);
    return Math.hypot(point.x - target.x, point.y - target.y);
  }

  smoothPath(path: readonly Vec2[], start: Vec2): Vec2[] {
    if (this.orientation !== 'staggered' || path.length < 2) return [...path];

    const smoothed: Vec2[] = [];
    let from = start;
    let index = 0;
    while (index < path.length) {
      let furthest = index;
      for (let candidate = path.length - 1; candidate > index; candidate--) {
        const target = this.tileToWorld(path[candidate].x + 0.5, path[candidate].y + 0.5);
        if (this.isWorldSegmentClear(from, target)) {
          furthest = candidate;
          break;
        }
      }
      smoothed.push(path[furthest]);
      from = this.tileToWorld(path[furthest].x + 0.5, path[furthest].y + 0.5);
      index = furthest + 1;
    }
    return smoothed;
  }

  private isWorldSegmentClear(start: Vec2, end: Vec2): boolean {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy);
    const sampleCount = Math.max(1, Math.ceil(distance * 8 / Math.min(this.tileWidth, this.tileHeight)));
    const radiusX = 0.22 * this.tileWidth;
    const radiusY = 0.22 * this.tileHeight / 2;
    for (let sample = 0; sample <= sampleCount; sample++) {
      const progress = sample / sampleCount;
      const x = start.x + dx * progress;
      const y = start.y + dy * progress;
      for (const offsetX of [-radiusX, radiusX]) {
        for (const offsetY of [-radiusY, radiusY]) {
          const tile = this.worldToTile(x + offsetX, y + offsetY);
          if (this.isBlockedAt(tile.x, tile.y)) return false;
        }
      }
    }
    return true;
  }

  private isSolidGid(gid: number): boolean {
    const tileset = this.tilesetForGid(gid);
    return !!tileset && tileset.collidingIds.includes(gid - tileset.firstgid);
  }

  depthAt(fx: number, fy: number): number {
    return this.orientation === 'staggered' ? this.tileToWorld(fx, fy).y : fx + fy;
  }

  private staggerOffset(value: number): number {
    const lower = Math.floor(value);
    const fraction = value - lower;
    const shifted = Math.abs(lower % 2) === (this.staggerIndex === 'odd' ? 1 : 0);
    return (shifted ? 1 - fraction : fraction) * 0.5;
  }

  private objectShape(object: TiledObject): Vec2[] | null {
    if (this.orientation === 'staggered') {
      const convert = (x: number, y: number): Vec2 => this.worldToTile(x, y);
      if (object.polygon && object.polygon.length >= 3) {
        return object.polygon.map((point) => convert(object.x + point.x, object.y + point.y));
      }
      if ((object.width ?? 0) > 0 && (object.height ?? 0) > 0) {
        return [
          convert(object.x, object.y),
          convert(object.x + object.width!, object.y),
          convert(object.x + object.width!, object.y + object.height!),
          convert(object.x, object.y + object.height!)
        ];
      }
      return null;
    }
    const unit = this.tileHeight;
    if (object.polygon && object.polygon.length >= 3) {
      return object.polygon.map((point) => ({ x: (object.x + point.x) / unit, y: (object.y + point.y) / unit }));
    }
    if ((object.width ?? 0) > 0 && (object.height ?? 0) > 0) {
      const x0 = object.x / unit;
      const y0 = object.y / unit;
      const x1 = (object.x + object.width!) / unit;
      const y1 = (object.y + object.height!) / unit;
      return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    }
    return null;
  }

  private rasterizeShapes(): void {
    const hits = new Map<string, number>();
    for (const polygon of this.shapes) {
      const xs = polygon.map((point) => point.x);
      const ys = polygon.map((point) => point.y);
      const x0 = Math.max(0, Math.floor(Math.min(...xs)));
      const x1 = Math.min(this.width - 1, Math.floor(Math.max(...xs)));
      const y0 = Math.max(0, Math.floor(Math.min(...ys)));
      const y1 = Math.min(this.height - 1, Math.floor(Math.max(...ys)));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const key = keyOf(x, y);
          if (!this.activeCells.has(key)) continue;
          let count = pointInPolygon(x + 0.5, y + 0.5, polygon) ? COVERAGE_MIN : 0;
          for (let j = 0; j < 4; j++) {
            for (let i = 0; i < 4; i++) {
              if (pointInPolygon(x + (i + 0.5) / 4, y + (j + 0.5) / 4, polygon)) count++;
            }
          }
          hits.set(key, Math.min(255, (hits.get(key) ?? 0) + count));
        }
      }
    }
    for (const [key, count] of hits) {
      if (count >= COVERAGE_MIN) this.blocked.set(key, true);
    }
  }
}
