import Phaser from 'phaser';
import { MAP_STREAM_RADIUS, SPRITE_SKINS, type SpriteSkinId } from '../config';

/** HUD chạy song song với GameScene, có camera riêng nên không bị ảnh hưởng bởi zoom. */
export class UIScene extends Phaser.Scene {
  constructor() {
    super('UI');
  }

  create(): void {
    const text = this.add
      .text(10, 10, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffffff',
        backgroundColor: '#000000aa',
        padding: { x: 8, y: 6 }
      })
      .setDepth(1);

    const game = this.scene.get('Game');
    const availableSkins = (Object.keys(SPRITE_SKINS) as SpriteSkinId[]).filter((skinId) =>
      this.textures.exists(SPRITE_SKINS[skinId].key)
    );
    const skinButtons = availableSkins.map((skinId, index) => {
      const label = SPRITE_SKINS[skinId].label;
      const button = this.add
        .text(10, 68 + index * 44, `Mặc skin ${label}`, {
          fontFamily: 'sans-serif',
          fontSize: '16px',
          color: '#ffffff',
          backgroundColor: '#355b49',
          padding: { x: 10, y: 8 }
        })
        .setDepth(1)
        .setInteractive();
      button.on('pointerdown', () => game.events.emit('equip-skin', skinId));
      return { skinId, button };
    });
    const onSkinChanged = (activeSkin: SpriteSkinId | null): void => {
      for (const { skinId, button } of skinButtons) {
        const equipped = activeSkin === skinId;
        button.setText(`${equipped ? 'Tháo' : 'Mặc'} skin ${SPRITE_SKINS[skinId].label}`);
        button.setStyle({ backgroundColor: equipped ? '#67424a' : '#355b49' });
      }
    };
    game.events.on('skin-changed', onSkinChanged);

    const onHud = (line: string): void => {
      const diameter = MAP_STREAM_RADIUS * 2 + 1;
      text.setText([
        `WASD / mũi tên: di chuyển  |  Click: đi tới ô trong vùng ${diameter}×${diameter}  |  Cuộn chuột: zoom  |  G: debug`,
        line,
        `FPS: ${Math.round(this.game.loop.actualFps)}`
      ]);
    };
    game.events.on('hud', onHud);
    this.events.once('shutdown', () => {
      game.events.off('hud', onHud);
      game.events.off('skin-changed', onSkinChanged);
    });
  }
}
