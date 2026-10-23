import Phaser from 'phaser';
import { SPRITE_EVOLUTIONS } from '../config';
import { Nameplate } from './Nameplate';
import type { MapModel } from '../map/MapModel';
import type { NetworkPlayer } from '../types/pvp';

const DIRECTIONS = ['W', 'WD', 'D', 'SD', 'S', 'SA', 'A', 'AW'] as const;
const INTERPOLATION_DELAY_MS = 100;

interface RemoteSnapshot {
  receivedAt: number;
  player: NetworkPlayer;
}

export class RemotePlayer {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly nameplate: Nameplate;
  private currentAnimation = '';
  private readonly snapshots: RemoteSnapshot[] = [];

  constructor(scene: Phaser.Scene, model: MapModel, player: NetworkPlayer) {
    const form = SPRITE_EVOLUTIONS[player.evolution];
    const point = model.tileToWorld(player.x, player.y);
    const unit = model.tileWidth / 64;
    this.sprite = scene.add
      .sprite(point.x, point.y, form.key, player.direction * form.framesPerDirection)
      .setOrigin(0.5)
      .setScale(unit * 0.7);
    this.nameplate = new Nameplate(scene);
    this.sync(player);
  }

  sync(player: NetworkPlayer): void {
    this.snapshots.push({ receivedAt: performance.now(), player });
    if (this.snapshots.length > 8) this.snapshots.shift();
    this.updateAnimation(player);
  }

  setChatMessage(message: string): void {
    this.nameplate.setChatMessage(message);
  }

  update(model: MapModel, now = performance.now()): void {
    const renderAt = now - INTERPOLATION_DELAY_MS;
    while (this.snapshots.length > 2 && this.snapshots[1].receivedAt <= renderAt) {
      this.snapshots.shift();
    }
    const from = this.snapshots[0];
    if (!from) return;
    const to = this.snapshots[1] ?? from;
    const duration = to.receivedAt - from.receivedAt;
    const progress = duration > 0
      ? Phaser.Math.Clamp((renderAt - from.receivedAt) / duration, 0, 1)
      : 1;
    const x = Phaser.Math.Linear(from.player.x, to.player.x, progress);
    const y = Phaser.Math.Linear(from.player.y, to.player.y, progress);
    const player = progress < 0.5 ? from.player : to.player;
    const point = model.tileToWorld(x, y);
    this.sprite
      .setPosition(point.x, point.y)
      .setDepth(model.depthAt(x, y) + 0.01)
      .clearTint();
    this.nameplate.sync(
      model,
      x,
      y,
      player.name,
      player.pk ? '#ff5555' : '#ffffff',
      player.hp,
      player.maxHp,
      model.depthAt(x, y) + 0.01
    );
  }

  private updateAnimation(player: NetworkPlayer): void {
    const form = SPRITE_EVOLUTIONS[player.evolution];
    const animation = `${player.evolution}-${DIRECTIONS[player.direction]}`;
    if (this.sprite.texture.key !== form.key) {
      this.sprite.setTexture(form.key, player.direction * form.framesPerDirection);
      this.currentAnimation = '';
    }
    if (this.currentAnimation !== animation || !this.sprite.anims.isPlaying) {
      const progress = this.currentAnimation !== animation && this.sprite.anims.isPlaying
        ? this.sprite.anims.getProgress()
        : 0;
      const startFrame = Math.min(
        form.framesPerDirection - 1,
        Math.floor(progress * form.framesPerDirection)
      );
      this.sprite.anims.play({ key: animation, startFrame }, false);
      this.currentAnimation = animation;
    }
  }

  destroy(): void {
    this.sprite.destroy();
    this.nameplate.destroy();
  }
}