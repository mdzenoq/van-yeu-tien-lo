import Phaser from 'phaser';
import { MAP_STREAM_RADIUS, SPRITE_EVOLUTIONS } from '../config';
import { AccountScreen } from '../ui/AccountScreen';
import { NEXT_CHARACTER_EVOLUTION, type CharacterEvolution, type PlayerCharacter } from '../types/accounts';
import type { CharacterStats, DuelView, ServerPvPMessage } from '../types/pvp';

/** HUD chạy song song với GameScene, có camera riêng nên không bị ảnh hưởng bởi zoom. */
export class UIScene extends Phaser.Scene {
  private contextMenuObjects: Phaser.GameObjects.GameObject[] = [];
  private evolutionObjects: Phaser.GameObjects.GameObject[] = [];
  private challengeObjects: Phaser.GameObjects.GameObject[] = [];
  private activeDuel?: DuelView;
  private duelText?: Phaser.GameObjects.Text;

  constructor() {
    super('UI');
  }

  create(): void {
    this.contextMenuObjects = [];
    this.evolutionObjects = [];
    this.challengeObjects = [];
    this.activeDuel = undefined;
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
    let isInDuel = false;
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
    const statsText = this.add
      .text(10, 190, '', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffffff',
        backgroundColor: '#000000cc',
        padding: { x: 8, y: 6 }
      })
      .setDepth(1)
      .setVisible(false);
    this.duelText = this.add
      .text(10, 228, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffffff',
        backgroundColor: '#651f2b',
        padding: { x: 8, y: 6 }
      })
      .setDepth(1)
      .setVisible(false);
    const noticeText = this.add
      .text(10, 268, '', {
        fontFamily: 'sans-serif',
        fontSize: '14px',
        color: '#ffe28a',
        backgroundColor: '#000000cc',
        padding: { x: 8, y: 6 }
      })
      .setDepth(1)
      .setVisible(false);
    this.evolutionObjects.push(characterText, evolveButton, evolutionMessage, statsText, this.duelText, noticeText);
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
      if (next && !evolving && !isInDuel) evolveButton.setInteractive();
      evolutionMessage.setVisible(!!evolutionMessage.text);
    };
    const accountScreen = new AccountScreen((character, username) => {
      activeCharacter = character;
      activeUsername = username;
      evolutionMessage.setText('').setVisible(false);
      refreshEvolutionUi();
      game.events.emit('enter-game', { character, username });
    });
    const evolveCharacter = async (): Promise<void> => {
      const character = activeCharacter;
      const next = character ? NEXT_CHARACTER_EVOLUTION[character.evolution] : undefined;
      if (!character || !next || evolving || isInDuel) return;
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
        game.events.emit('enter-game', { character: result.character, username: activeUsername });
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
    const onShowCharacterMenu = (position: { x: number; y: number; targetId: string; targetName: string }): void => {
      this.showCharacterMenu(position.x, position.y, position.targetId, position.targetName, game);
    };
    const onHideCharacterMenu = (): void => this.hideCharacterMenu();
    const onStats = (stats: CharacterStats): void => {
      statsText
        .setText(`HP ${stats.maxHp}  |  Công ${stats.attack}  |  Thủ ${stats.defense}  |  Xuyên giáp ${stats.armorPen}`)
        .setVisible(true);
    };
    const onIncomingChallenge = (message: Extract<ServerPvPMessage, { type: 'challenge-incoming' }>): void => {
      this.showChallengePrompt(
        `${message.challenger.username} (${message.challenger.name}) mời bạn tỷ thí.`,
        [
          {
            label: 'Xác nhận',
            onClick: () => game.events.emit('respond-duel', { challengeId: message.challengeId, accept: true })
          },
          {
            label: 'Hủy',
            onClick: () => game.events.emit('respond-duel', { challengeId: message.challengeId, accept: false })
          }
        ]
      );
    };
    const onOutgoingChallenge = (message: Extract<ServerPvPMessage, { type: 'challenge-outgoing' }>): void => {
      this.showChallengePrompt(
        `Đang chờ ${message.target.username} xác nhận tỷ thí.`,
        [{
          label: 'Hủy lời mời',
          onClick: () => game.events.emit('cancel-duel', message.challengeId)
        }]
      );
    };
    const onChallengeCancelled = (message: Extract<ServerPvPMessage, { type: 'challenge-cancelled' }>): void => {
      this.hideChallengePrompt();
      noticeText.setText(message.message).setVisible(true);
    };
    const onDuelStarted = (duel: DuelView): void => {
      this.hideChallengePrompt();
      this.activeDuel = duel;
      isInDuel = true;
      noticeText.setText('Tỷ thí bắt đầu! Chuột trái: đánh thường · chuột phải: skill 2').setVisible(true);
      refreshEvolutionUi();
      this.updateDuelText();
    };
    const onDuelUpdated = (message: Extract<ServerPvPMessage, { type: 'duel-update' }>): void => {
      this.activeDuel = message.duel;
      this.updateDuelText();
      noticeText
        .setText(`${message.actorId === activeCharacter?.id ? 'Bạn' : message.duel.opponentName} gây ${message.damage} sát thương.`)
        .setVisible(true);
    };
    const onDuelEnded = (message: Extract<ServerPvPMessage, { type: 'duel-end' }>): void => {
      this.activeDuel = undefined;
      isInDuel = false;
      this.duelText?.setVisible(false);
      const result =
        message.winnerId === null
          ? message.message
          : message.winnerId === activeCharacter?.id
            ? `Bạn thắng. ${message.message}`
            : `Bạn thua. ${message.message}`;
      noticeText.setText(result).setVisible(true);
      refreshEvolutionUi();
    };
    const onPvpMessage = (message: string): void => {
      noticeText.setText(message).setVisible(true);
    };
    game.events.on('show-character-menu', onShowCharacterMenu);
    game.events.on('hide-character-menu', onHideCharacterMenu);
    game.events.on('pvp-stats', onStats);
    game.events.on('duel-challenge-incoming', onIncomingChallenge);
    game.events.on('duel-challenge-outgoing', onOutgoingChallenge);
    game.events.on('duel-challenge-cancelled', onChallengeCancelled);
    game.events.on('duel-started', onDuelStarted);
    game.events.on('duel-updated', onDuelUpdated);
    game.events.on('duel-ended', onDuelEnded);
    game.events.on('pvp-message', onPvpMessage);
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
      game.events.off('pvp-stats', onStats);
      game.events.off('duel-challenge-incoming', onIncomingChallenge);
      game.events.off('duel-challenge-outgoing', onOutgoingChallenge);
      game.events.off('duel-challenge-cancelled', onChallengeCancelled);
      game.events.off('duel-started', onDuelStarted);
      game.events.off('duel-updated', onDuelUpdated);
      game.events.off('duel-ended', onDuelEnded);
      game.events.off('pvp-message', onPvpMessage);
      accountScreen.destroy();
      this.hideCharacterMenu();
      this.hideChallengePrompt();
      this.evolutionObjects.forEach((object) => object.destroy());
      this.evolutionObjects = [];
      this.duelText = undefined;
    });
  }

  update(): void {
    if (this.activeDuel) this.updateDuelText();
  }

  private showCharacterMenu(
    pointerX: number,
    pointerY: number,
    targetId: string,
    targetName: string,
    game: Phaser.Scene
  ): void {
    this.hideCharacterMenu();
    const width = 168;
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
        if (index === 0) game.events.emit('request-duel', targetId);
        else game.events.emit('pvp-message', `Theo sau ${targetName} chưa được triển khai.`);
        this.hideCharacterMenu();
      });
      this.contextMenuObjects.push(row, text);
    });
  }

  private hideCharacterMenu(): void {
    this.contextMenuObjects.forEach((object) => object.destroy());
    this.contextMenuObjects = [];
  }

  private showChallengePrompt(
    message: string,
    actions: Array<{ label: string; onClick: () => void }>
  ): void {
    this.hideChallengePrompt();
    const width = 360;
    const height = 122;
    const x = (this.scale.width - width) / 2;
    const y = 80;
    const background = this.add
      .rectangle(x, y, width, height, 0x17212b, 0.98)
      .setOrigin(0)
      .setStrokeStyle(2, 0xd8b95e)
      .setDepth(40)
      .setScrollFactor(0);
    const text = this.add
      .text(x + 16, y + 14, message, {
        fontFamily: 'sans-serif',
        fontSize: '16px',
        color: '#ffffff',
        wordWrap: { width: width - 32 }
      })
      .setDepth(41)
      .setScrollFactor(0);
    this.challengeObjects.push(background, text);
    actions.forEach((action, index) => {
      const button = this.add
        .text(x + 16 + index * 160, y + 76, action.label, {
          fontFamily: 'sans-serif',
          fontSize: '15px',
          color: '#ffffff',
          backgroundColor: index === 0 ? '#397c63' : '#47596b',
          padding: { x: 12, y: 8 }
        })
        .setDepth(41)
        .setScrollFactor(0)
        .setInteractive();
      button.on('pointerdown', () => {
        action.onClick();
        this.hideChallengePrompt();
      });
      this.challengeObjects.push(button);
    });
  }

  private hideChallengePrompt(): void {
    this.challengeObjects.forEach((object) => object.destroy());
    this.challengeObjects = [];
  }

  private updateDuelText(): void {
    const duel = this.activeDuel;
    if (!duel || !this.duelText) return;
    const seconds = Math.max(0, Math.ceil((duel.endsAt - Date.now()) / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = String(seconds % 60).padStart(2, '0');
    this.duelText
      .setText(
        `PK ${duel.yourHp}/${duel.yourMaxHp} HP  |  ${duel.opponentName}: ${duel.opponentHp}/${duel.opponentMaxHp} HP  |  ${minutes}:${remainingSeconds}`
      )
      .setVisible(true);
  }
}
