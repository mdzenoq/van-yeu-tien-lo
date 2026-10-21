import Phaser from 'phaser';
import { GAME, SPRITE_SKINS, type CharacterDef, type SpriteSkinId } from '../config';
import type { MapModel, Vec2 } from '../map/MapModel';

export class Player {
  readonly sprite: Phaser.GameObjects.Sprite;
  fx: number;
  fy: number;

  private path: Vec2[] = [];
  private facingLeft = false;
  private directionIndex = 4;
  private activeSkinId: SpriteSkinId | null = null;
  // private walkTime = 0;
  /** Hệ số theo cỡ tile (tile 64px = 1) để sprite/tốc độ tự co giãn theo map. */
  private readonly unit: number;

  constructor(
    scene: Phaser.Scene,
    private readonly model: MapModel,
    tx: number,
    ty: number,
    private readonly character: CharacterDef
  ) {
    this.unit = model.tileWidth / 64;
    this.fx = tx + 0.5;
    this.fy = ty + 0.5;
    this.sprite = scene.add
      .sprite(0, 0, character.key)
      .setOrigin(character.originX, character.originY)
      .setScale(this.unit * character.scaleX, this.unit * character.scaleY);
    this.syncSprite();
  }

  get currentSkin(): SpriteSkinId | null {
    return this.activeSkinId;
  }

  setSkin(skinId: SpriteSkinId | null): void {
    if (skinId === this.activeSkinId) return;
    this.activeSkinId = skinId;
    this.sprite.anims.stop();
    if (skinId) {
      const skin = SPRITE_SKINS[skinId];
      this.sprite
        .setTexture(skin.key, this.directionIndex * skin.framesPerDirection)
        .setOrigin(0.5, 0.5)
        .setScale(this.unit * 0.5);
    } else {
      this.sprite
        .setTexture(this.character.key)
        .setOrigin(this.character.originX, this.character.originY)
        .setScale(this.unit * this.character.scaleX, this.unit * this.character.scaleY)
        .setFlipX(this.facingLeft);
    }
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
      this.updateDirection(wx, wy);
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
      this.updateDirection(wx, wy);
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

    if (this.activeSkinId) this.playSkinAnimation();
    this.syncSprite();
    return moving;
  }

  private updateDirection(x: number, y: number): void {
    if (x === 0 && y === 0) return;
    const horizontal = Math.sign(x);
    const vertical = Math.sign(y);
    if (vertical < 0) this.directionIndex = horizontal > 0 ? 1 : horizontal < 0 ? 7 : 0;
    else if (vertical > 0) this.directionIndex = horizontal > 0 ? 3 : horizontal < 0 ? 5 : 4;
    else this.directionIndex = horizontal > 0 ? 2 : 6;
  }

  private playSkinAnimation(): void {
    const skinId = this.activeSkinId;
    if (!skinId) return;
    const skin = SPRITE_SKINS[skinId];
    const key = `${skinId}-${skin.directions[this.directionIndex]}`;
    if (this.sprite.anims.currentAnim?.key !== key) this.sprite.play(key);
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
    this.sprite.setFlipX(this.activeSkinId ? false : this.facingLeft);
    // Cùng thang depth với tile "sorted": tx + ty + 1 là tâm tile.
    this.sprite.setDepth(this.fx + this.fy);
  }
}
