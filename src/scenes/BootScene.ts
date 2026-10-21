import Phaser from 'phaser';
import {
  CHARACTERS,
  CLICK_EFFECT,
  CLOUD_COVER,
  KEY,
  MAP_STREAM_BASE_URL,
  MAP_URL,
  SPRITE_SKINS
} from '../config';
import { externalTilesetUrls, resolveTilesets, tsxCacheKey, type ResolvedTileset } from '../loaders/tilesets';
import type { StreamedMapManifest } from '../map/StreamedMap';

/**
 * Luồng nạp:
 *  1) manifest nhẹ (không chứa mảng GID/object của map)
 *  2) các file .tsx và ảnh tileset
 *  3) GameScene yêu cầu các ô gần spawn
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
      if (file.key === SPRITE_SKINS.dragon.key || file.key === CLICK_EFFECT.key || file.key === CLOUD_COVER.key) {
        console.warn(`[Boot] Bỏ qua asset tùy chọn không tải được: ${file.src}`);
        return;
      }
      this.fail(`Không tải được file: ${file.src}`);
    });
    this.load.json(KEY.MAP_MANIFEST, `${MAP_STREAM_BASE_URL}/manifest.json`);
    for (const c of Object.values(CHARACTERS)) this.load.image(c.key, c.url);
    this.load.image(CLOUD_COVER.key, CLOUD_COVER.url);
    this.load.spritesheet(CLICK_EFFECT.key, CLICK_EFFECT.url, {
      frameWidth: CLICK_EFFECT.frameWidth,
      frameHeight: CLICK_EFFECT.frameHeight
    });
    for (const skin of Object.values(SPRITE_SKINS)) {
      this.load.spritesheet(skin.key, skin.url, {
        frameWidth: skin.frameWidth,
        frameHeight: skin.frameHeight
      });
    }
  }

  create(): void {
    if (this.failed) return;
    const manifest = this.cache.json.get(KEY.MAP_MANIFEST) as StreamedMapManifest | undefined;
    if (!manifest || !Array.isArray(manifest.layers) || !Array.isArray(manifest.tilesets)) {
      this.fail(`Manifest map không hợp lệ: ${MAP_STREAM_BASE_URL}/manifest.json`);
      return;
    }
    if (manifest.orientation !== 'isometric') {
      this.fail(`Map phải có Orientation = Isometric (hiện tại: ${manifest.orientation}).`);
      return;
    }
    if (manifest.infinite) {
      this.fail('Map "Infinite" chưa được hỗ trợ. Tắt Infinite trong Map Properties của Tiled.');
      return;
    }

    for (const url of externalTilesetUrls(manifest, MAP_URL)) {
      const key = tsxCacheKey(url);
      if (!this.cache.xml.exists(key)) this.load.xml(key, url);
    }
    this.runLoader(() => this.loadTilesetImages(manifest));
  }

  private loadTilesetImages(manifest: StreamedMapManifest): void {
    if (this.failed) return;
    let tilesets: ResolvedTileset[];
    try {
      tilesets = resolveTilesets(manifest, MAP_URL, (key) => this.cache.xml.get(key) as Document | undefined);
    } catch (e) {
      this.fail((e as Error).message);
      return;
    }
    for (const ts of tilesets) {
      if (!this.textures.exists(ts.textureKey)) this.load.image(ts.textureKey, ts.imageUrl);
    }
    this.runLoader(() => this.finish(manifest, tilesets));
  }

  private finish(manifest: StreamedMapManifest, tilesets: ResolvedTileset[]): void {
    if (this.failed) return;
    for (const ts of tilesets) if (ts.transColor) this.applyColorKey(ts);
    this.registry.set(KEY.MAP_MANIFEST, manifest);
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
