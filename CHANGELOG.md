# Lịch sử thay đổi / Changelog

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
