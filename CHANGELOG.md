# Lịch sử thay đổi / Changelog

## v1.0.1

**Tiếng Việt**
- Thêm `platform` (chọn integration nguồn, chuỗi hoặc danh sách) và "hợp đồng" entity cho integration khác.
- Không có pfSense thì ISP nối thẳng switch lõi (tốc độ lấy từ `wan` hoặc `core.ports`); thêm `isp.enabled` / `pfsense.enabled`.
- Switch khai báo tay có `ports` (`rx`, `tx`, `status`) nên mở được danh sách thiết bị.
- Cảnh báo mất kết nối cho ISP, pfSense, switch lõi và các switch; bấm node hoặc dòng cảnh báo để mở more-info.
- Tối ưu: chỉ dựng lại sơ đồ khi entity liên quan đổi; card ngoài màn hình hoặc tab ẩn cập nhật 5 giây/lần; zoom bằng con lăn và kéo node gộp theo frame; cache icon.
- Header gọn trên điện thoại (3 hàng dưới 560px, 2 cột ô thống kê dưới 400px), lề card giảm còn 8px dưới 600px.
- Zoom lưu theo từng thiết bị và theo `layout_id`/`title`; đổi `zoom` trong config thì config thắng.
- Sửa lỗi: option để trống không đè mặc định (cả `alerts`, `floors`, `auto`); tự xoay không chọn lại ngay khi đóng hết switch nên `pause_on_tap` có tác dụng; nạp file hai lần không làm card chết và `customCards` không nhân đôi; editor giữ `crit ≥ warn` khi kéo slider; sensor chưa có state không còn làm mất baseline cả ngày; bố cục chỉ nạp lại khi `layout_id`/`title` đổi; sửa option trong editor không đặt lại zoom đang dùng; registry lỗi thử lại sau 30 giây thay vì 10 phút; sparkline vẽ lại khi dữ liệu đổi; nhãn editor còn chữ AP đã đổi thành switch.
- Dọn code: bảng luật kiểm tra config (`RULES`), gộp hàm đọc/ghi layout, gộp CSS trùng, xóa hàm và biến thừa.

**English**
- Added `platform` (choose the source integration, string or list) and the entity "contract" for other integrations.
- Without pfSense the ISP connects straight to the core switch (speed from `wan` or `core.ports`); added `isp.enabled` / `pfsense.enabled`.
- Manual switches can declare `ports` (`rx`, `tx`, `status`) and so open a device list.
- Connection-lost alerts for ISP, pfSense, core switch and switches; click the node or the warning line to open more-info.
- Performance: the diagram is only rebuilt when a relevant entity changes; off-screen or hidden-tab cards refresh every 5 seconds; wheel zoom and node drag coalesced per frame; icon cache.
- Compact phone header (3 rows below 560px, 2-column stat tiles below 400px), card padding reduced to 8px below 600px.
- Zoom saved per device and per `layout_id`/`title`; changing `zoom` in the config makes the config win.
- Fixes: empty options no longer override defaults (also `alerts`, `floors`, `auto`); auto-rotate no longer re-selects right after the last switch is closed, so `pause_on_tap` works; loading the file twice no longer breaks the card or duplicates `customCards`; the editor keeps `crit ≥ warn` while dragging sliders; a sensor without state no longer loses the baseline for the whole day; the layout only reloads when `layout_id`/`title` changes; editing an option in the editor no longer resets the zoom in use; a failed registry load retries after 30 seconds instead of 10 minutes; the sparkline redraws when data changes; leftover AP wording in the editor now says switch.
- Code cleanup: config rule table (`RULES`), merged layout read/write helpers, merged duplicate CSS, removed unused functions and variables.

## v1.0.0: bản phát hành đầu tiên / first release

**Tiếng Việt**
- Sơ đồ cây ISP → pfSense → switch lõi → switch → cổng có thiết bị, vẽ ngang hoặc dọc, đường flow chuyển động theo băng thông thật.
- Kéo thả mọi node (kể cả switch), ghim cột thiết bị bằng cách kéo tiêu đề (bấm đúp để bỏ ghim), cột switch lõi mở/đóng độc lập, đường flow vào cổng từ cạnh bên, bố cục lưu theo người dùng HA.
- Giao diện Glass/Neon, `node_opacity`, zoom, toàn màn hình, tìm kiếm cổng, ô Speedtest ở header.
- Cổng thông minh: tự đặt tên từ mô tả cổng, `port_names`, ẩn switch/cổng, `isp.ip` và `pfsense.ip` hiện IP ở dòng 2.
- Cảnh báo lưu lượng glow vàng/đỏ, tự động xoay qua từng switch.
- Hỗ trợ switch yếu không chạy được qua integration bằng sensor SNMP YAML (switch thêm tay).
- Trình chỉnh sửa trực quan, không bắt buộc cấu hình YAML.

**English**
- Tree diagram ISP → pfSense → core switch → switches → ports with devices, horizontal or vertical, animated flow lines driven by real bandwidth.
- Drag every node (switches included), pin device columns by dragging the header (double-click to unpin), independent core switch column, flow lines entering ports from the side, layout saved per HA user.
- Glass/Neon styles, `node_opacity`, zoom, fullscreen, port search, Speedtest tile in the header.
- Smart ports: names from port descriptions, `port_names`, hide switches/ports, `isp.ip` and `pfsense.ip` show IPs on line 2.
- Yellow/red traffic glow alerts, auto-rotate through switches.
- Support for weak switches that cannot run through the integration, using YAML SNMP sensors (manual switches).
- Visual editor, no mandatory YAML.
