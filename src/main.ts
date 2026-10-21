import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { CURSOR } from './config';

if (!__DEBUG__) {
  window.addEventListener(
    'contextmenu',
    (event) => {
      event.preventDefault();
    },
    true
  );
  window.addEventListener(
    'keydown',
    (event) => {
      const key = event.key.toLowerCase();
      const devToolsShortcut =
        key === 'f12' ||
        (event.ctrlKey && event.shiftKey && ['i', 'j', 'c', 'k'].includes(key)) ||
        (event.metaKey && event.altKey && ['i', 'j', 'c'].includes(key)) ||
        ((event.ctrlKey || event.metaKey) && key === 'u');
      if (devToolsShortcut) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true
  );
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#1b2430',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [BootScene, GameScene, UIScene]
});

game.events.once(Phaser.Core.Events.READY, () => {
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * CURSOR.scale);
    canvas.height = Math.round(image.height * CURSOR.scale);
    const context = canvas.getContext('2d');
    if (!context) {
      console.error('[Cursor] Không thể tạo canvas để thu nhỏ con trỏ.');
      return;
    }
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const cursor = `url("${canvas.toDataURL('image/png')}") ${Math.round(CURSOR.hotspotX * CURSOR.scale)} ${Math.round(CURSOR.hotspotY * CURSOR.scale)}, auto`;
    game.input.setDefaultCursor(cursor);
  };
  image.onerror = () => console.error(`[Cursor] Không tải được ảnh con trỏ: ${CURSOR.url}`);
  image.src = `${import.meta.env.BASE_URL}${CURSOR.url}`;
});
