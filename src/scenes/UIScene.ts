import Phaser from 'phaser';

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
    const onHud = (line: string): void => {
      text.setText([
        'WASD / mũi tên: di chuyển  |  Click chuột: đi tới ô  |  Cuộn chuột: zoom  |  G: debug',
        line,
        `FPS: ${Math.round(this.game.loop.actualFps)}`
      ]);
    };
    game.events.on('hud', onHud);
    this.events.once('shutdown', () => game.events.off('hud', onHud));
  }
}
