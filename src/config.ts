// Đường dẫn tính từ thư mục public/ (Vite phục vụ ở gốc, base './' khi build).
export const MAP_URL = 'assets/maps/tay-do.json';
export const MAP_STREAM_ID = MAP_URL.split('/').pop()?.replace(/\.json$/i, '') ?? 'map';
export const MAP_STREAM_BASE_URL = `assets/map-stream/${MAP_STREAM_ID}`;
export const MAP_STREAM_RADIUS = 7;

export const CLOUD_COVER = {
  key: 'cloud-cover',
  url: 'assets/images/cloud.png',
  scale: 8,
  spacing: 96,
  alpha: 0.45
} as const;

export const KEY = {
  MAP_MANIFEST: 'map-manifest'
} as const;

export interface CharacterDef {
  key: string;
  url: string;
  /** Gốc toạ độ (0..1) — đặt ở GIỮA HAI CHÂN. */
  originX: number;
  originY: number;
  /** Hệ số so với nhân vật nam (nam = 1). */
  scaleX: number;
  scaleY: number;
}

export const CHARACTERS: Record<'male' | 'female', CharacterDef> = {
  male: { key: 'char-male', url: 'assets/sprites/player_male.png', originX: 0.5, originY: 56 / 64, scaleX: 1, scaleY: 1 },
  female: { key: 'char-female', url: 'assets/sprites/player_female.png', originX: 0.5, originY: 56 / 64, scaleX: 0.92, scaleY: 0.96 }
};

export const SKIN_DIRECTIONS = ['W', 'WD', 'D', 'SD', 'S', 'SA', 'A', 'AW'] as const;

export const CLICK_EFFECT = {
  key: 'click_effect',
  url: 'assets/sprites/click_effect.png',
  frameWidth: 32,
  frameHeight: 32,
  frameCount: 6
} as const;

export const CURSOR = {
  url: 'assets/images/cursor.png',
  scale: 0.4,
  hotspotX: 5,
  hotspotY: 3
} as const;

export const SPRITE_SKINS = {
  snake: {
    label: 'rắn',
    key: 'snake-skin',
    url: 'assets/sprites/snake_idle.png',
    frameWidth: 128,
    frameHeight: 128,
    framesPerDirection: 8,
    directions: SKIN_DIRECTIONS
  },
  dragon: {
    label: 'rồng',
    key: 'dragon-skin',
    url: 'assets/sprites/dragon_idle.png',
    frameWidth: 128,
    frameHeight: 128,
    framesPerDirection: 8,
    directions: SKIN_DIRECTIONS
  }
} as const;

export type SpriteSkinId = keyof typeof SPRITE_SKINS;

export const GAME = {
  // Giá trị zoom/tốc độ ứng với tile 64px; game tự nhân theo tileWidth/64 của map.
  ZOOM: 2,
  MIN_ZOOM: 1,
  MAX_ZOOM: 4,
  SPEED_PX: 105, // tốc độ di chuyển trên màn hình (pixel/giây)
  PLAYER_RADIUS: 0.22 // bán kính va chạm, tính theo đơn vị tile
} as const;
