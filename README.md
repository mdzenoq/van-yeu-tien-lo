# Iso Game — Phaser 4.2.1 + TypeScript + Vite

Game isometric dùng map Tiled finite (`.json`) làm nguồn. Trước khi chạy dev server hoặc build, script sinh manifest, PNG mini-map và payload JSON riêng cho từng ô; trình duyệt không tải map JSON nguồn. Tileset là file `.tsx` (external) trỏ tới ảnh `.png`; game đọc TSX và nạp ảnh một lần vào texture cache.

## Chạy

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # sinh payload vùng + tsc --noEmit + vite build -> dist/
```

Sinh PNG mini-map cần Python 3 và Pillow (`python3 -m pip install pillow`).

Phải chạy qua server (Vite/dev server hoặc `npm run preview`); mở thẳng `index.html` bằng `file://` sẽ không load được asset.

## Điều khiển

| Phím / chuột | Tác dụng |
|---|---|
| WASD / mũi tên | Đi theo hướng màn hình (lên/xuống/trái/phải) |
| Click chuột trái lên map | Đi tới vị trí click bằng BFS trong vùng đang tải; hiệu ứng click nằm dưới nhân vật |
| Giữ chuột trái và rê | Liên tục đổi đích theo vị trí con trỏ |
| Click trái nhân vật khác | Chọn mục tiêu |
| Chuột phải nhân vật khác | Mở menu Tỷ thí / Theo sau |
| Click trái quái mẫu | Phát lệnh đánh thường |
| Chuột phải quái mẫu | Dừng chạy và phát lệnh kỹ năng 2 |
| Chuột phải map | Dừng đường chạy hiện tại |
| Cuộn chuột | Zoom 1x–4x |
| G | Bật/tắt debug (ô bị chặn màu đỏ, ô người chơi đang đứng) |
| Nút tiến hóa | Tiến lên bậc tiếp theo; thao tác không thể đổi ngược |

## Tài khoản và nhân vật (tạm thời)

Chạy bằng `npm run dev`: đăng nhập chỉ với username, sau đó tạo hoặc chọn nhân vật để vào map. Mỗi username có tối đa 3 nhân vật; nhân vật có giới tính nam/nữ, loài gốc rắn và tiến hóa hiện tại được lưu trong `users.json`. Chuỗi tiến hóa hiện tại là Rắn → Rắn đỏ → Rồng; server chỉ cho tiến lên đúng bậc kế tiếp và không hỗ trợ đổi ngược. Dữ liệu được ghi qua middleware API của Vite dev server. Khi đọc dữ liệu lưu cũ, API chuyển trường chỉ số `armorPenetration` sang `armorPen` và giữ nguyên các chỉ số hiện có. Đây là lưu trữ tạm thời chỉ dùng khi chạy dev; `npm run preview`/static hosting chưa có API ghi file, và đăng nhập username không có xác thực mật khẩu.

## PvP local

PvP hiện chạy qua WebSocket của cùng Vite dev server và dùng chung một map trong tiến trình server. Mở `npm run dev` một lần rồi đăng nhập bằng hai username khác nhau trên hai trình duyệt/cửa sổ. Mỗi client tải vùng map quanh mình và các người chơi online để giữ terrain/collision đồng bộ khi họ đi xa nhau. Tên nhân vật tự hiển thị phía trên thanh máu; tên nhân vật của mình màu lam, người chơi khác màu trắng, đối thủ PK màu đỏ, với viền tối nhẹ để tăng độ tương phản. Trên máy khác trong cùng mạng LAN, chạy server với `npm run dev -- --host 0.0.0.0` và mở địa chỉ LAN của máy host; mạng/firewall phải cho phép cổng Vite. Một nhân vật chỉ có thể online ở một trình duyệt cùng lúc.

Chuột phải lên nhân vật online → **Tỷ thí** để gửi lời mời; người nhận chọn **Xác nhận** hoặc **Hủy**. Lời mời hết hạn sau 60 giây. Khi xác nhận, chỉ hai đối thủ thấy dấu PK; người chơi thứ ba vẫn thấy nhân vật như thường. Trong tỷ thí, click trái đối thủ đánh thường và chuột phải dùng skill 2. Đòn thường hồi chiêu 1 giây, skill 2 hồi chiêu 8 giây. Server tính sát thương theo `max(1, floor(attack × hệ số − max(0, defense − armorPen)))`, hệ số lần lượt là 1 và 1.5. Người hết HP trước thua; hai đòn kết liễu gần như đồng thời được xử hòa; hết 5 phút mà chưa ai hết HP thì hòa. Ngắt kết nối trong tỷ thí được tính là thua.

| Tiến hóa | HP tối đa | Tấn công | Phòng thủ | Xuyên giáp |
|---|---:|---:|---:|---:|
| Rắn | 1000 | 100 | 20 | 0 |
| Rắn đỏ | 1400 | 135 | 35 | 10 |
| Rồng | 1800 | 180 | 55 | 20 |

Các chỉ số và combat state được quản lý phía server dev; HP trong tỷ thí bắt đầu đầy mỗi trận. Đây là prototype local, chưa có mật khẩu/xác thực tài khoản hoặc bảo vệ cho triển khai Internet.

Sprite sheet tiến hóa dùng ô 128×128, 8 hàng theo thứ tự W, WD, D, SD, S, SA, A, AW và 8 frame mỗi hướng. Các ảnh `snake_idle.png`, `red_snake_idle.png` và `dragon_idle.png` lần lượt là Rắn, Rắn đỏ và Rồng; cấu hình nằm trong `SPRITE_EVOLUTIONS`. Bộ lọc nội suy của Phaser được bật để làm mịn ảnh PNG khi co giãn.

Nhân vật và quái trong bản mẫu phát sự kiện `target-selected` và `combat-command` trên event emitter của `GameScene`; lệnh chiến đấu có dạng `{ action: 'basic-attack' | 'skill-2', targetId }`. Đây là điểm nối cho hệ thống chiến đấu, chưa tự trừ máu hay thực hiện tỷ thí/theo sau.

Hiệu ứng click dùng `public/assets/sprites/click.png`, sprite sheet ngang 6 frame, mỗi frame 32×32px.

Con trỏ web dùng `public/assets/images/cursor.png`; chỉnh `CURSOR.scale` trong `src/config.ts` để đổi kích thước hiển thị. Điểm hotspot trong ảnh cũng được thu nhỏ theo cùng tỉ lệ.

Đặt `DEBUG=false` trong `.env` để ẩn/tắt debug trong game, chặn chuột phải và một số phím tắt DevTools/trang nguồn, đồng thời giữ con trỏ tùy chỉnh khi rê lên các nút giao diện. Đây chỉ là hạn chế thao tác phổ biến phía trình duyệt, không thể bảo vệ mã hoặc ngăn hoàn toàn DevTools; muốn bật debug thì đặt `DEBUG=true` hoặc xóa biến này rồi khởi động/build lại.

Game ghi `console.error` một lần nếu phát hiện chênh lệch kích thước cửa sổ thường gặp khi DevTools được dock. Đây chỉ là heuristic của trình duyệt: không phát hiện được mọi kiểu mở F12 (ví dụ DevTools tách cửa sổ) và có thể khác nhau theo browser.

## Cấu trúc

```
public/
  assets/
    maps/*.json              <- map Tiled nguồn (chọn MAP_URL trong src/config.ts)
    map-stream/<map-id>/     <- payload được sinh tự động, không commit
    tilesets/*.tsx           <- tileset external
    tilesets/*.png           <- ảnh tileset theo đường dẫn trong TSX
  assets/images/<map-id>.png <- ảnh mini-map sinh tự động từ map tương ứng
src/
  config.ts                <- MAP_URL, tốc độ, zoom...
  loaders/tilesets.ts      <- đọc .tsx / tileset embedded
  map/MapModel.ts          <- metadata, collision và BFS trong vùng đang tải
  map/ChunkManager.ts      <- tải, cache, loại response cũ, giới hạn vùng active
  map/StreamedMap.ts       <- kiểu dữ liệu manifest/cell
  entities/Player.ts
  scenes/{Boot,Game,UI}Scene.ts
tools/build-map-stream.mjs <- chuyển map nguồn thành manifest và cell payloads
```

## Thay map của bạn

1. Copy finite map vào `public/assets/maps/` và đổi `MAP_URL` trong `src/config.ts`.
2. Copy các `.tsx` + `.png` sao cho đường dẫn **tương đối từ map.json tới .tsx** và **từ .tsx tới .png** vẫn đúng (Tiled tự ghi sẵn).
3. Yêu cầu của map trong Tiled:
   - Orientation: **Isometric** hoặc **Staggered**; **không** bật Infinite.
   - Với Staggered, đặt Stagger Axis là X hoặc Y và Stagger Index là Odd hoặc Even.
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

Tile layer được vẽ từ GID của các cell active; `sorted`/`above`, opacity, tileset offset và các object tile được giữ theo metadata Tiled.

`npm run dev` và `npm run build` tự chạy `tools/build-map-stream.mjs`. Script sinh `public/assets/images/<map-id>.png` cho từng `public/assets/maps/<map-id>.json`; mini-map sẽ tải PNG tương ứng map đang chọn (ví dụ `thang-long.json` dùng `assets/images/thang-long.png`). Script cũng đọc `MAP_URL` để tạo `manifest.json` và các file `cells/x_y.json` cho map đang chạy trong `public/assets/map-stream/<map-id>/`. PNG được render từ tileset và toàn bộ tile layer, chỉ dùng làm ảnh thu nhỏ; client vẫn chỉ tải cell trong vùng stream, không tải full map nguồn hoặc các cell bên ngoài vùng. Cần Python 3 và Pillow để sinh PNG. Các ảnh PNG sinh ra không cần commit. Khi thêm hoặc sửa map, đặt đúng tileset paths rồi chạy dev/build để tạo lại ảnh và dữ liệu.

`MAP_STREAM_WIDTH_TILES` và `MAP_STREAM_HEIGHT_TILES` trong `src/config.ts` đặt chiều rộng và chiều cao vùng tải quanh người chơi, tính theo ô map. Ví dụ 17×11 tải tối đa 187 ô; với số chẵn, vùng lệch một ô về bên phải hoặc xuống dưới để có đúng kích thước chỉ định. Chỉ các ô trong vùng đang tải được dựng và dùng collision; vùng lớn hơn tạo nhiều request ô hơn. Mini-map vuông ở góc trên bên phải hiển thị PNG đã render toàn map mà không tải cell ngoài vùng stream, cùng vị trí người chơi (xanh dương), người chơi khác (trắng), đối thủ PK (đỏ) và NPC (vàng). Cuộn chuột trên mini-map để phóng to/thu nhỏ riêng bản đồ nhỏ; ảnh và marker được cắt trong khung UI, không tràn ra ngoài, và tâm hiển thị bám theo người chơi. Click ở bất kỳ đâu trên map sẽ tìm đường tới đích, stream các vùng tiếp theo dọc đường và tự tiếp tục. Object trong object layer được index vào mọi ô mà bounding box của nó giao nhau, sau đó client gộp theo layer/id để không vẽ hoặc va chạm trùng. Các texture tileset không bị gỡ khi vùng thay đổi. `CLOUD_COVER.clearWidthTiles` và `clearHeightTiles` đặt chiều rộng và chiều cao vùng không bị mây che; hai giá trị độc lập với kích thước tải map. Chỉnh `CLOUD_COVER.scale`, `spacing` và `alpha` để điều chỉnh mây; ảnh được lặp quanh viewport để che bên ngoài vùng active và lấn vào mép khoảng nửa ô. BFS click-to-move chỉ biết collision trong vùng hiện tại; hãy click tiếp khi đã di chuyển gần hơn tới đích. Khi vùng mới tải, vùng cũ vẫn hoạt động cho đến lúc vùng mới hợp lệ được áp dụng, tránh khoảng trống collision; response lỗi được thử lại và response cũ bị bỏ qua.

Để kiểm tra streaming trong Chrome DevTools → Network, bật **Disable cache**, tải lại game và lọc `map-stream`: ban đầu phải thấy `manifest.json` cùng tối đa `MAP_STREAM_WIDTH_TILES × MAP_STREAM_HEIGHT_TILES` file `cells/<x>_<y>.json`; không được có request tới JSON map nguồn. Di chuyển qua ranh giới tile sẽ chỉ yêu cầu các ô mới chưa có trong cache. Ở mép map, số request nhỏ hơn do tọa độ ngoài map bị loại.

## Lưu ý

- Đã xác minh build và chạy thử luồng tải trong trình duyệt với Phaser 4.2.1; map nguồn không xuất hiện trong Network.
- Tile layer `collides`/tile property `collides` và các rectangle/polygon của object layer đều được áp dụng khi collision; có thể đặt object layer `collides = false` để bỏ qua shape của layer đó.
- Map finite Isometric và Staggered cùng layer tile có `data` dạng mảng được hỗ trợ; infinite/chunked Tiled map và base64/zlib chưa được hỗ trợ.
