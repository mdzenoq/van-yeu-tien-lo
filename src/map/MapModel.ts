import type { ResolvedTileset } from '../loaders/tilesets';
import { getProp, type TiledMap } from '../types/tiled';

export interface Vec2 {
  x: number;
  y: number;
}

/** Mặt nạ để bỏ các bit flip/rotate của Tiled khỏi gid. */
export const GID_MASK = 0x1fffffff;

/** Số mẫu (trên lưới 4x4) của 1 tile nằm trong shape để coi tile đó là bị chặn khi tìm đường. */
const COVERAGE_MIN = 3;

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1]
];

function pointInPolygon(x: number, y: number, poly: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Dữ liệu logic của map: lưới va chạm, điểm spawn, tìm đường và công thức chiếu isometric.
 * Công thức chiếu khớp với IsometricWorldToTileXY của Phaser (layer đặt tại 0,0, scale 1):
 * toạ độ tile liên tục (fx, fy) có số nguyên = đỉnh trên của tile.
 */
export class MapModel {
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly spawn: Vec2;

  private readonly blocked: Uint8Array; // tile layer (collides)
  private readonly pathBlocked: Uint8Array; // tile layer + shape từ object layer (dùng cho tìm đường)
  private readonly shapes: Vec2[][] = []; // đa giác va chạm, đơn vị tile
  private readonly tilesetsByGid: ResolvedTileset[];

  constructor(map: TiledMap, tilesets: ResolvedTileset[]) {
    this.width = map.width;
    this.height = map.height;
    this.tileWidth = map.tilewidth;
    this.tileHeight = map.tileheight;
    this.tilesetsByGid = [...tilesets].sort((a, b) => a.firstgid - b.firstgid);
    this.blocked = new Uint8Array(this.width * this.height);

    for (const layer of map.layers) {
      if (layer.type !== 'tilelayer') continue;
      if (!Array.isArray(layer.data)) {
        throw new Error(
          `Layer "${layer.name}" không có data dạng mảng. Trong Tiled hãy đặt Tile Layer Format = CSV.`
        );
      }
      const solidLayer = getProp<boolean>(layer, 'collides') === true;
      for (let i = 0; i < this.blocked.length; i++) {
        const gid = (layer.data[i] ?? 0) & GID_MASK;
        if (!gid) continue;
        if (solidLayer || this.isSolidGid(gid)) this.blocked[i] = 1;
      }
    }

    this.collectShapes(map);
    this.pathBlocked = this.rasterizeShapes();
    this.spawn = this.findSpawn(map);
  }

  /** Đa giác va chạm (đơn vị tile) lấy từ rectangle/polygon trong Object Layer. */
  getShapes(): ReadonlyArray<ReadonlyArray<Vec2>> {
    return this.shapes;
  }

  /** Kiểm tra theo điểm liên tục (dùng cho va chạm khi đi bằng phím). */
  isBlockedAt(fx: number, fy: number): boolean {
    const tx = Math.floor(fx);
    const ty = Math.floor(fy);
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return true;
    if (this.blocked[ty * this.width + tx] === 1) return true;
    for (const poly of this.shapes) if (pointInPolygon(fx, fy, poly)) return true;
    return false;
  }

  private collectShapes(map: TiledMap): void {
    // Object layer của map isometric dùng đơn vị: 1 tile = tileheight.
    const u = this.tileHeight;
    for (const layer of map.layers) {
      if (layer.type !== 'objectgroup') continue;
      if (getProp<boolean>(layer, 'collides') === false) continue;
      for (const obj of layer.objects ?? []) {
        if (obj.gid || obj.point) continue; // tile object chỉ để vẽ
        if (obj.polygon && obj.polygon.length >= 3) {
          this.shapes.push(obj.polygon.map((p) => ({ x: (obj.x + p.x) / u, y: (obj.y + p.y) / u })));
        } else if ((obj.width ?? 0) > 0 && (obj.height ?? 0) > 0) {
          const x0 = obj.x / u;
          const y0 = obj.y / u;
          const x1 = (obj.x + (obj.width ?? 0)) / u;
          const y1 = (obj.y + (obj.height ?? 0)) / u;
          this.shapes.push([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]);
        }
      }
    }
  }

  private rasterizeShapes(): Uint8Array {
    const hits = new Uint8Array(this.width * this.height);
    for (const poly of this.shapes) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of poly) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      const x0 = Math.max(0, Math.floor(minX));
      const x1 = Math.min(this.width - 1, Math.floor(maxX));
      const y0 = Math.max(0, Math.floor(minY));
      const y1 = Math.min(this.height - 1, Math.floor(maxY));
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          let n = pointInPolygon(tx + 0.5, ty + 0.5, poly) ? COVERAGE_MIN : 0; // tâm tile nằm trong -> chặn
          for (let j = 0; j < 4; j++) {
            for (let i = 0; i < 4; i++) {
              if (pointInPolygon(tx + (i + 0.5) / 4, ty + (j + 0.5) / 4, poly)) n++;
            }
          }
          const idx = ty * this.width + tx;
          hits[idx] = Math.min(255, hits[idx] + n);
        }
      }
    }
    const out = new Uint8Array(this.width * this.height);
    for (let i = 0; i < out.length; i++) out[i] = this.blocked[i] === 1 || hits[i] >= COVERAGE_MIN ? 1 : 0;
    return out;
  }

  tilesetForGid(gid: number): ResolvedTileset | undefined {
    for (let i = this.tilesetsByGid.length - 1; i >= 0; i--) {
      if (this.tilesetsByGid[i].firstgid <= gid) return this.tilesetsByGid[i];
    }
    return undefined;
  }

  private isSolidGid(gid: number): boolean {
    const ts = this.tilesetForGid(gid);
    return !!ts && ts.collidingIds.includes(gid - ts.firstgid);
  }

  isBlocked(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return true;
    return this.pathBlocked[ty * this.width + tx] === 1;
  }

    /** Đánh dấu 1 ô là vật cản (vd. NPC đứng yên). */
  block(tx: number, ty: number): void {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return;
    const i = ty * this.width + tx;
    this.blocked[i] = 1;
    this.pathBlocked[i] = 1;
  }

  /** Tile (liên tục) -> toạ độ world. Tâm tile (tx,ty) là tileToWorld(tx + 0.5, ty + 0.5). */
  tileToWorld(fx: number, fy: number): Vec2 {
    const hw = this.tileWidth / 2;
    const hh = this.tileHeight / 2;
    return { x: (fx - fy) * hw + hw, y: (fx + fy) * hh };
  }

  worldToTile(wx: number, wy: number): Vec2 {
    const hw = this.tileWidth / 2;
    const hh = this.tileHeight / 2;
    const u = (wx - hw) / hw;
    const v = wy / hh;
    return { x: 0.5 * (u + v), y: 0.5 * (-u + v) };
  }

  worldBounds(margin = 128): { x: number; y: number; width: number; height: number } {
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
    const w = this.width;
    const seen = new Uint8Array(w * this.height);
    const sx = Math.min(Math.max(tx, 0), w - 1);
    const sy = Math.min(Math.max(ty, 0), this.height - 1);
    const queue: number[] = [sy * w + sx];
    seen[queue[0]] = 1;
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      if (!this.isBlocked(cx, cy)) return { x: cx, y: cy };
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= this.height) continue;
        const ni = ny * w + nx;
        if (seen[ni]) continue;
        seen[ni] = 1;
        queue.push(ni);
      }
    }
    return { x: 0, y: 0 };
  }

  /** BFS 8 hướng, không cắt góc. Trả về danh sách tile cần đi qua (không gồm tile xuất phát). */
  findPath(sx: number, sy: number, gx: number, gy: number): Vec2[] | null {
    if (this.isBlocked(gx, gy)) return null;
    if (sx === gx && sy === gy) return [];
    const w = this.width;
    const prev = new Int32Array(w * this.height).fill(-1);
    const start = sy * w + sx;
    const goal = gy * w + gx;
    prev[start] = start;
    const queue: number[] = [start];
    for (let head = 0; head < queue.length && prev[goal] === -1; head++) {
      const cur = queue[head];
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (this.isBlocked(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (this.isBlocked(cx + dx, cy) || this.isBlocked(cx, cy + dy))) continue;
        const ni = ny * w + nx;
        if (prev[ni] !== -1) continue;
        prev[ni] = cur;
        queue.push(ni);
      }
    }
    if (prev[goal] === -1) return null;
    const path: Vec2[] = [];
    for (let c = goal; c !== start; c = prev[c]) path.push({ x: c % w, y: Math.floor(c / w) });
    return path.reverse();
  }

  private findSpawn(map: TiledMap): Vec2 {
    for (const layer of map.layers) {
      if (layer.type !== 'objectgroup') continue;
      for (const obj of layer.objects ?? []) {
        const tag = (obj.name || obj.class || obj.type || '').toLowerCase();
        if (tag !== 'spawn') continue;
        // Với map isometric, toạ độ object của Tiled dùng đơn vị 1 tile = tileheight.
        const tx = Math.floor(obj.x / this.tileHeight);
        const ty = Math.floor(obj.y / this.tileHeight);
        return this.nearestFree(tx, ty);
      }
    }
    return this.nearestFree(Math.floor(this.width / 2), Math.floor(this.height / 2));
  }
}
