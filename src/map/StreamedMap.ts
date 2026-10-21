import type { TiledLayer, TiledMap, TiledObject } from '../types/tiled';

export interface StreamedMapManifest extends Omit<TiledMap, 'layers'> {
  layers: Array<Omit<TiledLayer, 'data' | 'objects'>>;
  spawn: { x: number; y: number };
}

export interface StreamedTile {
  layerId: number;
  gid: number;
}

export interface StreamedObject {
  layerId: number;
  object: TiledObject;
}

export interface StreamedCell {
  x: number;
  y: number;
  tiles: StreamedTile[];
  objects: StreamedObject[];
}
