# Lịch sử thay đổi / Changelog

## v0.2.0

**Tiếng Việt**
- Mọi switch kéo thả được, khung sắp xếp phủ toàn bộ sơ đồ.
- Cột thiết bị của mọi switch ghim được bằng cách kéo tiêu đề; bấm đúp để bỏ ghim.
- Cột switch lõi mở/đóng độc lập với các switch khác.
- Đường flow đi vào cổng từ cạnh bên, không cắt ngang các khối khác.
- Node gọn hơn: dòng 2 chỉ hiện IP; model, số cổng, ping, CPU/RAM chuyển vào tooltip.
- Thêm `node_opacity` để đường flow không lộ xuyên qua chữ.
- Sửa tên cổng cho các switch mà entity cổng chỉ có sensor throughput (ví dụ TP-Link SG2210P).
- Thêm `isp.ip` và `pfsense.ip` để hiện IP WAN/IP thiết bị ở dòng 2.
- Thêm ô Speedtest ở header (`speedtest.down` / `up` / `ping`).
- Tự động xoay ghi thống nhất là *switch* thay vì *AP*.

**English**
- Every switch is draggable; the arrange frame covers the whole diagram.
- Device columns of every switch can be pinned by dragging the header; double-click to unpin.
- Core switch column opens/closes independently.
- Flow lines enter ports from the side.
- Cleaner nodes: line 2 shows only the IP; model, port count, ping and CPU/RAM moved to the tooltip.
- Added `node_opacity`.
- Fixed port names for switches whose port entities only have throughput sensors (for example TP-Link SG2210P).
- Added `isp.ip` and `pfsense.ip`.
- Added a Speedtest tile in the header.
- Auto-rotate wording now says *switch* instead of *AP*.

## v0.1.0

- Phát hành lần đầu / Initial release: sơ đồ cây ISP → pfSense → switch lõi → switch → cổng, đường flow chuyển động, cảnh báo lưu lượng, tự động xoay, Glass/Neon, trình chỉnh sửa trực quan.
