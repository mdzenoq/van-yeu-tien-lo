import Phaser from 'phaser';
import { MAP_STREAM_RADIUS, SPRITE_EVOLUTIONS } from '../config';
import { AccountScreen } from '../ui/AccountScreen';
import { NEXT_CHARACTER_EVOLUTION, type CharacterEvolution, type PlayerCharacter } from '../types/accounts';

/** HUD chạy song song với GameScene, có camera riêng nên không bị ảnh hưởng bởi zoom. */
export class UIScene extends Phaser.Scene {
  private contextMenuObjects: Phaser.GameObjects.GameObject[] = [];
  private evolutionObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('UI');
  }

  create(): void {
    this.contextMenuObjects = [];
    this.evolutionObjects = [];
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
    let activeUsername = '';
    let activeCharacter: PlayerCharacter | undefined;
    let evolving = false;
    const evolutionLabel = (evolution: CharacterEvolution): string => {
      return SPRITE_EVOLUTIONS[evolution].label;
    };
    const characterText = this.add
      .text(10, 68, '', {
        fontFamily: 'sans-serif',
        fontSize: '15px',
        color: '#ffffff',
        backgroundColor: '#000000cc',
        padding: { x: 10, y: 8 }
      })
      .setDepth(1)
      .setVisible(false);
    const evolveButton = this.add
      .text(10, 108, '', {
        fontFamily: 'sans-serif',
        fontSize: '15px',
        color: '#ffffff',
        backgroundColor: '#397c63',
        padding: { x: 10, y: 8 }
      })
      .setDepth(1)
      .setInteractive()
      .setVisible(false);
    const evolutionMessage = this.add
      .text(10, 150, '', {
        fontFamily: 'sans-serif',
        fontSize: '14px',
        color: '#ff9b9b',
        backgroundColor: '#000000cc',
        padding: { x: 8, y: 6 }
      })
      .setDepth(1)
      .setVisible(false);
    this.evolutionObjects.push(characterText, evolveButton, evolutionMessage);
    const refreshEvolutionUi = (): void => {
      const character = activeCharacter;
      if (!character) {
        characterText.setVisible(false);
        evolveButton.setVisible(false);
        evolutionMessage.setVisible(false);
        return;
      }
      characterText
        .setText(`${character.name} · Gốc: ${evolutionLabel(character.baseSpecies)} · Hiện tại: ${evolutionLabel(character.evolution)}`)
        .setVisible(true);
      const next = NEXT_CHARACTER_EVOLUTION[character.evolution];
      evolveButton
        .setText(next ? `Tiến hóa thành ${evolutionLabel(next)} (không thể đổi)` : 'Đã đạt tiến hóa cao nhất')
        .setStyle({ backgroundColor: next ? '#397c63' : '#596675' })
        .setVisible(true)
        .disableInteractive();
      if (next && !evolving) evolveButton.setInteractive();
      evolutionMessage.setVisible(!!evolutionMessage.text);
    };
    const accountScreen = new AccountScreen((character, username) => {
      activeCharacter = character;
      activeUsername = username;
      evolutionMessage.setText('').setVisible(false);
      refreshEvolutionUi();
      game.events.emit('enter-game', character);
    });
    const evolveCharacter = async (): Promise<void> => {
      const character = activeCharacter;
      const next = character ? NEXT_CHARACTER_EVOLUTION[character.evolution] : undefined;
      if (!character || !next || evolving) return;
      if (!window.confirm(`Tiến hóa ${character.name} thành ${evolutionLabel(next)}? Không thể đổi hoặc quay lại.`)) {
        return;
      }
      evolving = true;
      evolutionMessage.setText('').setVisible(false);
      refreshEvolutionUi();
      try {
        const response = await fetch('/api/characters/evolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: activeUsername,
            characterId: character.id,
            currentEvolution: character.evolution
          })
        });
        const result = (await response.json()) as { character?: PlayerCharacter; error?: string };
        if (!response.ok || !result.character) {
          throw new Error(result.error || `Không thể tiến hóa (${response.status}).`);
        }
        activeCharacter = result.character;
        game.events.emit('enter-game', result.character);
      } catch (error) {
        evolutionMessage
          .setText(error instanceof Error ? error.message : String(error))
          .setVisible(true);
      } finally {
        evolving = false;
        refreshEvolutionUi();
      }
    };
    evolveButton.on('pointerdown', () => void evolveCharacter());
    const onShowCharacterMenu = (position: { x: number; y: number }): void => {
      this.showCharacterMenu(position.x, position.y);
    };
    const onHideCharacterMenu = (): void => this.hideCharacterMenu();
    game.events.on('show-character-menu', onShowCharacterMenu);
    game.events.on('hide-character-menu', onHideCharacterMenu);
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
      game.events.off('show-character-menu', onShowCharacterMenu);
      game.events.off('hide-character-menu', onHideCharacterMenu);
      accountScreen.destroy();
      this.hideCharacterMenu();
      this.evolutionObjects.forEach((object) => object.destroy());
      this.evolutionObjects = [];
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
