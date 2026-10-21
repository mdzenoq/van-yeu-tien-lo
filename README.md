# Iso Game — Phaser 4.2.1 + TypeScript + Vite

Game isometric dùng **1 file map Tiled (.json)**. Tileset là file **.tsx** (external) trỏ tới ảnh **.png**; game tự đọc .tsx, nạp PNG rồi gắn vào map.

## Chạy

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc --noEmit + vite build -> dist/
```

Phải chạy qua server (Vite/dev server hoặc `npm run preview`); mở thẳng `index.html` bằng `file://` sẽ không load được asset.

## Điều khiển

| Phím / chuột | Tác dụng |
|---|---|
| WASD / mũi tên | Đi theo hướng màn hình (lên/xuống/trái/phải) |
| Click chuột trái | Tự tìm đường (BFS 8 hướng) tới ô được click |
| Cuộn chuột | Zoom 1x–4x |
| G | Bật/tắt debug (ô bị chặn màu đỏ, ô người chơi đang đứng) |
| Nút skin rắn/rồng | Mặc hoặc tháo skin tương ứng; có thể thêm cấu hình sheet trong `SPRITE_SKINS` |

Sprite sheet skin dùng ô 128×128, 8 hàng theo thứ tự W, WD, D, SD, S, SA, A, AW. `framesPerDirection` là số frame nằm ngang trên mỗi hàng. Ví dụ rồng có 10 frame/hướng cần ảnh 1280×1024 tại `public/assets/sprites/dragon_idle.png`; cập nhật config rồi đặt ảnh vào đúng đường dẫn.

## Cấu trúc

```
public/assets/
  maps/map.json            <- map Tiled (THAY FILE NÀY)
  tilesets/iso_tiles.tsx   <- tileset external
  tilesets/iso_tiles.png   <- ảnh của tileset (đường dẫn lấy từ .tsx)
  sprites/player.png
src/
  config.ts                <- MAP_URL, tốc độ, zoom...
  loaders/tilesets.ts      <- đọc .tsx / tileset embedded
  map/MapModel.ts          <- va chạm, spawn, tìm đường, công thức chiếu iso
  entities/Player.ts
  scenes/{Boot,Game,UI}Scene.ts
tools/generate_sample_assets.py   <- sinh asset mẫu (cần pillow)
```

## Thay map của bạn

1. Copy map vào `public/assets/maps/map.json` (hoặc đổi `MAP_URL` trong `src/config.ts`).
2. Copy các `.tsx` + `.png` sao cho đường dẫn **tương đối từ map.json tới .tsx** và **từ .tsx tới .png** vẫn đúng (Tiled tự ghi sẵn).
3. Yêu cầu của map trong Tiled:
   - Orientation: **Isometric**; **không** bật Infinite.
   - Tile Layer Format: **CSV** (mảng số). Base64/zlib chưa hỗ trợ.
   - Tileset: **Based on Tileset Image** (Phaser không hỗ trợ *Collection of Images*). Tileset embedded cũng được.
   - Ảnh tile cao hơn ô lưới (vd. 64×64 cho ô 64×32) thì căn đáy ảnh vào đỉnh dưới hình thoi — chuẩn của Tiled.
   - Không dùng group layer.
4. Custom Property (tuỳ chọn):

| Nơi đặt | Property | Ý nghĩa |
|---|---|---|
| Tile trong .tsx | `collides` (bool) = true | Tile chặn đường |
| Tile Layer | `collides` = true | Cả layer chặn đường |
| Tile Layer | `sorted` = true | Vẽ từng tile thành sprite, sắp depth để đi vòng ra sau tường/cây |
| Tile Layer | `above` = true | Luôn vẽ trên người chơi |
| Object Layer | object tên `spawn` (Point) | Vị trí xuất phát (không có thì dùng giữa map) |

Layer không có `sorted`/`above` được vẽ bằng Tilemap Layer của Phaser, nằm dưới người chơi (hợp với nền đất).

## Lưu ý

- Code được viết theo tài liệu/mã nguồn Phaser 4.2.1 (đã đối chiếu `IsometricWorldToTileXY`, `TilemapJSONFile`, skill tilemaps), nhưng **chưa chạy thử trong trình duyệt** ở môi trường tạo zip (không có mạng để `npm install`). Nếu `npm run typecheck` báo lỗi kiểu, gửi log lại để sửa.
- Nếu tile vẽ bằng Tilemap Layer và tile `sorted` lệch nhau trên map của bạn, đặt `sorted = true` cho mọi tile layer để toàn bộ do game tự vẽ.
- Chỉ ô tile mới chặn đường; object layer không dùng làm vật cản.
