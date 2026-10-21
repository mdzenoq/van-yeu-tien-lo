import Phaser from 'phaser';
import { CHARACTERS, GAME, KEY, SPRITE_SKINS, type SpriteSkinId } from '../config';
import { Npc } from '../entities/Npc';
import { Player } from '../entities/Player';
import type { ResolvedTileset } from '../loaders/tilesets';
import { GID_MASK, MapModel } from '../map/MapModel';
import { getProp, type TiledLayer, type TiledMap } from '../types/tiled';

/**
 * Thuộc tính layer (Custom Properties trong Tiled) được hỗ trợ:
 *  - sorted: true   -> vẽ từng tile thành sprite và sắp xếp depth theo (x + y), để người chơi
 *                      có thể đi "ra sau" tường/cây. Dùng cho layer tường, vật thể cao.
 *  - above:  true   -> layer luôn nằm trên người chơi (ngọn cây, mái nhà...).
 *  - collides: true -> mọi tile trong layer đều chặn đường.
 * Thuộc tính tile (trong .tsx): collides = true -> tile đó chặn đường.
 * Layer thường (không có thuộc tính nào ở trên) được vẽ bằng Tilemap Layer của Phaser, nằm dưới người chơi.
 */
export class GameScene extends Phaser.Scene {
  private model!: MapModel;
  private player!: Player;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private marker!: Phaser.GameObjects.Graphics;
  private debugBlocked!: Phaser.GameObjects.Graphics;
  private debugCursor!: Phaser.GameObjects.Graphics;
  private debugOn = false;
  /** Cỡ tile so với 64px — dùng để tự co giãn zoom khi map có tile lớn (vd. 256px). */
  private unit = 1;

  constructor() {
    super('Game');
  }

  create(): void {
    const tilesets = this.registry.get('tilesets') as ResolvedTileset[];
    const raw = (this.cache.tilemap.get(KEY.MAP) as { data: TiledMap }).data; this.model = new MapModel(raw, tilesets);
    this.unit = this.model.tileWidth / 64;

    this.buildLayers(raw, tilesets);
    this.createTileObjects(raw);

    const spawn = this.model.spawn;
    this.player = new Player(this, this.model, spawn.x, spawn.y, CHARACTERS.female);
    this.createSkinAnimations();

    const equipSkin = (skinId: SpriteSkinId): void => {
      this.player.setSkin(this.player.currentSkin === skinId ? null : skinId);
      this.events.emit('skin-changed', this.player.currentSkin);
    };
    this.events.on('equip-skin', equipSkin);
    this.events.once('shutdown', () => this.events.off('equip-skin', equipSkin));

    // Nhân vật nam đứng sẵn cách điểm spawn 2 ô, quay mặt về phía người chơi, và chặn đường.
    const npc = this.model.nearestFree(spawn.x + 2, spawn.y);
    if (npc.x !== spawn.x || npc.y !== spawn.y) {
      new Npc(this, this.model, npc.x, npc.y, CHARACTERS.male);
      this.model.block(npc.x, npc.y);
    }

    this.marker = this.add.graphics().setDepth(50000);
    this.debugBlocked = this.add.graphics().setDepth(50001).setVisible(false);
    this.debugCursor = this.add.graphics().setDepth(50002).setVisible(false);
    this.drawBlockedOverlay();

    this.setupCamera();
    this.setupInput();

    this.scene.launch('UI');
    this.events.once('shutdown', () => this.scene.stop('UI'));
  }

  update(_time: number, delta: number): void {
    this.player.update(delta, this.readDirection());

    const t = this.player.tile;
    this.events.emit(
      'hud',
      `Tile: (${t.x}, ${t.y})  |  Zoom: ${(this.cameras.main.zoom * this.unit).toFixed(2)}  |  Debug: ${this.debugOn ? 'ON' : 'OFF'}`
    );

    if (this.debugOn) {
      this.debugCursor.clear();
      this.diamond(this.debugCursor, t.x, t.y);
      this.debugCursor.lineStyle(2, 0xffe066, 1).strokePath();
    }
  }

  // ---------------------------------------------------------------- layers

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

  private buildLayers(raw: TiledMap, tilesets: ResolvedTileset[]): void {
    const map = this.add.tilemap(KEY.MAP);
    const phaserTilesets: Phaser.Tilemaps.Tileset[] = [];
    for (const ts of tilesets) {
      const added = map.addTilesetImage(ts.name, ts.textureKey);
      if (added) phaserTilesets.push(added);
      else console.warn(`[Game] Không gắn được tileset "${ts.name}" vào Phaser tilemap.`);
    }

    raw.layers.forEach((layer, index) => {
      if (layer.type !== 'tilelayer' || layer.visible === false) return;

      if (getProp<boolean>(layer, 'sorted') === true) {
        this.createSortedLayer(layer, index);
        return;
      }
      const tl = map.createLayer(layer.name, phaserTilesets, 0, 0);
      if (!tl) {
        console.warn(`[Game] Không tạo được layer "${layer.name}".`);
        return;
      }
      tl.setAlpha(layer.opacity ?? 1);
      tl.setDepth(getProp<boolean>(layer, 'above') === true ? 100000 + index : -10000 + index);
    });
  }

  /** Tile object (object có gid) trong Object Layer: vẽ thành sprite, neo giữa-đáy, sắp depth theo (x + y). */
  private createTileObjects(raw: TiledMap): void {
    const u = this.model.tileHeight; // đơn vị toạ độ object của map isometric
    raw.layers.forEach((layer, index) => {
      if (layer.type !== 'objectgroup' || layer.visible === false) return;
      for (const obj of layer.objects ?? []) {
        if (!obj.gid || obj.visible === false) continue;
        const gid = obj.gid & GID_MASK;
        const ts = this.model.tilesetForGid(gid);
        if (!ts) continue;
        const tx = obj.x / u;
        const ty = obj.y / u;
        const p = this.model.tileToWorld(tx, ty);
        const img = this.add
          .image(p.x + ts.offsetX, p.y + ts.offsetY, ts.textureKey, this.ensureFrame(ts, gid - ts.firstgid))
          .setOrigin(0.5, 1)
          .setAlpha(layer.opacity ?? 1)
          .setDepth(tx + ty + index * 0.001);
        if (obj.width && obj.height) img.setDisplaySize(obj.width, obj.height);
        if (obj.rotation) img.setAngle(obj.rotation);
      }
    });
  }

  private createSortedLayer(layer: TiledLayer, layerIndex: number): void {
    const data = layer.data ?? [];
    const { width, height, tileWidth, tileHeight } = this.model;
    const hw = tileWidth / 2;
    const hh = tileHeight / 2;
    const above = getProp<boolean>(layer, 'above') === true;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const gid = (data[y * width + x] ?? 0) & GID_MASK;
        if (!gid) continue;
        const ts = this.model.tilesetForGid(gid);
        if (!ts) continue;

        const frame = this.ensureFrame(ts, gid - ts.firstgid);
        // Ảnh tile neo theo đỉnh dưới của hình thoi (chuẩn Tiled cho tile cao hơn ô lưới).
        const px = (x - y) * hw + hw + ts.offsetX;
        const py = (x + y) * hh + tileHeight + ts.offsetY;
        this.add
          .image(px, py, ts.textureKey, frame)
          .setOrigin(0.5, 1)
          .setAlpha(layer.opacity ?? 1)
          .setDepth(above ? 100000 + layerIndex : x + y + 1 + layerIndex * 0.001);
      }
    }
  }

  private ensureFrame(ts: ResolvedTileset, localId: number): string {
    const name = `t${localId}`;
    const texture = this.textures.get(ts.textureKey);
    if (!texture.has(name)) {
      const col = localId % ts.columns;
      const row = Math.floor(localId / ts.columns);
      texture.add(
        name,
        0,
        ts.margin + col * (ts.tileWidth + ts.spacing),
        ts.margin + row * (ts.tileHeight + ts.spacing),
        ts.tileWidth,
        ts.tileHeight
      );
    }
    return name;
  }

  // ---------------------------------------------------------------- camera & input

  private setupCamera(): void {
    const cam = this.cameras.main;
    const b = this.model.worldBounds();
    cam.setBounds(b.x, b.y, b.width, b.height);
    cam.setZoom(GAME.ZOOM / this.unit);
    cam.startFollow(this.player.sprite, true, 0.12, 0.12);
    cam.setBackgroundColor('#1b2430');
  }

  private setupInput(): void {
    const kb = this.input.keyboard;
    if (kb) {
      this.cursors = kb.createCursorKeys();
      this.wasd = kb.addKeys('W,A,S,D') as Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
      kb.addKey(Phaser.Input.Keyboard.KeyCodes.G).on('down', () => this.toggleDebug());
    }

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!p.leftButtonDown()) return;
      const t = this.model.worldToTile(p.worldX, p.worldY);
      const gx = Math.floor(t.x);
      const gy = Math.floor(t.y);
      const from = this.player.tile;
      const path = this.model.findPath(from.x, from.y, gx, gy);
      this.showMarker(gx, gy, path !== null);
      if (path) this.player.setPath(path);
    });

    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      const next = Phaser.Math.Clamp(
        cam.zoom * (dy > 0 ? 0.9 : 1.1),
        GAME.MIN_ZOOM / this.unit,
        GAME.MAX_ZOOM / this.unit
      );
      cam.setZoom(next);
    });
  }

  /** Hướng theo màn hình: lên/xuống/trái/phải đúng như người chơi nhìn thấy. */
  private readDirection(): { x: number; y: number } {
    const c = this.cursors;
    const k = this.wasd;
    const left = !!(c?.left.isDown || k?.A.isDown);
    const right = !!(c?.right.isDown || k?.D.isDown);
    const up = !!(c?.up.isDown || k?.W.isDown);
    const down = !!(c?.down.isDown || k?.S.isDown);
    return { x: (right ? 1 : 0) - (left ? 1 : 0), y: (down ? 1 : 0) - (up ? 1 : 0) };
  }

  // ---------------------------------------------------------------- vẽ phụ trợ

  /** Dựng đường viền hình thoi của ô (tx, ty) vào path của Graphics. */
  private diamond(g: Phaser.GameObjects.Graphics, tx: number, ty: number): void {
    const c = this.model.tileToWorld(tx + 0.5, ty + 0.5);
    const hw = this.model.tileWidth / 2;
    const hh = this.model.tileHeight / 2;
    g.beginPath();
    g.moveTo(c.x, c.y - hh);
    g.lineTo(c.x + hw, c.y);
    g.lineTo(c.x, c.y + hh);
    g.lineTo(c.x - hw, c.y);
    g.closePath();
  }

  private showMarker(tx: number, ty: number, ok: boolean): void {
    const color = ok ? 0x6fd08c : 0xff6b6b;
    this.tweens.killTweensOf(this.marker);
    this.marker.clear().setAlpha(1);
    this.diamond(this.marker, tx, ty);
    this.marker.fillStyle(color, 0.35).fillPath();
    this.diamond(this.marker, tx, ty);
    this.marker.lineStyle(2, color, 1).strokePath();
    this.tweens.add({ targets: this.marker, alpha: 0, duration: 700, ease: 'Quad.easeIn' });
  }

  private drawBlockedOverlay(): void {
    const g = this.debugBlocked;
    for (const poly of this.model.getShapes()) {
      g.beginPath();
      poly.forEach((pt, i) => {
        const w = this.model.tileToWorld(pt.x, pt.y);
        if (i === 0) g.moveTo(w.x, w.y);
        else g.lineTo(w.x, w.y);
      });
      g.closePath();
      g.fillStyle(0x3b8bff, 0.3).fillPath();
    }
    for (let y = 0; y < this.model.height; y++) {
      for (let x = 0; x < this.model.width; x++) {
        if (!this.model.isBlocked(x, y)) continue;
        this.diamond(g, x, y);
        g.fillStyle(0xff3b3b, 0.35).fillPath();
      }
    }
  }

  private toggleDebug(): void {
    this.debugOn = !this.debugOn;
    this.debugBlocked.setVisible(this.debugOn);
    this.debugCursor.setVisible(this.debugOn);
    if (!this.debugOn) this.debugCursor.clear();
  }
}
