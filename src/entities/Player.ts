import Phaser from 'phaser';
import { GAME, SPRITE_EVOLUTIONS, type CharacterDef } from '../config';
import { Nameplate } from './Nameplate';
import type { MapModel, Vec2 } from '../map/MapModel';
import type { CharacterEvolution, PlayerCharacter } from '../types/accounts';

const DIRECTION_SECTOR = Math.PI / 4;
const DIRECTION_HYSTERESIS = Math.PI / 24;

export class Player {
  readonly sprite: Phaser.GameObjects.Sprite;
  fx: number;
  fy: number;

  private path: Vec2[] = [];
  private facingLeft = false;
  private directionIndex = 4;
  private activeEvolution: CharacterEvolution | null = null;
  private readonly nameplate: Nameplate;
  private name = '';
  private nameplateHp = 1;
  private nameplateMaxHp = 1;
  private nameplateColor = '#63c5ff';
  // private walkTime = 0;
  /** Hệ số theo cỡ tile (tile 64px = 1) để sprite/tốc độ tự co giãn theo map. */
  private readonly unit: number;

  constructor(
    scene: Phaser.Scene,
    private readonly model: MapModel,
    tx: number,
    ty: number,
    character: CharacterDef
  ) {
    this.unit = model.tileWidth / 64;
    this.fx = tx + 0.5;
    this.fy = ty + 0.5;
    this.sprite = scene.add
      .sprite(0, 0, character.key)
      .setOrigin(character.originX, character.originY)
      .setScale(this.unit * character.scaleX, this.unit * character.scaleY);
    this.nameplate = new Nameplate(scene);
    this.syncSprite();
  }

  setNameplate(name: string, hp: number, maxHp: number, color = '#63c5ff'): void {
    this.name = name;
    this.nameplateHp = hp;
    this.nameplateMaxHp = maxHp;
    this.nameplateColor = color;
    this.syncNameplate();
  }

  setEvolution(evolution: CharacterEvolution): void {
    if (evolution === this.activeEvolution) return;
    this.activeEvolution = evolution;
    this.sprite.anims.stop();
    const form = SPRITE_EVOLUTIONS[evolution];
    this.sprite
      .setTexture(form.key, this.directionIndex * form.framesPerDirection)
      .setOrigin(0.5, 0.5)
      .setScale(this.unit * 0.7)
      .setFlipX(false);
    this.playEvolutionAnimation();
  }

  setAppearance(character: CharacterDef, selectedCharacter: PlayerCharacter): void {
    this.activeEvolution = null;
    this.sprite.anims.stop();
    this.sprite
      .setTexture(character.key)
      .setOrigin(character.originX, character.originY)
      .setScale(this.unit * character.scaleX, this.unit * character.scaleY)
      .setFlipX(this.facingLeft);
    this.setEvolution(selectedCharacter.evolution);
    this.syncSprite();
  }

  get tile(): Vec2 {
    return { x: Math.floor(this.fx), y: Math.floor(this.fy) };
  }

  get direction(): number {
    return this.directionIndex;
  }

  get hasPath(): boolean {
    return this.path.length > 0;
  }

  setWorldTilePosition(x: number, y: number): void {
    this.fx = x;
    this.fy = y;
    this.syncSprite();
  }

  setPath(path: Vec2[]): void {
    this.path = path;
  }

  stopMoving(): void {
    this.path = [];
  }

  /** dir: hướng theo MÀN HÌNH (x: -1/0/1, y: -1/0/1). Trả về true nếu đang di chuyển. */
  update(deltaMs: number, dir: Vec2): boolean {
    const step = (GAME.SPEED_PX * this.unit * deltaMs) / 1000;
    let moving = false;

    if (dir.x !== 0 || dir.y !== 0) {
      this.path = [];
      const verticalScale = this.model.orientation === 'staggered' ? 1 : 0.5;
      const len = Math.hypot(dir.x, dir.y * verticalScale);
      const wx = (dir.x / len) * step;
      const wy = ((dir.y * verticalScale) / len) * step;
      this.updateDirection(wx, wy);
      this.moveWorld(wx, wy);
      if (wx !== 0) this.facingLeft = wx < 0;
      moving = true;
    } else if (this.path.length > 0) {
      const target = this.path[0];
      const cx = target.x + 0.5;
      const cy = target.y + 0.5;
      const current = this.model.tileToWorld(this.fx, this.fy);
      const destination = this.model.tileToWorld(cx, cy);
      const wx = destination.x - current.x;
      const wy = destination.y - current.y;
      const dist = Math.hypot(wx, wy);
      this.updateDirection(wx, wy);
      if (dist <= step) {
        this.fx = cx;
        this.fy = cy;
        this.path.shift();
      } else {
        this.moveWorld((wx / dist) * step, (wy / dist) * step);
      }
      if (wx !== 0) this.facingLeft = wx < 0;
      moving = true;
    }

    if (this.activeEvolution) this.playEvolutionAnimation();
    this.syncSprite();
    return moving;
  }

  private updateDirection(x: number, y: number): void {
    if (x === 0 && y === 0) return;
    const angle = (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2);
    const nextDirection = Math.round(angle / DIRECTION_SECTOR) % 8;
    let angleFromCurrent = angle - this.directionIndex * DIRECTION_SECTOR;
    if (angleFromCurrent > Math.PI) angleFromCurrent -= Math.PI * 2;
    else if (angleFromCurrent < -Math.PI) angleFromCurrent += Math.PI * 2;

    if (Math.abs(angleFromCurrent) >= DIRECTION_SECTOR / 2 + DIRECTION_HYSTERESIS) {
      this.directionIndex = nextDirection;
    }
  }

  private playEvolutionAnimation(): void {
    const evolution = this.activeEvolution;
    if (!evolution) return;
    const form = SPRITE_EVOLUTIONS[evolution];
    const key = `${evolution}-${form.directions[this.directionIndex]}`;
    if (this.sprite.anims.currentAnim?.key !== key || !this.sprite.anims.isPlaying) {
      this.sprite.play(key);
    }
  }

  /** Dịch chuyển theo vector world (pixel) -> đổi sang delta tile, tách trục để trượt dọc tường. */
  private moveWorld(wdx: number, wdy: number): void {
    const current = this.model.tileToWorld(this.fx, this.fy);
    if (this.model.orientation === 'staggered') {
      let worldX = current.x;
      let worldY = current.y;
      for (const [dx, dy] of [[wdx, 0], [0, wdy]] as const) {
        const next = this.model.worldToTile(worldX + dx, worldY + dy);
        if (this.blockedAt(next.x, next.y)) continue;
        this.fx = next.x;
        this.fy = next.y;
        worldX += dx;
        worldY += dy;
      }
      return;
    }
    const next = this.model.worldToTile(current.x + wdx, current.y + wdy);
    const dfx = next.x - this.fx;
    const dfy = next.y - this.fy;
    const nx = this.fx + dfx;
    if (!this.blockedAt(nx, this.fy)) this.fx = nx;
    const ny = this.fy + dfy;
    if (!this.blockedAt(this.fx, ny)) this.fy = ny;
  }

  private blockedAt(fx: number, fy: number): boolean {
    const r = GAME.PLAYER_RADIUS;
    const m = this.model;
    if (m.orientation === 'staggered') {
      const world = m.tileToWorld(fx, fy);
      const radiusX = r * m.tileWidth;
      const radiusY = r * m.tileHeight / 2;
      const blockedAtWorld = (x: number, y: number): boolean => {
        const tile = m.worldToTile(x, y);
        return m.isBlockedAt(tile.x, tile.y);
      };
      return (
        blockedAtWorld(world.x - radiusX, world.y - radiusY) ||
        blockedAtWorld(world.x + radiusX, world.y - radiusY) ||
        blockedAtWorld(world.x - radiusX, world.y + radiusY) ||
        blockedAtWorld(world.x + radiusX, world.y + radiusY)
      );
    }
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
    this.sprite.setFlipX(this.activeEvolution ? false : this.facingLeft);
    // Cùng thang depth với tile "sorted": tx + ty + 1 là tâm tile.
    this.sprite.setDepth(this.model.depthAt(this.fx, this.fy));
    this.syncNameplate();
  }

  private syncNameplate(): void {
    if (!this.name) return;
    this.nameplate.sync(
      this.model,
      this.fx,
      this.fy,
      this.name,
      this.nameplateColor,
      this.nameplateHp,
      this.nameplateMaxHp,
      this.model.depthAt(this.fx, this.fy)
    );
  }
}
