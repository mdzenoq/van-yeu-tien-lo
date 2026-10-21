import Phaser from 'phaser';
import { SPRITE_EVOLUTIONS } from '../config';
import type { MapModel } from '../map/MapModel';

/** Quái mẫu tĩnh để kiểm tra luồng chọn mục tiêu và combat command. */
export class Monster {
  readonly id = 'sample-monster';
  readonly name = 'Quái mẫu';
  readonly sprite: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene, model: MapModel, tx: number, ty: number) {
    const unit = model.tileWidth / 64;
    const p = model.tileToWorld(tx + 0.5, ty + 0.5);
    this.sprite = scene.add
      .image(p.x, p.y, SPRITE_EVOLUTIONS.snake.key, 0)
      .setOrigin(0.5)
      .setScale(unit * 0.7)
      .setDepth(tx + ty + 1);
  }
}
