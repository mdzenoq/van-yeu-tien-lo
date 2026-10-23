import Phaser from 'phaser';
import {
  MAP_STREAM_HEIGHT_TILES,
  MAP_STREAM_WIDTH_TILES,
  MINIMAP_ZOOM_SCALE,
  SPRITE_EVOLUTIONS
} from '../config';
import { NEXT_CHARACTER_EVOLUTION, type CharacterEvolution, type PlayerCharacter } from '../types/accounts';
import type { CharacterStats, ChatMessage, DuelView, ServerPvPMessage } from '../types/pvp';
import { AccountScreen } from '../ui/AccountScreen';
import { ChatPanel } from '../ui/ChatPanel';

interface MiniMapState {
  width: number;
  height: number;
  imageUrl: string;
}

interface MiniMapLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  mapX: number;
  mapY: number;
  mapWidth: number;
  mapHeight: number;
}

interface MiniMapBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface MiniMapMarkers {
  player: { x: number; y: number };
  others: Array<{ x: number; y: number; pk: boolean }>;
  npc?: { x: number; y: number };
}

/** HUD chạy song song với GameScene, có camera riêng nên không bị ảnh hưởng bởi zoom. */
export class UIScene extends Phaser.Scene {
  private contextMenuObjects: Phaser.GameObjects.GameObject[] = [];
  private evolutionObjects: Phaser.GameObjects.GameObject[] = [];
  private challengeObjects: Phaser.GameObjects.GameObject[] = [];
  private activeDuel?: DuelView;
  private duelText?: Phaser.GameObjects.Text;
  private miniMapState?: MiniMapState;
  private miniMapMarkersState?: MiniMapMarkers;
  private miniMapZoom = 1;
  private miniMapImageUrl = '';
  private miniMapSource?: HTMLImageElement | HTMLCanvasElement;
  private miniMapCanvas?: HTMLCanvasElement;
  private miniMapCanvasTexture?: Phaser.Textures.CanvasTexture;
  private miniMapImage?: Phaser.GameObjects.Image;
  private miniMapBackground?: Phaser.GameObjects.Graphics;
  private miniMapFrame?: Phaser.GameObjects.Graphics;
  private miniMapTerrain?: Phaser.GameObjects.Graphics;
  private miniMapMarkers?: Phaser.GameObjects.Graphics;
  private miniMapTitle?: Phaser.GameObjects.Text;
  private chatPanel?: ChatPanel;

  constructor() {
    super('UI');
  }

  create(): void {
    this.contextMenuObjects = [];
    this.evolutionObjects = [];
    this.challengeObjects = [];
    this.activeDuel = undefined;
    this.miniMapZoom = Phaser.Math.Clamp(MINIMAP_ZOOM_SCALE, 1, 12);
    this.miniMapImageUrl = '';
    this.miniMapSource = undefined;
    this.miniMapCanvas = undefined;
    this.miniMapCanvasTexture = undefined;
    this.miniMapImage = undefined;
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
    this.miniMapState = undefined;
    this.miniMapMarkersState = undefined;
    this.chatPanel = new ChatPanel((channel, message) => {
      game.events.emit('chat-send', { channel, text: message });
    });
    this.miniMapBackground = this.add.graphics().setDepth(9).setScrollFactor(0);
    this.miniMapFrame = this.add.graphics().setDepth(12).setScrollFactor(0);
    this.miniMapTerrain = this.add.graphics().setDepth(11).setScrollFactor(0);
    this.miniMapMarkers = this.add.graphics().setDepth(13).setScrollFactor(0);
    this.miniMapTitle = this.add
      .text(0, 0, 'BẢN ĐỒ', {
        fontFamily: 'sans-serif',
        fontSize: '11px',
        color: '#d7e8f2'
      })
      .setDepth(14)
      .setScrollFactor(0);
    const onMiniMapState = (state: MiniMapState): void => {
      this.miniMapState = state;
      this.loadMiniMapImage(state.imageUrl);
      this.drawMiniMap();
    };
    const onMiniMapMarkers = (markers: MiniMapMarkers): void => {
      this.miniMapMarkersState = markers;
      this.drawMiniMapMarkers();
    };
    const onMiniMapPointerDown = (pointer: Phaser.Input.Pointer): void => {
      const layout = this.miniMapLayout();
      const state = this.miniMapState;
      if (!layout || !state) return;
      const bounds = this.miniMapBounds(state);
      if (!this.isInsideMiniMap(pointer.x, pointer.y, layout) || !pointer.leftButtonDown()) return;
      const previewX = bounds.left + ((pointer.x - layout.mapX) / layout.mapWidth) * bounds.width;
      const previewY = bounds.top + ((pointer.y - layout.mapY) / layout.mapHeight) * bounds.height;
      if (previewX < 0 || previewY < 0 || previewX >= state.width || previewY >= state.height) return;
      game.events.emit('minimap-move', { x: previewX, y: previewY });
    };
    const onMiniMapWheel = (
      pointer: Phaser.Input.Pointer,
      _objects: unknown,
      _dx: number,
      dy: number
    ): void => {
      const layout = this.miniMapLayout();
      if (!layout || !this.isInsideMiniMap(pointer.x, pointer.y, layout)) return;
      this.miniMapZoom = Phaser.Math.Clamp(this.miniMapZoom * (dy > 0 ? 0.8 : 1.25), 1, 12);
      this.drawMiniMap();
    };
    game.events.on('minimap-map', onMiniMapState);
    game.events.on('minimap-markers', onMiniMapMarkers);
    this.input.on('pointerdown', onMiniMapPointerDown);
    this.input.on('wheel', onMiniMapWheel);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.drawMiniMap, this);
    game.events.emit('minimap-request');
    this.events.once('shutdown', () => {
      game.events.off('minimap-map', onMiniMapState);
      game.events.off('minimap-markers', onMiniMapMarkers);
      this.input.off('pointerdown', onMiniMapPointerDown);
      this.input.off('wheel', onMiniMapWheel);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.drawMiniMap, this);
      this.miniMapBackground?.destroy();
      this.miniMapFrame?.destroy();
      this.miniMapTerrain?.destroy();
      this.miniMapMarkers?.destroy();
      this.miniMapTitle?.destroy();
      this.miniMapImage?.destroy();
    });
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
      this.chatPanel?.show();
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
    const onChatMessage = (message: ChatMessage): void => {
      this.chatPanel?.addMessage(message);
    };
    const onChatStatus = (connected: boolean): void => this.chatPanel?.setConnected(connected);
    const onChatError = (message: string): void => this.chatPanel?.setError(message);
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
    game.events.on('chat-message', onChatMessage);
    game.events.on('chat-status', onChatStatus);
    game.events.on('chat-error', onChatError);
    const onHud = (line: string): void => {
      text.setText([
        `WASD / mũi tên: đi | Trái: chọn/đánh/đi | Phải: menu/dừng/skill 2 | Zoom: cuộn | G: debug`,
        `Click map để đi trong vùng ${MAP_STREAM_WIDTH_TILES}×${MAP_STREAM_HEIGHT_TILES}; giữ chuột trái để đổi đích`,
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
      game.events.off('chat-message', onChatMessage);
      game.events.off('chat-status', onChatStatus);
      game.events.off('chat-error', onChatError);
      accountScreen.destroy();
      this.chatPanel?.destroy();
      this.chatPanel = undefined;
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

  private miniMapLayout(): MiniMapLayout | undefined {
    const state = this.miniMapState;
    if (!state || state.width < 1 || state.height < 1) return undefined;
    const size = Math.min(240, this.scale.width * 0.36, this.scale.height * 0.45);
    const width = size;
    const height = size;
    const x = this.scale.width - width;
    const y = 0;
    const mapX = x + 8;
    const mapY = y + 26;
    const mapWidth = width - 16;
    const mapHeight = height - 34;
    return {
      x,
      y,
      width,
      height,
      mapX,
      mapY,
      mapWidth,
      mapHeight
    };
  }

  private drawMiniMap(): void {
    const state = this.miniMapState;
    const layout = this.miniMapLayout();
    const background = this.miniMapBackground;
    const frame = this.miniMapFrame;
    const terrain = this.miniMapTerrain;
    if (!state || !layout || !background || !frame || !terrain) return;

    background.clear();
    background.fillStyle(0x07111c, 0.9).fillRoundedRect(layout.x, layout.y, layout.width, layout.height, 6);
    frame.clear();
    this.miniMapTitle?.setPosition(layout.x + 8, layout.y + 6);

    terrain.clear();
    const bounds = this.miniMapBounds(state);
    if (this.miniMapSource && this.miniMapCanvas && this.miniMapCanvasTexture && this.miniMapImage) {
      const canvas = this.miniMapCanvas;
      canvas.width = Math.max(1, Math.round(layout.mapWidth * 2));
      canvas.height = Math.max(1, Math.round(layout.mapHeight * 2));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Không thể tạo canvas để vẽ mini-map.');
      context.drawImage(
        this.miniMapSource,
        this.miniMapSource.width * bounds.left / state.width,
        this.miniMapSource.height * bounds.top / state.height,
        this.miniMapSource.width * bounds.width / state.width,
        this.miniMapSource.height * bounds.height / state.height,
        0,
        0,
        canvas.width,
        canvas.height
      );
      this.miniMapCanvasTexture.refresh();
      this.miniMapImage
        .setPosition(layout.mapX, layout.mapY)
        .setDisplaySize(layout.mapWidth, layout.mapHeight);
    } else {
      terrain.fillStyle(0x172a32, 1).fillRect(layout.mapX, layout.mapY, layout.mapWidth, layout.mapHeight);
    }
    frame.lineStyle(1, 0xa8c6d8, 0.8).strokeRoundedRect(layout.x, layout.y, layout.width, layout.height, 6);
    frame.lineStyle(1, 0xc2e6ff, 0.9).strokeRect(
      layout.mapX,
      layout.mapY,
      layout.mapWidth,
      layout.mapHeight
    );
    this.drawMiniMapMarkers();
  }

  private drawMiniMapMarkers(): void {
    const state = this.miniMapState;
    const positions = this.miniMapMarkersState;
    const layout = this.miniMapLayout();
    const markers = this.miniMapMarkers;
    if (!state || !positions || !layout || !markers) return;

    markers.clear();
    const bounds = this.miniMapBounds(state);
    const cellWidth = layout.mapWidth / bounds.width;
    const cellHeight = layout.mapHeight / bounds.height;
    const radius = Math.max(2, Math.min(cellWidth, cellHeight) * 0.7);
    const drawDot = (x: number, y: number, color: number): void => {
      if (x < bounds.left || y < bounds.top || x >= bounds.left + bounds.width || y >= bounds.top + bounds.height) {
        return;
      }
      const markerX = layout.mapX + (x - bounds.left) * cellWidth;
      const markerY = layout.mapY + (y - bounds.top) * cellHeight;
      const clippedRadius = Math.min(
        radius,
        markerX - layout.mapX,
        layout.mapX + layout.mapWidth - markerX,
        markerY - layout.mapY,
        layout.mapY + layout.mapHeight - markerY
      );
      if (clippedRadius > 0) markers.fillStyle(color, 1).fillCircle(markerX, markerY, clippedRadius);
    };
    for (const other of positions.others) drawDot(other.x, other.y, other.pk ? 0xff3333 : 0xffffff);
    if (positions.npc) drawDot(positions.npc.x, positions.npc.y, 0xffd43b);
    drawDot(positions.player.x, positions.player.y, 0x168bff);
  }

  private miniMapBounds(state: MiniMapState): MiniMapBounds {
    const width = Math.min(state.width, state.width / this.miniMapZoom);
    const height = Math.min(state.height, state.height / this.miniMapZoom);
    const centerX = this.miniMapMarkersState?.player.x ?? state.width / 2;
    const centerY = this.miniMapMarkersState?.player.y ?? state.height / 2;
    return {
      left: Phaser.Math.Clamp(centerX - width / 2, 0, state.width - width),
      top: Phaser.Math.Clamp(centerY - height / 2, 0, state.height - height),
      width,
      height
    };
  }

  private loadMiniMapImage(url: string): void {
    const key = 'minimap-map-image';
    if (url === this.miniMapImageUrl && this.textures.exists(key)) return;
    if (url === this.miniMapImageUrl) return;
    this.miniMapImageUrl = url;
    if (this.textures.exists(key)) this.textures.remove(key);
    this.load.image(key, url);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (!this.textures.exists(key)) {
        console.error(`[MiniMap] PNG mini-map không được nạp: ${url}`);
        return;
      }
      this.miniMapSource = this.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
      const canvasKey = 'minimap-map-canvas';
      if (this.textures.exists(canvasKey)) this.textures.remove(canvasKey);
      this.miniMapCanvas = document.createElement('canvas');
      this.miniMapCanvas.width = 1;
      this.miniMapCanvas.height = 1;
      const canvasTexture = this.textures.addCanvas(canvasKey, this.miniMapCanvas);
      if (!canvasTexture) throw new Error('Không thể khởi tạo texture canvas cho mini-map.');
      this.miniMapCanvasTexture = canvasTexture;
      this.miniMapImage?.destroy();
      this.miniMapImage = this.add
        .image(0, 0, canvasKey)
        .setOrigin(0)
        .setDepth(10)
        .setScrollFactor(0);
      this.drawMiniMap();
    });
    this.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      if (file.key === key) console.error(`[MiniMap] Không tải được PNG mini-map: ${file.src}`);
    });
    this.load.start();
  }

  private isInsideMiniMap(x: number, y: number, layout: MiniMapLayout): boolean {
    return (
      x >= layout.mapX &&
      x <= layout.mapX + layout.mapWidth &&
      y >= layout.mapY &&
      y <= layout.mapY + layout.mapHeight
    );
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
