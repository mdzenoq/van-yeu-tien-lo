import Phaser from 'phaser';
import type { CharacterDef } from '../config';
import type { MapModel } from '../map/MapModel';

/** Nhân vật đứng yên trong map. */
export class Npc {
  readonly sprite: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene, model: MapModel, tx: number, ty: number, character: CharacterDef, facingLeft = true) {
    const unit = model.tileWidth / 64;
    const p = model.tileToWorld(tx + 0.5, ty + 0.5);
    this.sprite = scene.add
      .image(p.x, p.y, character.key)
      .setOrigin(character.originX, character.originY)
      .setScale(unit * character.scaleX, unit * character.scaleY)
      .setFlipX(facingLeft)
      .setDepth(model.depthAt(tx + 0.5, ty + 0.5));
  }
}
