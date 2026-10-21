import Phaser from 'phaser';
import { GAME, type CharacterDef } from '../config';
import type { MapModel, Vec2 } from '../map/MapModel';

export class Player {
  readonly sprite: Phaser.GameObjects.Image;
  fx: number;
  fy: number;

  private path: Vec2[] = [];
  private facingLeft = false;
  // private walkTime = 0;
  /** Hệ số theo cỡ tile (tile 64px = 1) để sprite/tốc độ tự co giãn theo map. */
  private readonly unit: number;

  constructor(scene: Phaser.Scene, private readonly model: MapModel, tx: number, ty: number, character: CharacterDef) {
    this.unit = model.tileWidth / 64;
    this.fx = tx + 0.5;
    this.fy = ty + 0.5;
    this.sprite = scene.add
      .image(0, 0, character.key)
      .setOrigin(character.originX, character.originY)
      .setScale(this.unit * character.scaleX, this.unit * character.scaleY);
    this.syncSprite();
  }

  get tile(): Vec2 {
    return { x: Math.floor(this.fx), y: Math.floor(this.fy) };
  }

  setPath(path: Vec2[]): void {
    this.path = path;
  }

  /** dir: hướng theo MÀN HÌNH (x: -1/0/1, y: -1/0/1). Trả về true nếu đang di chuyển. */
  update(deltaMs: number, dir: Vec2): boolean {
    const step = (GAME.SPEED_PX * this.unit * deltaMs) / 1000;
    let moving = false;

    if (dir.x !== 0 || dir.y !== 0) {
      this.path = [];
      // Trục dọc của màn hình isometric bị nén một nửa -> chuẩn hoá theo (x, y/2).
      const len = Math.hypot(dir.x, dir.y * 0.5);
      const wx = (dir.x / len) * step;
      const wy = ((dir.y * 0.5) / len) * step;
      this.moveWorld(wx, wy);
      if (wx !== 0) this.facingLeft = wx < 0;
      moving = true;
    } else if (this.path.length > 0) {
      const target = this.path[0];
      const cx = target.x + 0.5;
      const cy = target.y + 0.5;
      const dfx = cx - this.fx;
      const dfy = cy - this.fy;
      const hw = this.model.tileWidth / 2;
      const hh = this.model.tileHeight / 2;
      const wx = (dfx - dfy) * hw;
      const wy = (dfx + dfy) * hh;
      const dist = Math.hypot(wx, wy);
      if (dist <= step) {
        this.fx = cx;
        this.fy = cy;
        this.path.shift();
      } else {
        const k = step / dist;
        this.fx += dfx * k;
        this.fy += dfy * k;
      }
      if (wx !== 0) this.facingLeft = wx < 0;
      moving = true;
    }

    // this.walkTime = moving ? this.walkTime + deltaMs : 0;
    this.syncSprite();
    return moving;
  }

  /** Dịch chuyển theo vector world (pixel) -> đổi sang delta tile, tách trục để trượt dọc tường. */
  private moveWorld(wdx: number, wdy: number): void {
    const dfx = wdx / this.model.tileWidth + wdy / this.model.tileHeight;
    const dfy = wdy / this.model.tileHeight - wdx / this.model.tileWidth;
    const nx = this.fx + dfx;
    if (!this.blockedAt(nx, this.fy)) this.fx = nx;
    const ny = this.fy + dfy;
    if (!this.blockedAt(this.fx, ny)) this.fy = ny;
  }

  private blockedAt(fx: number, fy: number): boolean {
    const r = GAME.PLAYER_RADIUS;
    const m = this.model;
    return (
      m.isBlockedAt(fx - r, fy - r) ||
      m.isBlockedAt(fx + r, fy - r) ||
      m.isBlockedAt(fx - r, fy + r) ||
      m.isBlockedAt(fx + r, fy + r)
    );
  }

  private syncSprite(): void {
    const p = this.model.tileToWorld(this.fx, this.fy);
    this.sprite.setPosition(p.x, p.y);
    this.sprite.setFlipX(this.facingLeft);
    // Cùng thang depth với tile "sorted": tx + ty + 1 là tâm tile.
    this.sprite.setDepth(this.fx + this.fy);
  }
}
