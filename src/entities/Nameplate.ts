import Phaser from 'phaser';
import type { MapModel } from '../map/MapModel';

export class Nameplate {
  private readonly label: Phaser.GameObjects.Text;
  private readonly chatLabel: Phaser.GameObjects.Text;
  private readonly healthBar: Phaser.GameObjects.Graphics;
  private lastHealthRatio = -1;
  private lastHealthWidth = 0;
  private lastName = '';
  private lastColor = '';
  private chatMessage = '';
  private chatMessageExpiresAt = 0;

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
    this.chatLabel = scene.add
      .text(0, 0, '', {
        fontFamily: 'sans-serif',
        fontSize: '14px',
        color: '#fff3a6',
        stroke: '#000000',
        strokeThickness: 3,
        resolution: 2
      })
      .setOrigin(0, 1)
      .setResolution(Math.max(2, window.devicePixelRatio * 2))
      .setVisible(false);
    this.healthBar = scene.add.graphics();
  }

  setChatMessage(message: string): void {
    this.chatMessage = message.slice(0, 120);
    this.chatMessageExpiresAt = Date.now() + 5000;
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
    if (this.chatMessage && Date.now() >= this.chatMessageExpiresAt) this.chatMessage = '';
    if (this.chatMessage) {
      this.chatLabel
        .setText(this.chatMessage)
        .setPosition(point.x + this.label.width / 2 + 5 * unit, point.y - 49 * unit)
        .setDepth(depth + 0.04)
        .setVisible(true);
    } else {
      this.chatLabel.setVisible(false);
    }
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
    this.chatLabel.destroy();
    this.healthBar.destroy();
  }
}
