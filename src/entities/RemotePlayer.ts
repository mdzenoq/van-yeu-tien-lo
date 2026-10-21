import Phaser from 'phaser';
import { SPRITE_EVOLUTIONS } from '../config';
import { Nameplate } from './Nameplate';
import type { MapModel } from '../map/MapModel';
import type { NetworkPlayer } from '../types/pvp';

const DIRECTIONS = ['W', 'WD', 'D', 'SD', 'S', 'SA', 'A', 'AW'] as const;

export class RemotePlayer {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly nameplate: Nameplate;
  private currentAnimation = '';

  constructor(scene: Phaser.Scene, model: MapModel, player: NetworkPlayer) {
    const form = SPRITE_EVOLUTIONS[player.evolution];
    const point = model.tileToWorld(player.x, player.y);
    const unit = model.tileWidth / 64;
    this.sprite = scene.add
      .sprite(point.x, point.y, form.key, player.direction * form.framesPerDirection)
      .setOrigin(0.5)
      .setScale(unit * 0.7);
    this.nameplate = new Nameplate(scene);
    this.sync(model, player);
  }

  sync(model: MapModel, player: NetworkPlayer): void {
    const form = SPRITE_EVOLUTIONS[player.evolution];
    const point = model.tileToWorld(player.x, player.y);
    const animation = `${player.evolution}-${DIRECTIONS[player.direction]}`;
    this.sprite
      .setPosition(point.x, point.y)
      .setDepth(player.x + player.y + 0.01)
      .clearTint();
    if (this.sprite.texture.key !== form.key) {
      this.sprite.setTexture(form.key, player.direction * form.framesPerDirection);
      this.currentAnimation = '';
    }
    if (this.currentAnimation !== animation || !this.sprite.anims.isPlaying) {
      this.sprite.play(animation);
      this.currentAnimation = animation;
    }
    this.nameplate.sync(
      model,
      player.x,
      player.y,
      player.name,
      player.pk ? '#ff5555' : '#63c5ff',
      player.hp,
      player.maxHp,
      player.x + player.y + 0.01
    );
  }

  destroy(): void {
    this.sprite.destroy();
    this.nameplate.destroy();
  }
}