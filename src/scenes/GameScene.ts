import Phaser from 'phaser';
import {
  CHARACTERS,
  CLICK_EFFECT,
  CLOUD_COVER,
  GAME,
  MAP_PREVIEW_URL,
  MAP_STREAM_BASE_URL,
  MAP_STREAM_HEIGHT_TILES,
  MAP_STREAM_WIDTH_TILES,
  SPRITE_EVOLUTIONS
} from '../config';
import { Monster } from '../entities/Monster';
import { Npc } from '../entities/Npc';
import { Player } from '../entities/Player';
import { RemotePlayer } from '../entities/RemotePlayer';
import type { ResolvedTileset } from '../loaders/tilesets';
import { ChunkManager } from '../map/ChunkManager';
import { GID_MASK, MapModel, type Vec2 } from '../map/MapModel';
import type { StreamedCell, StreamedMapManifest, StreamedObject } from '../map/StreamedMap';
import type { PlayerCharacter } from '../types/accounts';
import type {
  CharacterStats,
  ClientPvPMessage,
  DuelView,
  NetworkPlayer,
  ServerPvPMessage
} from '../types/pvp';
import { getProp } from '../types/tiled';

export class GameScene extends Phaser.Scene {
  private model!: MapModel;
  private manifest!: StreamedMapManifest;
  private player?: Player;
  private accountReady = false;
  private selectedCharacter?: PlayerCharacter;
  private activeUsername = '';
  private networkSocket?: WebSocket;
  private positionSync?: Phaser.Time.TimerEvent;
  private activeDuel?: DuelView;
  private playerStats?: CharacterStats;
  private readonly networkPlayers = new Map<string, NetworkPlayer>();
  private readonly remoteSprites = new Map<string, RemotePlayer>();
  private chunkManager!: ChunkManager;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private clickEffect?: Phaser.GameObjects.Sprite;
  private lastPointerTarget = '';
  private draggingMap = false;
  private suppressKeyboardUntilRelease = false;
  private readonly cloudSprites: Phaser.GameObjects.Image[] = [];
  private cloudCoverSignature = '';
  private npc?: Npc;
  private npcTile?: Vec2;
  private monster?: Monster;
  private monsterTile?: Vec2;
  private selectedTarget?: { id: string; name: string };
  private debugBlocked!: Phaser.GameObjects.Graphics;
  private debugCursor!: Phaser.GameObjects.Graphics;
  private debugOn = false;
  private unit = 1;
  private initialSpawn?: Vec2;
  private statusMessage = '';
  private miniMapDestination?: Vec2;
  private miniMapRouteRetryAt = 0;
  private minimapMarkerElapsed = 0;
  private hudElapsed = 250;
  private chunkCentersSignature = '';
  private readonly tileObjectsByCell = new Map<string, Phaser.GameObjects.GameObject[]>();
  private readonly objectSprites = new Map<string, Phaser.GameObjects.GameObject[]>();

  constructor() {
    super('Game');
  }

  private syncMonsterSprite(): void {
    if (!this.monsterTile) return;
    if (this.model.isTileLoaded(this.monsterTile.x, this.monsterTile.y)) {
      if (!this.monster) this.monster = new Monster(this, this.model, this.monsterTile.x, this.monsterTile.y);
    } else if (this.monster) {
      this.monster.sprite.destroy();
      this.monster = undefined;
    }
  }

  create(): void {
    this.tileObjectsByCell.clear();
    this.objectSprites.clear();
    this.player = undefined;
    this.accountReady = false;
    this.selectedCharacter = undefined;
    this.activeUsername = '';
    this.networkSocket = undefined;
    this.positionSync = undefined;
    this.activeDuel = undefined;
    this.playerStats = undefined;
    this.networkPlayers.clear();
    this.remoteSprites.clear();
    this.npc = undefined;
    this.npcTile = undefined;
    this.monster = undefined;
    this.monsterTile = undefined;
    this.selectedTarget = undefined;
    this.draggingMap = false;
    this.suppressKeyboardUntilRelease = false;
    this.initialSpawn = undefined;
    this.statusMessage = '';
    this.miniMapDestination = undefined;
    this.miniMapRouteRetryAt = 0;
    this.minimapMarkerElapsed = 0;
    this.hudElapsed = 250;
    this.chunkCentersSignature = '';
    this.lastPointerTarget = '';
    this.debugOn = false;
    this.cloudSprites.forEach((cloud) => cloud.destroy());
    this.cloudSprites.length = 0;
    this.cloudCoverSignature = '';

    this.manifest = this.registry.get('map-manifest') as StreamedMapManifest;
    const tilesets = this.registry.get('tilesets') as ResolvedTileset[];
    this.model = new MapModel(this.manifest, tilesets);
    this.unit = this.model.tileWidth / 64;

    this.createSkinAnimations();
    this.debugBlocked = this.add.graphics().setDepth(50001).setVisible(false);
    this.debugCursor = this.add.graphics().setDepth(50002).setVisible(false);
    this.chunkManager = new ChunkManager(
      `${import.meta.env.BASE_URL}${MAP_STREAM_BASE_URL}`,
      this.model.width,
      this.model.height,
      MAP_STREAM_WIDTH_TILES,
      MAP_STREAM_HEIGHT_TILES,
      (cells) => this.onRegionLoaded(cells),
      (error) => {
        console.error('[MapStream]', error);
        this.statusMessage = 'Tải vùng map thất bại; sẽ tự thử lại.';
        this.events.emit('hud', `Lỗi tải dữ liệu map: ${error.message}`);
      }
    );
    this.events.once('shutdown', () => this.chunkManager.dispose());
    const onMinimapMove = (previewPosition: Vec2): void => {
      if (!this.accountReady) return;
      const destination = this.model.previewToTile(previewPosition.x, previewPosition.y);
      this.setMiniMapDestination({ x: Math.floor(destination.x), y: Math.floor(destination.y) });
    };
    const onMinimapRequest = (): void => this.emitMiniMapMap();
    this.events.on('minimap-move', onMinimapMove);
    this.events.on('minimap-request', onMinimapRequest);
    this.events.once('shutdown', () => this.events.off('minimap-move', onMinimapMove));
    this.events.once('shutdown', () => this.events.off('minimap-request', onMinimapRequest));

    const enterGame = (selection: { character: PlayerCharacter; username: string }): void => {
      this.selectedCharacter = selection.character;
      this.activeUsername = selection.username;
      this.player?.setAppearance(CHARACTERS[selection.character.gender], selection.character);
      this.playerStats = selection.character.stats;
      this.syncLocalNameplate();
      if (this.networkSocket?.readyState === WebSocket.OPEN) {
        this.sendNetwork({ type: 'character-update', evolution: selection.character.evolution });
      } else {
        this.connectMultiplayer();
      }
    };
    this.events.on('enter-game', enterGame);
    this.events.once('shutdown', () => this.events.off('enter-game', enterGame));
    const onRequestDuel = (targetId: string): void => this.sendNetwork({ type: 'challenge', targetId });
    const onRespondDuel = (response: { challengeId: string; accept: boolean }): void =>
      this.sendNetwork({ type: 'challenge-response', ...response });
    const onCancelDuel = (challengeId: string): void =>
      this.sendNetwork({ type: 'challenge-cancel', challengeId });
    const onCombatAction = (action: 'basic-attack' | 'skill-2', targetId: string): void =>
      this.sendNetwork({ type: 'attack', action, targetId });
    const onChatSend = (message: { channel: 'current' | 'guild'; text: string }): void => {
      if (!this.accountReady) {
        this.events.emit('chat-error', 'Chat chưa kết nối.');
        return;
      }
      this.sendNetwork({ type: 'chat-send', ...message });
    };
    this.events.on('request-duel', onRequestDuel);
    this.events.on('respond-duel', onRespondDuel);
    this.events.on('cancel-duel', onCancelDuel);
    this.events.on('pvp-attack', onCombatAction);
    this.events.on('chat-send', onChatSend);
    this.events.once('shutdown', () => {
      this.events.off('request-duel', onRequestDuel);
      this.events.off('respond-duel', onRespondDuel);
      this.events.off('cancel-duel', onCancelDuel);
      this.events.off('pvp-attack', onCombatAction);
      this.events.off('chat-send', onChatSend);
      this.stopMultiplayer();
    });

    this.scene.launch('UI');
    this.events.once('shutdown', () => this.scene.stop('UI'));
    this.chunkManager.updateCenter(this.model.spawn.x, this.model.spawn.y);
  }

  private connectMultiplayer(): void {
    if (
      !this.player ||
      !this.selectedCharacter ||
      !this.activeUsername ||
      this.networkSocket?.readyState === WebSocket.CONNECTING ||
      this.networkSocket?.readyState === WebSocket.OPEN
    ) {
      return;
    }
    this.accountReady = false;
    this.events.emit('chat-status', false);
    this.statusMessage = 'Đang kết nối PvP...';
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);
    this.networkSocket = socket;
    socket.addEventListener('open', () => {
      if (this.networkSocket !== socket || !this.player || !this.selectedCharacter) return;
      this.sendNetwork({
        type: 'join',
        username: this.activeUsername,
        characterId: this.selectedCharacter.id,
        x: this.player.fx,
        y: this.player.fy,
        direction: this.player.direction
      });
    });
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      let message: ServerPvPMessage;
      try {
        message = JSON.parse(event.data) as ServerPvPMessage;
      } catch (error) {
        console.error('[PvP] Không đọc được phản hồi WebSocket.', error);
        this.statusMessage = 'Dữ liệu phản hồi PvP không hợp lệ.';
        return;
      }
      this.handleNetworkMessage(message);
    });
    socket.addEventListener('error', () => {
      this.statusMessage = 'Không thể kết nối máy chủ PvP.';
      this.events.emit('chat-error', this.statusMessage);
      this.events.emit('pvp-message', this.statusMessage);
    });
    socket.addEventListener('close', () => {
      if (this.networkSocket !== socket) return;
      this.networkSocket = undefined;
      this.events.emit('chat-status', false);
      this.positionSync?.remove();
      this.positionSync = undefined;
      this.accountReady = true;
      this.activeDuel = undefined;
      this.syncLocalNameplate();
      this.statusMessage = 'Mất kết nối PvP; đang chơi ngoại tuyến.';
      this.events.emit('duel-ended', { message: this.statusMessage, winnerId: null });
      this.events.emit('pvp-message', this.statusMessage);
      this.syncRemotePlayers([]);
    });
  }

  private stopMultiplayer(): void {
    this.positionSync?.remove();
    this.positionSync = undefined;
    const socket = this.networkSocket;
    this.networkSocket = undefined;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Scene shutdown');
    this.syncRemotePlayers([]);
  }

  private sendNetwork(message: ClientPvPMessage): void {
    if (this.networkSocket?.readyState !== WebSocket.OPEN) {
      this.statusMessage = 'Chưa kết nối máy chủ PvP.';
      this.events.emit('pvp-message', this.statusMessage);
      return;
    }
    this.networkSocket.send(JSON.stringify(message));
  }

  private handleNetworkMessage(message: ServerPvPMessage): void {
    switch (message.type) {
      case 'joined':
        this.syncRemotePlayers(message.players);
        if (this.player) {
          const position = this.findFreeNetworkPosition(message.player.x, message.player.y);
          this.player.setWorldTilePosition(position.x, position.y);
        }
        this.accountReady = true;
        this.events.emit('chat-status', true);
        this.statusMessage = '';
        this.playerStats = message.stats;
        this.syncLocalNameplate();
        this.events.emit('pvp-stats', message.stats);
        this.positionSync?.remove();
        this.positionSync = this.time.addEvent({
          delay: 1,
          loop: true,
          callback: () => {
            if (!this.player || !this.accountReady) return;
            this.sendNetwork({
              type: 'position',
              x: this.player.fx,
              y: this.player.fy,
              direction: this.player.direction
            });
          }
        });
        break;
      case 'player-updated':
        this.playerStats = message.stats;
        this.syncLocalNameplate();
        this.events.emit('pvp-stats', message.stats);
        break;
      case 'chat-message':
        if (message.message.channel === 'current') {
          const characterId = message.message.characterId;
          if (characterId === this.selectedCharacter?.id) {
            this.player?.setChatMessage(message.message.text);
          } else {
            const sender = characterId
              ? this.networkPlayers.get(characterId)
              : [...this.networkPlayers.values()].find(
                  (player) =>
                    player.username === message.message.username &&
                    player.name === message.message.characterName
                );
            const remotePlayer = sender ? this.remoteSprites.get(sender.id) : undefined;
            remotePlayer?.setChatMessage(message.message.text);
          }
        }
        this.events.emit('chat-message', message.message);
        break;
      case 'chat-error':
        this.events.emit('chat-error', message.message);
        break;
      case 'players':
        this.syncRemotePlayers(message.players);
        break;
      case 'challenge-incoming':
        this.events.emit('duel-challenge-incoming', message);
        break;
      case 'challenge-outgoing':
        this.events.emit('duel-challenge-outgoing', message);
        break;
      case 'challenge-cancelled':
        this.events.emit('duel-challenge-cancelled', message);
        break;
      case 'duel-start':
        this.activeDuel = message.duel;
        this.syncLocalNameplate();
        this.selectedTarget = { id: message.duel.opponentId, name: message.duel.opponentName };
        this.statusMessage = 'Tỷ thí bắt đầu!';
        this.events.emit('duel-started', message.duel);
        break;
      case 'duel-update':
        this.activeDuel = message.duel;
        this.syncLocalNameplate();
        this.events.emit('duel-updated', message);
        break;
      case 'duel-end':
        this.activeDuel = undefined;
        this.syncLocalNameplate();
        this.statusMessage = message.message;
        this.events.emit('duel-ended', message);
        break;
      case 'error':
        this.statusMessage = message.message;
        this.events.emit('pvp-message', message.message);
        break;
    }
  }

  private syncRemotePlayers(players: NetworkPlayer[]): void {
    const validPlayers = players.filter(
      (player) =>
        Number.isFinite(player.x) &&
        Number.isFinite(player.y) &&
        player.x >= 0 &&
        player.y >= 0 &&
        player.x < this.model.width &&
        player.y < this.model.height
    );
    const onlineIds = new Set(validPlayers.map((player) => player.id));
    for (const [id, remote] of this.remoteSprites) {
      if (onlineIds.has(id)) continue;
      remote.destroy();
      this.remoteSprites.delete(id);
      this.networkPlayers.delete(id);
    }
    for (const player of validPlayers) {
      this.networkPlayers.set(player.id, player);
      let remote = this.remoteSprites.get(player.id);
      if (!remote) {
        remote = new RemotePlayer(this, this.model, player);
        this.remoteSprites.set(player.id, remote);
      } else {
        remote.sync(player);
      }
    }
    this.events.emit('online-players', validPlayers.length);
  }

  private syncLocalNameplate(): void {
    const character = this.selectedCharacter;
    if (!character || !this.player) return;
    const stats = this.playerStats ?? character.stats;
    this.player.setNameplate(
      character.name,
      this.activeDuel?.yourHp ?? stats.maxHp,
      this.activeDuel?.yourMaxHp ?? stats.maxHp
    );
  }

  private findFreeNetworkPosition(x: number, y: number): Vec2 {
    const originX = Math.floor(x);
    const originY = Math.floor(y);
    const occupiedTiles = new Set(
      [...this.networkPlayers.values()].map((player) => `${Math.floor(player.x)},${Math.floor(player.y)}`)
    );
    for (let distance = 0; distance <= 8; distance++) {
      for (let dx = -distance; dx <= distance; dx++) {
        for (let dy = -distance; dy <= distance; dy++) {
          if (Math.abs(dx) + Math.abs(dy) !== distance) continue;
          const tx = originX + dx;
          const ty = originY + dy;
          const key = `${tx},${ty}`;
          const centerX = tx + 0.5;
          const centerY = ty + 0.5;
          const radius = GAME.PLAYER_RADIUS;
          const blocked =
            this.model.isBlockedAt(centerX - radius, centerY - radius) ||
            this.model.isBlockedAt(centerX + radius, centerY - radius) ||
            this.model.isBlockedAt(centerX - radius, centerY + radius) ||
            this.model.isBlockedAt(centerX + radius, centerY + radius);
          if (blocked || occupiedTiles.has(key)) continue;
          return { x: centerX, y: centerY };
        }
      }
    }
    return { x, y };
  }

  update(_time: number, delta: number): void {
    if (!this.player) return;
    for (const remote of this.remoteSprites.values()) remote.update(this.model);
    const direction = this.readDirection();
    const pointer = this.input.activePointer;
    if (this.accountReady && this.draggingMap && pointer.leftButtonDown()) {
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.setMoveDestination(worldPoint.x, worldPoint.y, false);
    }
    if (direction.x !== 0 || direction.y !== 0) this.miniMapDestination = undefined;
    if (this.accountReady) this.player.update(delta, direction);
    if (this.miniMapDestination && !this.player.hasPath && Date.now() >= this.miniMapRouteRetryAt) {
      this.continueMiniMapDestination();
    }

    const tile = this.player.tile;
    this.minimapMarkerElapsed += delta;
    if (this.minimapMarkerElapsed >= 50) {
      this.minimapMarkerElapsed %= 50;
      const playerPreviewPosition = this.model.tileToPreview(this.player.fx, this.player.fy);
      this.events.emit('minimap-markers', {
        player: playerPreviewPosition,
        others: [...this.networkPlayers.values()].map(({ x, y, pk }) => ({
          ...this.model.tileToPreview(x, y),
          pk
        })),
        npc: this.npcTile
          ? this.model.tileToPreview(this.npcTile.x + 0.5, this.npcTile.y + 0.5)
          : undefined
      });
    }
    const centers = [
      tile,
      ...[...this.networkPlayers.values()].map((remote) => ({
        x: Math.floor(remote.x),
        y: Math.floor(remote.y)
      }))
    ];
    const centersSignature = centers.map(({ x, y }) => `${x},${y}`).join('|');
    if (centersSignature !== this.chunkCentersSignature) {
      this.chunkCentersSignature = centersSignature;
      this.chunkManager.updateCenters(centers);
    }
    this.syncCloudCover();
    this.hudElapsed += delta;
    if (this.hudElapsed >= 250) {
      this.hudElapsed %= 250;
      const debugHint = __DEBUG__ ? `  |  Debug: ${this.debugOn ? 'ON' : 'OFF'}` : '';
      const status = this.statusMessage ? `  |  ${this.statusMessage}` : '';
      const target = this.selectedTarget ? `  |  Mục tiêu: ${this.selectedTarget.name}` : '';
      this.events.emit(
        'hud',
        `Tile: (${tile.x}, ${tile.y})  |  Zoom: ${(this.cameras.main.zoom * this.unit).toFixed(2)}${debugHint}${target}${status}`
      );
    }

    if (this.debugOn) {
      this.debugCursor.clear();
      this.diamond(this.debugCursor, tile.x, tile.y);
      this.debugCursor.lineStyle(2, 0xffe066, 1).strokePath();
    }
  }

  private onRegionLoaded(cells: StreamedCell[]): void {
    this.model.setActiveCells(cells);
    this.emitMiniMapMap();
    this.renderRegion(cells);
    this.syncNpcSprite();
    this.syncMonsterSprite();
    this.drawBlockedOverlay();
    this.cloudCoverSignature = '';
    this.syncCloudCover();
    this.statusMessage = '';

    if (!this.player) {
      try {
        const spawn = this.initialSpawn ?? this.model.nearestFree(this.model.spawn.x, this.model.spawn.y);
        this.initialSpawn = spawn;
        const center = this.chunkManager.currentCenter;
        if (!center || center.x !== spawn.x || center.y !== spawn.y) {
          this.chunkManager.updateCenter(spawn.x, spawn.y);
          return;
        }
        this.createPlayer(spawn);
      } catch (error) {
        this.statusMessage = error instanceof Error ? error.message : String(error);
        console.error('[MapStream] Không thể đặt nhân vật vào vùng map ban đầu.', error);
        this.events.emit('hud', `Không thể khởi tạo map: ${this.statusMessage}`);
      }
    }
    if (this.player && this.miniMapDestination) this.continueMiniMapDestination();
  }

  private emitMiniMapMap(): void {
    this.events.emit('minimap-map', {
      width: this.model.width,
      height: this.model.height,
      imageUrl: `${import.meta.env.BASE_URL}${MAP_PREVIEW_URL}`
    });
  }

  private createPlayer(spawn: Vec2): void {
    this.player = new Player(this, this.model, spawn.x, spawn.y, CHARACTERS.female);
    const npc = this.model.nearestFree(spawn.x + 1, spawn.y);
    if (npc.x !== spawn.x || npc.y !== spawn.y) {
      this.npcTile = npc;
      this.model.block(npc.x, npc.y);
      this.syncNpcSprite();
    }
    const monsterStarts = [
      { x: spawn.x + 2, y: spawn.y },
      { x: spawn.x + 3, y: spawn.y },
      { x: spawn.x, y: spawn.y + 2 },
      { x: spawn.x, y: spawn.y - 2 },
      { x: spawn.x - 2, y: spawn.y }
    ];
    for (const start of monsterStarts) {
      const candidate = this.model.nearestFree(start.x, start.y);
      const overlapsSpawn = candidate.x === spawn.x && candidate.y === spawn.y;
      const overlapsNpc = this.npcTile && candidate.x === this.npcTile.x && candidate.y === this.npcTile.y;
      if (overlapsSpawn || overlapsNpc) continue;
      this.monsterTile = candidate;
      this.model.block(candidate.x, candidate.y);
      this.syncMonsterSprite();
      break;
    }
    this.drawBlockedOverlay();
    this.createClickEffect();
    this.setupCamera();
    this.setupInput();
    if (this.selectedCharacter) {
      this.player.setAppearance(CHARACTERS[this.selectedCharacter.gender], this.selectedCharacter);
      this.syncLocalNameplate();
      this.connectMultiplayer();
    }
    if (this.miniMapDestination) this.continueMiniMapDestination();
  }

  private createClickEffect(): void {
    if (!this.textures.exists(CLICK_EFFECT.key)) return;
    if (!this.anims.exists(CLICK_EFFECT.key)) {
      this.anims.create({
        key: CLICK_EFFECT.key,
        frames: this.anims.generateFrameNumbers(CLICK_EFFECT.key, {
          start: 0,
          end: CLICK_EFFECT.frameCount - 1
        }),
        frameRate: 12,
        repeat: 0
      });
    }
    this.clickEffect = this.add
      .sprite(0, 0, CLICK_EFFECT.key)
      .setOrigin(0.5)
      .setScale(this.unit)
      .setDepth(0)
      .setVisible(false);
    this.clickEffect.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.clickEffect?.setVisible(false));
  }

  private syncNpcSprite(): void {
    if (!this.npcTile) return;
    if (this.model.isTileLoaded(this.npcTile.x, this.npcTile.y)) {
      if (!this.npc) this.npc = new Npc(this, this.model, this.npcTile.x, this.npcTile.y, CHARACTERS.male);
    } else if (this.npc) {
      this.npc.sprite.destroy();
      this.npc = undefined;
    }
  }

  private syncCloudCover(): void {
    if (!this.textures.exists(CLOUD_COVER.key)) return;
    const center = this.chunkManager.currentCenter;
    if (!center) return;

    const camera = this.cameras.main;
    const view = camera.worldView;
    const spacing = CLOUD_COVER.spacing;
    const minGridX = Math.floor(view.left / spacing) - 1;
    const maxGridX = Math.ceil(view.right / spacing) + 1;
    const minGridY = Math.floor(view.top / spacing) - 1;
    const maxGridY = Math.ceil(view.bottom / spacing) + 1;
    const signature = `${center.x},${center.y}:${minGridX},${maxGridX},${minGridY},${maxGridY}:${camera.zoom}`;
    if (signature === this.cloudCoverSignature) return;
    this.cloudCoverSignature = signature;
    this.textures.get(CLOUD_COVER.key).setFilter(Phaser.Textures.FilterMode.LINEAR);

    let visibleIndex = 0;
    const centerTileX = center.x + 0.5;
    const centerTileY = center.y + 0.5;
    const halfWidth = (CLOUD_COVER.clearWidthTiles - 1) / 2;
    const halfHeight = (CLOUD_COVER.clearHeightTiles - 1) / 2;
    const minTileX = centerTileX - halfWidth;
    const maxTileX = centerTileX + halfWidth;
    const minTileY = centerTileY - halfHeight;
    const maxTileY = centerTileY + halfHeight;

    for (let gridY = minGridY; gridY <= maxGridY; gridY++) {
      for (let gridX = minGridX; gridX <= maxGridX; gridX++) {
        const worldX = gridX * spacing;
        const worldY = gridY * spacing;
        const variation = Math.sin(gridX * 12.9898 + gridY * 78.233) * 43758.5453;
        const scaleVariation = variation - Math.floor(variation);
        const secondVariation = Math.sin(gridX * 39.3467 + gridY * 11.135) * 24634.6345;
        const alphaVariation = secondVariation - Math.floor(secondVariation);
        const tile = this.model.worldToTile(worldX, worldY);
        if (
          tile.x >= minTileX &&
          tile.x <= maxTileX &&
          tile.y >= minTileY &&
          tile.y <= maxTileY
        ) {
          continue;
        }

        let cloud = this.cloudSprites[visibleIndex];
        if (!cloud) {
          cloud = this.add.image(worldX, worldY, CLOUD_COVER.key).setOrigin(0.5).setDepth(40000);
          this.cloudSprites.push(cloud);
        }
        cloud
          .setPosition(worldX + (scaleVariation - 0.5) * 12, worldY + (alphaVariation - 0.5) * 12)
          .setScale(CLOUD_COVER.scale * (0.9 + scaleVariation * 0.2))
          .setAngle((alphaVariation - 0.5) * 24)
          .setAlpha(CLOUD_COVER.alpha * (0.8 + scaleVariation * 0.4))
          .setVisible(true);
        visibleIndex++;
      }
    }
    for (let i = visibleIndex; i < this.cloudSprites.length; i++) this.cloudSprites[i].setVisible(false);
  }

  private createSkinAnimations(): void {
    for (const [evolution, form] of Object.entries(SPRITE_EVOLUTIONS)) {
      form.directions.forEach((direction, row) => {
        const key = `${evolution}-${direction}`;
        if (this.anims.exists(key)) return;
        const start = row * form.framesPerDirection;
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(form.key, {
            start,
            end: start + form.framesPerDirection - 1
          }),
          frameRate: GAME.ANIMATION_FPS,
          repeat: -1
        });
      });
    }
  }

  private renderRegion(cells: readonly StreamedCell[]): void {
    const desiredCells = new Set(cells.map((cell) => this.cellKey(cell.x, cell.y)));
    for (const [key, objects] of this.tileObjectsByCell) {
      if (desiredCells.has(key)) continue;
      objects.forEach((object) => object.destroy());
      this.tileObjectsByCell.delete(key);
    }
    for (const cell of cells) {
      const key = this.cellKey(cell.x, cell.y);
      if (!this.tileObjectsByCell.has(key)) {
        this.tileObjectsByCell.set(key, this.createCellTiles(cell));
      }
    }

    const activeObjects = new Map<string, StreamedObject>();
    for (const cell of cells) {
      for (const entry of cell.objects) activeObjects.set(`${entry.layerId}:${entry.object.id}`, entry);
    }
    for (const [key, objects] of this.objectSprites) {
      if (activeObjects.has(key)) continue;
      objects.forEach((object) => object.destroy());
      this.objectSprites.delete(key);
    }
    for (const [key, entry] of activeObjects) {
      if (!this.objectSprites.has(key)) this.objectSprites.set(key, this.createMapObject(entry));
    }
  }

  private createCellTiles(cell: StreamedCell): Phaser.GameObjects.GameObject[] {
    const result: Phaser.GameObjects.GameObject[] = [];
    for (const tile of cell.tiles) {
      const layerIndex = this.manifest.layers.findIndex((layer, index) => (layer.id ?? index + 1) === tile.layerId);
      const layer = this.manifest.layers[layerIndex];
      if (!layer || layer.visible === false) continue;
      const gid = tile.gid & GID_MASK;
      const tileset = this.model.tilesetForGid(gid);
      if (!tileset) continue;
      const frame = this.ensureFrame(tileset, gid - tileset.firstgid);
      const sorted = getProp<boolean>(layer, 'sorted') === true;
      const above = getProp<boolean>(layer, 'above') === true;
      const p = this.model.tileToWorld(cell.x + 0.5, cell.y + 0.5);
      let sprite: Phaser.GameObjects.Image;
      if (sorted) {
        sprite = this.add
          .image(p.x + tileset.offsetX, p.y + this.model.tileHeight / 2 + tileset.offsetY, tileset.textureKey, frame)
          .setOrigin(0.5, 1);
        sprite.setDepth(above ? 100000 + layerIndex : this.model.depthAt(cell.x + 0.5, cell.y + 0.5) + layerIndex * 0.001);
      } else {
        sprite = this.add
          .image(p.x + tileset.offsetX, p.y + tileset.offsetY, tileset.textureKey, frame)
          .setOrigin(0.5, 0.5);
        sprite.setDepth(above ? 100000 + layerIndex : -10000 + layerIndex);
      }
      sprite.setAlpha(layer.opacity ?? 1);
      this.applyTiledGidFlags(sprite, tile.gid);
      result.push(sprite);
    }
    return result;
  }

  private createMapObject(entry: StreamedObject): Phaser.GameObjects.GameObject[] {
    const layerIndex = this.manifest.layers.findIndex(
      (layer, index) => (layer.id ?? index + 1) === entry.layerId
    );
    const layer = this.manifest.layers[layerIndex];
    const object = entry.object;
    if (!layer || layer.visible === false || object.visible === false || !object.gid) return [];
    const gid = object.gid & GID_MASK;
    const tileset = this.model.tilesetForGid(gid);
    if (!tileset) return [];
    const objectTile = this.model.orientation === 'staggered'
      ? this.model.worldToTile(object.x, object.y)
      : { x: object.x / this.model.tileHeight, y: object.y / this.model.tileHeight };
    const p = this.model.orientation === 'staggered'
      ? { x: object.x, y: object.y }
      : this.model.tileToWorld(objectTile.x, objectTile.y);
    const image = this.add
      .image(p.x + tileset.offsetX, p.y + tileset.offsetY, tileset.textureKey, this.ensureFrame(tileset, gid - tileset.firstgid))
      .setOrigin(0.5, 1)
      .setAlpha(layer.opacity ?? 1)
      .setDepth(this.model.depthAt(objectTile.x, objectTile.y) + layerIndex * 0.001);
    if (object.width && object.height) image.setDisplaySize(object.width, object.height);
    if (object.rotation) image.setAngle(object.rotation);
    this.applyTiledGidFlags(image, object.gid);
    return [image];
  }

  private applyTiledGidFlags(image: Phaser.GameObjects.Image, value: number): void {
    const gid = value >>> 0;
    image.setFlipX((gid & 0x80000000) !== 0);
    image.setFlipY((gid & 0x40000000) !== 0);
    if ((gid & 0x20000000) !== 0) image.setAngle(image.angle + 90);
  }

  private ensureFrame(tileset: ResolvedTileset, localId: number): string {
    const name = `t${localId}`;
    const texture = this.textures.get(tileset.textureKey);
    if (!texture.has(name)) {
      const col = localId % tileset.columns;
      const row = Math.floor(localId / tileset.columns);
      texture.add(
        name,
        0,
        tileset.margin + col * (tileset.tileWidth + tileset.spacing),
        tileset.margin + row * (tileset.tileHeight + tileset.spacing),
        tileset.tileWidth,
        tileset.tileHeight
      );
    }
    return name;
  }

  private setupCamera(): void {
    const camera = this.cameras.main;
    const bounds = this.model.worldBounds();
    camera.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    camera.setZoom(GAME.ZOOM / this.unit);
    camera.startFollow(this.player!.sprite, true, 0.12, 0.12);
    camera.setBackgroundColor('#1b2430');
  }

  private setupInput(): void {
    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.cursors = keyboard.createCursorKeys();
      this.wasd = keyboard.addKeys('W,A,S,D') as Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
      if (__DEBUG__) keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.G).on('down', () => this.toggleDebug());
    }

    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isMiniMapScreenPoint(pointer.x, pointer.y)) {
        this.draggingMap = false;
        return;
      }
      if (!this.accountReady) return;
      const target = this.targetAt(pointer.worldX, pointer.worldY);
      if (pointer.leftButtonDown()) {
        this.lastPointerTarget = '';
        this.draggingMap = false;
        this.events.emit('hide-character-menu');
        if (target?.kind === 'remote-player') {
          this.selectedTarget = { id: target.id, name: target.name };
          this.statusMessage = '';
          this.events.emit('target-selected', this.selectedTarget);
          if (this.activeDuel?.opponentId === target.id) {
            this.attackRemotePlayer('basic-attack', target.id, target.name);
          }

          return;
        }
        if (target?.kind === 'monster') {
          this.issueCombatCommand('basic-attack', target.id, target.name);
          return;
        }
        this.draggingMap = true;
        this.setMoveDestination(pointer.worldX, pointer.worldY, true);
        return;
      }

      if (!pointer.rightButtonDown()) return;
      this.draggingMap = false;
      this.lastPointerTarget = '';
      if (target?.kind === 'remote-player') {
        if (this.activeDuel?.opponentId === target.id) {
          this.attackRemotePlayer('skill-2', target.id, target.name);
        } else {
          this.events.emit('show-character-menu', {
            x: pointer.x,
            y: pointer.y,
            targetId: target.id,
            targetName: target.name
          });
        }
      } else if (target?.kind === 'monster') {
        this.issueCombatCommand('skill-2', target.id, target.name);
      } else {
        this.miniMapDestination = undefined;
        this.player?.stopMoving();
        this.suppressKeyboardUntilRelease = true;
        this.statusMessage = 'Đã dừng di chuyển.';
        this.events.emit('hide-character-menu');
      }
    });

    this.input.on('pointerup', () => {
      this.lastPointerTarget = '';
      this.draggingMap = false;
    });

    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      if (this.isMiniMapScreenPoint(pointer.x, pointer.y)) return;
      const camera = this.cameras.main;
      const next = Phaser.Math.Clamp(
        camera.zoom * (dy > 0 ? 0.9 : 1.1),
        GAME.MIN_ZOOM / this.unit,
        GAME.MAX_ZOOM / this.unit
      );
      camera.setZoom(next);
    });
  }

  private isMiniMapScreenPoint(x: number, y: number): boolean {
    const size = Math.min(240, this.scale.width * 0.36, this.scale.height * 0.45);
    const left = this.scale.width - size;
    return x >= left && x <= left + size && y >= 0 && y <= size;
  }

  private readDirection(): Vec2 {
    if (
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement
    ) {
      return { x: 0, y: 0 };
    }
    const cursor = this.cursors;
    const keys = this.wasd;
    const left = !!(cursor?.left.isDown || keys?.A.isDown);
    const right = !!(cursor?.right.isDown || keys?.D.isDown);
    const up = !!(cursor?.up.isDown || keys?.W.isDown);
    const down = !!(cursor?.down.isDown || keys?.S.isDown);
    if (this.suppressKeyboardUntilRelease) {
      if (left || right || up || down) return { x: 0, y: 0 };
      this.suppressKeyboardUntilRelease = false;
    }
    return { x: (right ? 1 : 0) - (left ? 1 : 0), y: (down ? 1 : 0) - (up ? 1 : 0) };
  }

  private targetAt(x: number, y: number):
    | { kind: 'remote-player'; id: string; name: string; depth: number }
    | { kind: 'monster'; id: string; name: string; depth: number }
    | undefined {
    const hits: Array<
      | { kind: 'remote-player'; id: string; name: string; depth: number }
      | { kind: 'monster'; id: string; name: string; depth: number }
    > = [];
    for (const [id, remote] of this.remoteSprites) {
      if (!remote.sprite.getBounds().contains(x, y)) continue;
      const player = this.networkPlayers.get(id);
      if (player) hits.push({ kind: 'remote-player', id, name: player.name, depth: remote.sprite.depth });
    }
    if (this.monster?.sprite.getBounds().contains(x, y)) {
      hits.push({ kind: 'monster', id: this.monster.id, name: this.monster.name, depth: this.monster.sprite.depth });
    }
    return hits.sort((a, b) => b.depth - a.depth)[0];
  }

  private attackRemotePlayer(action: 'basic-attack' | 'skill-2', targetId: string, targetName: string): void {
    this.miniMapDestination = undefined;
    this.player?.stopMoving();
    this.selectedTarget = { id: targetId, name: targetName };
    this.suppressKeyboardUntilRelease = true;
    this.events.emit('pvp-attack', action, targetId);
  }

  private issueCombatCommand(action: 'basic-attack' | 'skill-2', targetId: string, targetName: string): void {
    this.miniMapDestination = undefined;
    this.player?.stopMoving();
    this.selectedTarget = { id: targetId, name: targetName };
    this.events.emit('target-selected', this.selectedTarget);
    this.suppressKeyboardUntilRelease = true;
    this.statusMessage = action === 'basic-attack' ? 'Đánh thường.' : 'Dùng kỹ năng 2.';
    this.events.emit('combat-command', { action, targetId });
    this.events.emit('hide-character-menu');
  }

  private cellKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  private diamond(graphics: Phaser.GameObjects.Graphics, tx: number, ty: number): void {
    const center = this.model.tileToWorld(tx + 0.5, ty + 0.5);
    const halfWidth = this.model.tileWidth / 2;
    const halfHeight = this.model.tileHeight / 2;
    graphics.beginPath();
    graphics.moveTo(center.x, center.y - halfHeight);
    graphics.lineTo(center.x + halfWidth, center.y);
    graphics.lineTo(center.x, center.y + halfHeight);
    graphics.lineTo(center.x - halfWidth, center.y);
    graphics.closePath();
  }

  private playClickEffect(x: number, y: number): void {
    if (!this.clickEffect) return;
    const tile = this.model.worldToTile(x, y);
    this.clickEffect
      .setPosition(x, y)
      .setDepth(this.model.depthAt(Math.floor(tile.x) + 0.5, Math.floor(tile.y) + 0.5) + 0.5)
      .setVisible(true)
      .play(CLICK_EFFECT.key, true);
  }

  private setMoveDestination(worldX: number, worldY: number, showEffect: boolean): void {
    this.miniMapDestination = undefined;
    const tile = this.model.worldToTile(worldX, worldY);
    const gx = Math.floor(tile.x);
    const gy = Math.floor(tile.y);
    const target = `${gx},${gy}`;
    if (target === this.lastPointerTarget) return;
    this.lastPointerTarget = target;
    if (showEffect) this.playClickEffect(worldX, worldY);

    if (!this.model.isTileLoaded(gx, gy)) {
      this.player?.setPath([]);
      this.statusMessage =
        `Đích ngoài vùng ${MAP_STREAM_WIDTH_TILES}×${MAP_STREAM_HEIGHT_TILES} đang tải. ` +
        'Di chuyển gần hơn rồi thử lại.';
      return;
    }

    const player = this.player;
    if (!player) return;
    const from = player.tile;
    const path = this.model.findPath(from.x, from.y, gx, gy);
    if (path) {
      this.statusMessage = '';
      const start = this.model.tileToWorld(player.fx, player.fy);
      player.setPath(this.model.smoothPath(path, start));
    } else {
      this.player?.setPath([]);
      this.statusMessage = 'Không tìm thấy đường trong vùng đang tải.';
    }
  }

  private setMiniMapDestination(destination: Vec2): void {
    const x = Math.floor(destination.x);
    const y = Math.floor(destination.y);
    const target = `${x},${y}`;
    if (target === `${this.miniMapDestination?.x},${this.miniMapDestination?.y}`) return;
    this.lastPointerTarget = target;
    this.miniMapDestination = { x, y };
    this.miniMapRouteRetryAt = 0;
    const point = this.model.tileToWorld(x + 0.5, y + 0.5);
    this.playClickEffect(point.x, point.y);
    this.continueMiniMapDestination();
  }

  private continueMiniMapDestination(): void {
    const player = this.player;
    const destination = this.miniMapDestination;
    if (!player || !destination) return;
    if (this.model.isTileLoaded(destination.x, destination.y)) {
      const path = this.model.findPath(player.tile.x, player.tile.y, destination.x, destination.y);
      if (!path) {
        this.miniMapDestination = undefined;
        this.statusMessage = 'Không tìm thấy đường tới đích trên mini-map.';
        player.stopMoving();
        return;
      }
      this.miniMapDestination = undefined;
      this.statusMessage = '';
      const start = this.model.tileToWorld(player.fx, player.fy);
      player.setPath(this.model.smoothPath(path, start));
      return;
    }

    const path = this.model.findPathToward(player.tile.x, player.tile.y, destination.x, destination.y);
    if (!path) {
      this.miniMapRouteRetryAt = Date.now() + 500;
      this.statusMessage = 'Đang tải vùng tiếp theo để tìm đường...';
      return;
    }
    const start = this.model.tileToWorld(player.fx, player.fy);
    player.setPath(this.model.smoothPath(path, start));
    this.miniMapRouteRetryAt = Date.now() + 500;
    this.statusMessage = 'Đang di chuyển tới đích trên mini-map...';
  }

  private drawBlockedOverlay(): void {
    const graphics = this.debugBlocked.clear();
    for (const polygon of this.model.getShapes()) {
      graphics.beginPath();
      polygon.forEach((point, index) => {
        const world = this.model.tileToWorld(point.x, point.y);
        if (index === 0) graphics.moveTo(world.x, world.y);
        else graphics.lineTo(world.x, world.y);
      });
      graphics.closePath();
      graphics.fillStyle(0x3b8bff, 0.3).fillPath();
    }
    for (const cell of this.chunkManager.currentCells) {
      if (!this.model.isBlocked(cell.x, cell.y)) continue;
      this.diamond(graphics, cell.x, cell.y);
      graphics.fillStyle(0xff3b3b, 0.35).fillPath();
    }
    graphics.setVisible(this.debugOn);
  }

  private toggleDebug(): void {
    if (!__DEBUG__) return;
    this.debugOn = !this.debugOn;
    this.debugBlocked.setVisible(this.debugOn);
    this.debugCursor.setVisible(this.debugOn);
    if (!this.debugOn) this.debugCursor.clear();
  }
}
