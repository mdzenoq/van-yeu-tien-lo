import Phaser from 'phaser';
import { MAP_STREAM_RADIUS, SPRITE_SKINS, type SpriteSkinId } from '../config';

/** HUD chạy song song với GameScene, có camera riêng nên không bị ảnh hưởng bởi zoom. */
export class UIScene extends Phaser.Scene {
  private contextMenuObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('UI');
  }

  create(): void {
    this.contextMenuObjects = [];
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
    const onShowCharacterMenu = (position: { x: number; y: number }): void => {
      this.showCharacterMenu(position.x, position.y);
    };
    const onHideCharacterMenu = (): void => this.hideCharacterMenu();
    game.events.on('show-character-menu', onShowCharacterMenu);
    game.events.on('hide-character-menu', onHideCharacterMenu);
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
        `WASD / mũi tên: đi | Trái: chọn/đánh/đi | Phải: menu/dừng/skill 2 | Zoom: cuộn | G: debug`,
        `Click map để đi trong vùng ${diameter}×${diameter}; giữ chuột trái để đổi đích`,
        line,
        `FPS: ${Math.round(this.game.loop.actualFps)}`
      ]);
    };
    game.events.on('hud', onHud);
    this.events.once('shutdown', () => {
      game.events.off('hud', onHud);
      game.events.off('skin-changed', onSkinChanged);
      game.events.off('show-character-menu', onShowCharacterMenu);
      game.events.off('hide-character-menu', onHideCharacterMenu);
      this.hideCharacterMenu();
    });
  }

  private showCharacterMenu(pointerX: number, pointerY: number): void {
    this.hideCharacterMenu();
    const width = 132;
    const rowHeight = 34;
    const height = rowHeight * 2;
    const x = Phaser.Math.Clamp(pointerX, 0, Math.max(0, this.scale.width - width));
    const y = Phaser.Math.Clamp(pointerY, 0, Math.max(0, this.scale.height - height));
    const background = this.add
      .rectangle(x, y, width, height, 0x17212b, 0.96)
      .setOrigin(0)
      .setStrokeStyle(1, 0x91a4b7)
      .setDepth(20)
      .setScrollFactor(0);
    this.contextMenuObjects.push(background);

    ['Tỷ thí', 'Theo sau'].forEach((label, index) => {
      const row = this.add
        .rectangle(x, y + index * rowHeight, width, rowHeight, 0x17212b, 0)
        .setOrigin(0)
        .setDepth(21)
        .setScrollFactor(0)
        .setInteractive();
      const text = this.add
        .text(x + 12, y + index * rowHeight + 8, label, {
          fontFamily: 'sans-serif',
          fontSize: '15px',
          color: '#ffffff'
        })
        .setDepth(22)
        .setScrollFactor(0);
      row.on('pointerover', () => row.setFillStyle(0x45627a, 1));
      row.on('pointerout', () => row.setFillStyle(0x17212b, 0));
      row.on('pointerdown', (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        this.hideCharacterMenu();
      });
      this.contextMenuObjects.push(row, text);
    });
  }

  private hideCharacterMenu(): void {
    this.contextMenuObjects.forEach((object) => object.destroy());
    this.contextMenuObjects = [];
  }
}
