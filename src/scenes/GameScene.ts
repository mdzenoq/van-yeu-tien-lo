import Phaser from 'phaser';
import {
  CHARACTERS,
  CLICK_EFFECT,
  CLOUD_COVER,
  GAME,
  MAP_STREAM_BASE_URL,
  MAP_STREAM_RADIUS,
  SPRITE_SKINS,
  type SpriteSkinId
} from '../config';
import { Npc } from '../entities/Npc';
import { Monster } from '../entities/Monster';
import { Player } from '../entities/Player';
import type { ResolvedTileset } from '../loaders/tilesets';
import { ChunkManager } from '../map/ChunkManager';
import { GID_MASK, MapModel, type Vec2 } from '../map/MapModel';
import type { StreamedCell, StreamedObject, StreamedMapManifest } from '../map/StreamedMap';
import { getProp } from '../types/tiled';

export class GameScene extends Phaser.Scene {
  private model!: MapModel;
  private manifest!: StreamedMapManifest;
  private player?: Player;
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
    this.npc = undefined;
    this.npcTile = undefined;
    this.monster = undefined;
    this.monsterTile = undefined;
    this.selectedTarget = undefined;
    this.draggingMap = false;
    this.suppressKeyboardUntilRelease = false;
    this.initialSpawn = undefined;
    this.statusMessage = '';
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
      MAP_STREAM_RADIUS,
      (cells) => this.onRegionLoaded(cells),
      (error) => {
        console.error('[MapStream]', error);
        this.statusMessage = 'Tải vùng map thất bại; sẽ tự thử lại.';
        this.events.emit('hud', `Lỗi tải dữ liệu map: ${error.message}`);
      }
    );
    this.events.once('shutdown', () => this.chunkManager.dispose());

    const equipSkin = (skinId: SpriteSkinId): void => {
      if (!this.player) return;
      this.player.setSkin(this.player.currentSkin === skinId ? null : skinId);
      this.events.emit('skin-changed', this.player.currentSkin);
    };
    this.events.on('equip-skin', equipSkin);
    this.events.once('shutdown', () => this.events.off('equip-skin', equipSkin));

    this.scene.launch('UI');
    this.events.once('shutdown', () => this.scene.stop('UI'));
    this.chunkManager.updateCenter(this.model.spawn.x, this.model.spawn.y);
  }

  update(_time: number, delta: number): void {
    if (!this.player) return;
    const pointer = this.input.activePointer;
    if (this.draggingMap && pointer.leftButtonDown()) {
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.setMoveDestination(worldPoint.x, worldPoint.y, false);
    }
    this.player.update(delta, this.readDirection());

    const tile = this.player.tile;
    this.chunkManager.updateCenter(tile.x, tile.y);
    this.syncCloudCover();
    const debugHint = __DEBUG__ ? `  |  Debug: ${this.debugOn ? 'ON' : 'OFF'}` : '';
    const status = this.statusMessage ? `  |  ${this.statusMessage}` : '';
    const target = this.selectedTarget ? `  |  Mục tiêu: ${this.selectedTarget.name}` : '';
    this.events.emit(
      'hud',
      `Tile: (${tile.x}, ${tile.y})  |  Zoom: ${(this.cameras.main.zoom * this.unit).toFixed(2)}${debugHint}${target}${status}`
    );

    if (this.debugOn) {
      this.debugCursor.clear();
      this.diamond(this.debugCursor, tile.x, tile.y);
      this.debugCursor.lineStyle(2, 0xffe066, 1).strokePath();
    }
  }

  private onRegionLoaded(cells: StreamedCell[]): void {
    this.model.setActiveCells(cells);
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
    const minTileX = center.x - MAP_STREAM_RADIUS + 0.5;
    const maxTileX = center.x + MAP_STREAM_RADIUS + 0.5;
    const minTileY = center.y - MAP_STREAM_RADIUS + 0.5;
    const maxTileY = center.y + MAP_STREAM_RADIUS + 0.5;

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
    for (const [skinId, skin] of Object.entries(SPRITE_SKINS)) {
      if (!this.textures.exists(skin.key)) continue;
      skin.directions.forEach((direction, row) => {
        const key = `${skinId}-${direction}`;
        if (this.anims.exists(key)) return;
        const start = row * skin.framesPerDirection;
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(skin.key, {
            start,
            end: start + skin.framesPerDirection - 1
          }),
          frameRate: 8,
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
        sprite.setDepth(above ? 100000 + layerIndex : cell.x + cell.y + 1 + layerIndex * 0.001);
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
    const tx = object.x / this.model.tileHeight;
    const ty = object.y / this.model.tileHeight;
    const p = this.model.tileToWorld(tx, ty);
    const image = this.add
      .image(p.x + tileset.offsetX, p.y + tileset.offsetY, tileset.textureKey, this.ensureFrame(tileset, gid - tileset.firstgid))
      .setOrigin(0.5, 1)
      .setAlpha(layer.opacity ?? 1)
      .setDepth(tx + ty + layerIndex * 0.001);
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
      const target = this.targetAt(pointer.worldX, pointer.worldY);
      if (pointer.leftButtonDown()) {
        this.lastPointerTarget = '';
        this.draggingMap = false;
        this.events.emit('hide-character-menu');
        if (target?.kind === 'character') {
          this.selectedTarget = { id: target.id, name: target.name };
          this.statusMessage = '';
          this.events.emit('target-selected', this.selectedTarget);
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
      if (target?.kind === 'character') {
        this.events.emit('show-character-menu', { x: pointer.x, y: pointer.y });
      } else if (target?.kind === 'monster') {
        this.issueCombatCommand('skill-2', target.id, target.name);
      } else {
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

    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      const camera = this.cameras.main;
      const next = Phaser.Math.Clamp(
        camera.zoom * (dy > 0 ? 0.9 : 1.1),
        GAME.MIN_ZOOM / this.unit,
        GAME.MAX_ZOOM / this.unit
      );
      camera.setZoom(next);
    });
  }

  private readDirection(): Vec2 {
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
    | { kind: 'character'; id: string; name: string; depth: number }
    | { kind: 'monster'; id: string; name: string; depth: number }
    | undefined {
    const hits: Array<
      | { kind: 'character'; id: string; name: string; depth: number }
      | { kind: 'monster'; id: string; name: string; depth: number }
    > = [];
    if (this.npc?.sprite.getBounds().contains(x, y)) {
      hits.push({ kind: 'character', id: 'sample-character', name: 'Nhân vật mẫu', depth: this.npc.sprite.depth });
    }
    if (this.monster?.sprite.getBounds().contains(x, y)) {
      hits.push({ kind: 'monster', id: this.monster.id, name: this.monster.name, depth: this.monster.sprite.depth });
    }
    return hits.sort((a, b) => b.depth - a.depth)[0];
  }

  private issueCombatCommand(action: 'basic-attack' | 'skill-2', targetId: string, targetName: string): void {
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
      .setDepth(Math.floor(tile.x) + Math.floor(tile.y) + 0.5)
      .setVisible(true)
      .play(CLICK_EFFECT.key, true);
  }

  private setMoveDestination(worldX: number, worldY: number, showEffect: boolean): void {
    const tile = this.model.worldToTile(worldX, worldY);
    const gx = Math.floor(tile.x);
    const gy = Math.floor(tile.y);
    const target = `${gx},${gy}`;
    if (target === this.lastPointerTarget) return;
    this.lastPointerTarget = target;
    if (showEffect) this.playClickEffect(worldX, worldY);

    if (!this.model.isTileLoaded(gx, gy)) {
      this.player?.setPath([]);
      const diameter = MAP_STREAM_RADIUS * 2 + 1;
      this.statusMessage = `Đích ngoài vùng ${diameter}×${diameter} đang tải. Di chuyển gần hơn rồi thử lại.`;
      return;
    }

    const from = this.player?.tile;
    if (!from) return;
    const path = this.model.findPath(from.x, from.y, gx, gy);
    if (path) {
      this.statusMessage = '';
      this.player?.setPath(path);
    } else {
      this.player?.setPath([]);
      this.statusMessage = 'Không tìm thấy đường trong vùng đang tải.';
    }
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
