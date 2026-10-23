export interface TiledProperty {
  name: string;
  type?: string;
  value: unknown;
}

export interface TiledTileset {
  firstgid: number;
  source?: string;
  name?: string;
  tilewidth?: number;
  tileheight?: number;
  spacing?: number;
  margin?: number;
  tilecount?: number;
  columns?: number;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  tileoffset?: { x: number; y: number };
  /** Màu colorkey (vd. "#ff00ff") — Tiled ghi từ thuộc tính trans của <image>. */
  transparentcolor?: string;
  tiles?: Array<{ id: number; properties?: TiledProperty[] }>;
  tileproperties?: Record<string, Record<string, unknown>>;
}

export interface TiledObject {
  id: number;
  name?: string;
  type?: string;
  class?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  visible?: boolean;
  gid?: number;
  point?: boolean;
  polygon?: Array<{ x: number; y: number }>;
  properties?: TiledProperty[];
}

export interface TiledLayer {
  id?: number;
  name: string;
  type: string;
  width?: number;
  height?: number;
  data?: number[];
  visible?: boolean;
  opacity?: number;
  properties?: TiledProperty[];
  objects?: TiledObject[];
}

export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  orientation: string;
  staggeraxis?: 'x' | 'y';
  staggerindex?: 'odd' | 'even';
  infinite?: boolean;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
  properties?: TiledProperty[];
}

export function getProp<T>(owner: { properties?: TiledProperty[] }, name: string): T | undefined {
  const found = owner.properties?.find((p) => p.name === name);
  return found ? (found.value as T) : undefined;
}
