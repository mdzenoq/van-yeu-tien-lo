import Phaser from 'phaser';
import type { MapModel } from '../map/MapModel';

export class Nameplate {
  private readonly label: Phaser.GameObjects.Text;
  private readonly healthBar: Phaser.GameObjects.Graphics;
  private lastHealthRatio = -1;
  private lastHealthWidth = 0;
  private lastName = '';
  private lastColor = '';

  constructor(scene: Phaser.Scene) {
    this.label = scene.add
      .text(0, 0, '', {
        fontFamily: 'SimSun, Noto Serif, serif',
        fontSize: '30px',
        color: '#0a7dc0',
        stroke: '#000000',
        strokeThickness: 5,
        shadow: {
            offsetX: 1,
            offsetY: 2,
            color: '#000000',
            blur: 2,
            fill: true
        },
        resolution: 2
      })
      .setOrigin(0.5, 1)
      .setResolution(Math.max(2, window.devicePixelRatio * 2));
    this.healthBar = scene.add.graphics();
  }

  sync(
    model: MapModel,
    x: number,
    y: number,
    name: string,
    color: string,
    hp: number,
    maxHp: number,
    depth: number
  ): void {
    const point = model.tileToWorld(x, y);
    const unit = model.tileWidth / 64;
    const barWidth = 25 * unit;
    const barHeight = 1.5 * unit;
    const healthBarGap = 0.5 * unit;
    const healthRatio = maxHp > 0 ? Phaser.Math.Clamp(hp / maxHp, 0, 1) : 0;

    if (name !== this.lastName) {
      this.label.setText(name);
      this.lastName = name;
    }
    if (color !== this.lastColor) {
      this.label.setColor(color);
      this.lastColor = color;
    }
    this.label
      .setPosition(point.x, point.y - 49 * unit)
      .setDepth(depth + 0.03);
    this.healthBar
      .setPosition(point.x, point.y - 49 * unit + healthBarGap)
      .setDepth(depth + 0.03);

    if (healthRatio !== this.lastHealthRatio || barWidth !== this.lastHealthWidth) {
      this.healthBar.clear();
      this.healthBar.fillStyle(0x808080, 0.9).fillRoundedRect(-barWidth / 2, 0, barWidth, barHeight, barHeight / 2);
      this.healthBar
        .fillStyle(0x00ff00, 1)
        .fillRoundedRect(-barWidth / 2, 0, barWidth * healthRatio, barHeight, barHeight / 2);
      this.lastHealthRatio = healthRatio;
      this.lastHealthWidth = barWidth;
    }
  }

  destroy(): void {
    this.label.destroy();
    this.healthBar.destroy();
  }
}
