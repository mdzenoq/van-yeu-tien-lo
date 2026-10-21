import Phaser from 'phaser';
import { CHARACTERS, KEY, MAP_URL, SPRITE_SKINS } from '../config';
import { externalTilesetUrls, resolveTilesets, tsxCacheKey, type ResolvedTileset } from '../loaders/tilesets';
import type { TiledMap } from '../types/tiled';

/**
 * Luồng nạp:
 *  1) map.json + sprite người chơi
 *  2) các file .tsx mà map tham chiếu (Phaser không tự đọc tileset external)
 *  3) ảnh PNG của từng tileset (đường dẫn lấy từ .tsx)
 *  4) gộp tileset vào JSON, đăng ký vào tilemap cache rồi chạy GameScene
 */
export class BootScene extends Phaser.Scene {
  private bar!: Phaser.GameObjects.Graphics;
  private failed = false;

  constructor() {
    super('Boot');
  }

  preload(): void {
    this.bar = this.add.graphics();
    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => this.drawProgress(value));
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      if (file.key === SPRITE_SKINS.dragon.key) {
        console.warn(`[Boot] Bỏ qua skin rồng vì không tải được file: ${file.src}`);
        return;
      }
      this.fail(`Không tải được file: ${file.src}`);
    });
    this.load.json(KEY.MAP_RAW, MAP_URL);
    for (const c of Object.values(CHARACTERS)) this.load.image(c.key, c.url);
    for (const skin of Object.values(SPRITE_SKINS)) {
      this.load.spritesheet(skin.key, skin.url, {
        frameWidth: skin.frameWidth,
        frameHeight: skin.frameHeight
      });
    }
  }

  create(): void {
    if (this.failed) return;
    const raw = this.cache.json.get(KEY.MAP_RAW) as TiledMap | undefined;
    if (!raw || !Array.isArray(raw.layers) || !Array.isArray(raw.tilesets)) {
      this.fail(`File map không hợp lệ: ${MAP_URL}`);
      return;
    }
    if (raw.orientation !== 'isometric') {
      this.fail(`Map phải có Orientation = Isometric (hiện tại: ${raw.orientation}).`);
      return;
    }
    if (raw.infinite) {
      this.fail('Map "Infinite" chưa được hỗ trợ. Tắt Infinite trong Map Properties của Tiled.');
      return;
    }

    for (const url of externalTilesetUrls(raw, MAP_URL)) {
      const key = tsxCacheKey(url);
      if (!this.cache.xml.exists(key)) this.load.xml(key, url);
    }
    this.runLoader(() => this.loadTilesetImages(raw));
  }

  private loadTilesetImages(raw: TiledMap): void {
    if (this.failed) return;
    let tilesets: ResolvedTileset[];
    try {
      tilesets = resolveTilesets(raw, MAP_URL, (key) => this.cache.xml.get(key) as Document | undefined);
    } catch (e) {
      this.fail((e as Error).message);
      return;
    }
    for (const ts of tilesets) {
      if (!this.textures.exists(ts.textureKey)) this.load.image(ts.textureKey, ts.imageUrl);
    }
    this.runLoader(() => this.finish(raw, tilesets));
  }

  private finish(raw: TiledMap, tilesets: ResolvedTileset[]): void {
    if (this.failed) return;
    for (const ts of tilesets) if (ts.transColor) this.applyColorKey(ts);
    const merged: TiledMap = { ...raw, tilesets: tilesets.map((t) => t.json) };
    if (this.cache.tilemap.exists(KEY.MAP)) this.cache.tilemap.remove(KEY.MAP);
    this.cache.tilemap.add(KEY.MAP, { format: Phaser.Tilemaps.Formats.TILED_JSON, data: merged });
    this.registry.set('tilesets', tilesets);
    this.scene.start('Game');
  }

  /** Phaser không hiểu `trans` của Tiled: đổi các pixel đúng màu colorkey thành alpha 0. */
  private applyColorKey(ts: ResolvedTileset): void {
    const src = this.textures.get(ts.textureKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const canvas = document.createElement('canvas');
    canvas.width = src.width;
    canvas.height = src.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !ts.transColor) return;
    ctx.drawImage(src, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const hex = ts.transColor.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === r && d[i + 1] === g && d[i + 2] === b) d[i + 3] = 0;
    }
    ctx.putImageData(img, 0, 0);
    this.textures.remove(ts.textureKey);
    this.textures.addCanvas(ts.textureKey, canvas);
  }

  /** Chạy loader cho các file vừa được thêm; nếu không có file nào thì gọi tiếp ngay. */
  private runLoader(next: () => void): void {
    if (this.load.list.size === 0) {
      next();
      return;
    }
    this.load.once(Phaser.Loader.Events.COMPLETE, next);
    this.load.start();
  }

  private drawProgress(value: number): void {
    const { width, height } = this.scale;
    const w = Math.min(320, width * 0.6);
    const x = (width - w) / 2;
    const y = height / 2;
    this.bar.clear();
    this.bar.fillStyle(0x2c3a4d, 1).fillRect(x, y, w, 10);
    this.bar.fillStyle(0x6fd08c, 1).fillRect(x, y, w * value, 10);
  }

  private fail(message: string): void {
    if (this.failed) return;
    this.failed = true;
    console.error('[Boot]', message);
    this.add
      .text(this.scale.width / 2, this.scale.height / 2 + 40, message, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ff8a8a',
        align: 'center',
        wordWrap: { width: Math.max(240, this.scale.width - 40) }
      })
      .setOrigin(0.5, 0);
  }
}
