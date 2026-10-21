import type { TiledMap, TiledProperty, TiledTileset } from '../types/tiled';

export interface ResolvedTileset {
  /** Tileset dạng embedded (JSON) để đưa cho Phaser. */
  json: TiledTileset;
  name: string;
  firstgid: number;
  textureKey: string;
  imageUrl: string;
  tileWidth: number;
  tileHeight: number;
  spacing: number;
  margin: number;
  columns: number;
  tileCount: number;
  offsetX: number;
  offsetY: number;
  /** Màu colorkey cần chuyển thành trong suốt (nếu .tsx có trans=...). */
  transColor?: string;
  /** id cục bộ (trong tileset) của các tile có property collides = true. */
  collidingIds: number[];
}

export function resolveUrl(relative: string, base: string): string {
  return new URL(relative, new URL(base, window.location.href)).href;
}

export const tsxCacheKey = (url: string): string => `tsx:${url}`;

/** Danh sách URL các file .tsx mà map tham chiếu (tileset external). */
export function externalTilesetUrls(map: TiledMap, mapUrl: string): string[] {
  const urls: string[] = [];
  for (const ts of map.tilesets) {
    if (ts.source) urls.push(resolveUrl(ts.source, mapUrl));
  }
  return urls;
}

const isTrue = (v: unknown): boolean => v === true || v === 'true' || v === 1 || v === '1';

function parseTsx(doc: Document, tsxUrl: string): TiledTileset {
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'tileset') {
    throw new Error(`File .tsx không hợp lệ (thiếu thẻ <tileset>): ${tsxUrl}`);
  }
  const num = (el: Element, attr: string, fallback = 0): number => {
    const v = el.getAttribute(attr);
    return v === null || v === '' ? fallback : Number(v);
  };
  const children = Array.from(root.children);
  const name = root.getAttribute('name') ?? 'tileset';

  const imageEl = children.find((c) => c.nodeName === 'image');
  if (!imageEl) {
    throw new Error(
      `Tileset "${name}" là "Collection of Images" (không có <image> ở mức tileset). ` +
        `Phaser không hỗ trợ loại này — hãy dùng tileset dạng "Based on Tileset Image".`
    );
  }

  const tiles: Array<{ id: number; properties: TiledProperty[] }> = [];
  for (const tileEl of children.filter((c) => c.nodeName === 'tile')) {
    const propsEl = Array.from(tileEl.children).find((c) => c.nodeName === 'properties');
    if (!propsEl) continue;
    const properties: TiledProperty[] = [];
    for (const p of Array.from(propsEl.children).filter((c) => c.nodeName === 'property')) {
      properties.push({
        name: p.getAttribute('name') ?? '',
        type: p.getAttribute('type') ?? 'string',
        value: p.getAttribute('value') ?? p.textContent ?? ''
      });
    }
    tiles.push({ id: num(tileEl, 'id'), properties });
  }

  const offsetEl = children.find((c) => c.nodeName === 'tileoffset');
  const result: TiledTileset = {
    firstgid: 0,
    name,
    tilewidth: num(root, 'tilewidth'),
    tileheight: num(root, 'tileheight'),
    spacing: num(root, 'spacing'),
    margin: num(root, 'margin'),
    tilecount: num(root, 'tilecount'),
    columns: num(root, 'columns'),
    image: resolveUrl(imageEl.getAttribute('source') ?? '', tsxUrl),
    imagewidth: num(imageEl, 'width'),
    imageheight: num(imageEl, 'height'),
    tiles
  };
  const trans = imageEl.getAttribute('trans');
  if (trans) result.transparentcolor = `#${trans.replace('#', '')}`;
  if (offsetEl) result.tileoffset = { x: num(offsetEl, 'x'), y: num(offsetEl, 'y') };
  return result;
}

function collidingIds(ts: TiledTileset): number[] {
  const ids = new Set<number>();
  for (const t of ts.tiles ?? []) {
    if ((t.properties ?? []).some((p) => p.name === 'collides' && isTrue(p.value))) ids.add(t.id);
  }
  for (const [id, props] of Object.entries(ts.tileproperties ?? {})) {
    if (isTrue(props['collides'])) ids.add(Number(id));
  }
  return Array.from(ids);
}

/**
 * Chuẩn hoá mọi tileset của map (external .tsx hoặc embedded) về một dạng thống nhất.
 * `getXml` trả về Document đã được Phaser load cho key tương ứng.
 */
export function resolveTilesets(
  map: TiledMap,
  mapUrl: string,
  getXml: (key: string) => Document | undefined
): ResolvedTileset[] {
  const usedKeys = new Set<string>();

  return map.tilesets.map((ref, index) => {
    let def: TiledTileset;
    if (ref.source) {
      const url = resolveUrl(ref.source, mapUrl);
      const doc = getXml(tsxCacheKey(url));
      if (!doc) throw new Error(`Không đọc được tileset: ${url}`);
      def = parseTsx(doc, url);
    } else {
      if (!ref.image) {
        throw new Error(
          `Tileset "${ref.name ?? index}" không có image (Collection of Images không được hỗ trợ).`
        );
      }
      def = { ...ref, image: resolveUrl(ref.image, mapUrl) };
    }

    const name = def.name ?? `tileset${index}`;
    const tileWidth = def.tilewidth ?? 0;
    const tileHeight = def.tileheight ?? 0;
    const spacing = def.spacing ?? 0;
    const margin = def.margin ?? 0;
    const imageWidth = def.imagewidth ?? 0;
    const imageHeight = def.imageheight ?? 0;
    if (!tileWidth || !tileHeight || !imageWidth || !imageHeight || !def.image) {
      throw new Error(`Tileset "${name}" thiếu tilewidth/tileheight/image/imagewidth/imageheight.`);
    }

    const columns = def.columns || Math.floor((imageWidth - 2 * margin + spacing) / (tileWidth + spacing));
    const rows = Math.floor((imageHeight - 2 * margin + spacing) / (tileHeight + spacing));
    const tileCount = def.tilecount || columns * rows;

    let textureKey = `tileset:${name}`;
    if (usedKeys.has(textureKey)) textureKey = `${textureKey}#${index}`;
    usedKeys.add(textureKey);

    // Bản JSON đưa cho Phaser: bỏ `tiles`/`tileproperties` — collision do MapModel tự xử lý.
    const json: TiledTileset = {
      firstgid: ref.firstgid,
      name,
      tilewidth: tileWidth,
      tileheight: tileHeight,
      spacing,
      margin,
      tilecount: tileCount,
      columns,
      image: def.image,
      imagewidth: imageWidth,
      imageheight: imageHeight
    };
    if (def.tileoffset) json.tileoffset = def.tileoffset;

    return {
      json,
      name,
      firstgid: ref.firstgid,
      textureKey,
      imageUrl: def.image,
      tileWidth,
      tileHeight,
      spacing,
      margin,
      columns,
      tileCount,
      offsetX: def.tileoffset?.x ?? 0,
      offsetY: def.tileoffset?.y ?? 0,
      transColor: def.transparentcolor,
      collidingIds: collidingIds(def)
    };
  });
}
