// Đường dẫn tính từ thư mục public/ (Vite phục vụ ở gốc, base './' khi build).
export const MAP_URL = 'assets/maps/map-sample.json';

export const KEY = {
  MAP_RAW: 'map-raw',
  MAP: 'map'
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

export const GAME = {
  // Giá trị zoom/tốc độ ứng với tile 64px; game tự nhân theo tileWidth/64 của map.
  ZOOM: 2,
  MIN_ZOOM: 1,
  MAX_ZOOM: 4,
  SPEED_PX: 150, // tốc độ di chuyển trên màn hình (pixel/giây)
  PLAYER_RADIUS: 0.22 // bán kính va chạm, tính theo đơn vị tile
} as const;
