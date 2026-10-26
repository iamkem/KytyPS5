# G2-A — Scene Benchmark opt-in cho KytyPS5 Launcher (26/10/2026)

## Mục tiêu

Xây dựng phép đo **nhẹ và có thể lặp lại** cho FPS, 1% Low (native flip-interval), P99 frametime, render-thread CPU, `Kyty.Record` CPU trên NVIDIA RTX 5070, trước khi sửa Vulkan/indirect count. Đây là bước tiếp nối của `docs/G2_FRAME_BOTTLENECK_INVESTIGATION_2026-10-26.md`.

**Không tự launch game, tự đổi shader mode, thay save, xóa cache, chạy precompile, đi lại/script input, GPU trace hay memory poke.** Người dùng chủ động Play và bấm đo sau khi gameplay ổn định. Gameplay bình thường vẫn có thể autosave và cập nhật local shader caches — các hành vi có sẵn, không phải do benchmark quản lý.

## Sử dụng

1. Mở `launcher.cmd`, chọn **Options → Graphics → Scene Benchmark (15 s) → On**, chọn **Shader Translation Mode = Standard (0x0)** và **OK**. Tắt Frame Generation nếu muốn đo native FPS không bị nhầm với interpolated frames.
2. Tự nhấn **Play**. Cửa sổ **Scene Benchmark** xuất hiện, báo **Waiting...** cho đến khi nhận run-log đúng mode và có `LIVE_DONE` handshake từ native. Không bấm đo nếu chưa báo Ready.
3. Đến cùng một cảnh/camera/sao lưu save nếu cần. Đợi background shader warmup và first-use compilation ổn định. Nhấn **Measure 15 seconds**, quay về cửa sổ game trong 5 giây, giữ nguyên góc máy.
4. Sau 15 giây, panel hiển thị **Average FPS, 1% Low FPS, P99 frametime, Render CPU ms/frame, Record CPU ms/frame, Render busy, Frames, Frames ≥50 ms**.
5. Thực hiện ít nhất **3 mẫu** tại cùng cảnh. Thoát game bình thường, đổi Shader Translation Mode sang **Experimental (0x3)**, lặp lại các phép đo với graphics settings không đổi. Tốt hơn là hai vòng A–B–B–A ở cảnh tự nhiên thấp hơn giới hạn 60 FPS.
6. Dữ liệu raw được lưu riêng trong `_Build/scene-benchmark/session-<random>/results.jsonl`. Mỗi dòng gồm timestamp, mode, label, id và số đo/line `LIVE_COUNTERS`; gửi hai file Standard & Trial để phân tích. Không cần đo lại shader cache.

**Quan trọng**: Hai lần đã chơi vào 09:18 và 09:26 ngày 26/10/2026 chưa có `LIVE_MEASURE` và warmup không tương đương; không dùng chúng để chốt gain.

## Kiến trúc

- Default `scene_benchmark:false` trong `launcher-electron/logic.cjs`. Trường settings độc lập với shader_mode, presets, RAM/graphics.
- Chỉ khi `!steam && cfg.scene_benchmark`, main process tạo một thư mục độc lập `_Build/scene-benchmark/session-*`, đặt file `commands.txt` và truyền `-LiveControlFile` **cho subprocess PowerShell runner**.
- Mọi Play khác (kể cả Steam) truyền `-DisableLiveControl`, buộc xóa `KYTY_LIVE_FILE` khỏi runner environment kể cả khi launch JSON hoặc parent environment chứa key này. Parent Electron không tự bật benchmark; runner gán file đúng phiên sau khi đọc JSON và `-Set`.
- `launcher-electron/main.cjs::launchCommand()` vẫn drain stdout/stderr liên tục và vẫn tìm Discord PID độc lập. Từ runner stdout `pid N; logs: ...\\YYYYMMDD-HHMMSS-mmm.*.log`, bind **đúng** log Standard hoặc Trial, không chọn file mới nhất trên disk.
- `launcher-electron/scene-benchmark.cjs` chỉ đưa vào file command hai loại native command **không thay gameplay**: một `id N` để kiểm tra readiness (`LIVE_DONE`), và `sleep 5\nmeasure 15 label`. Nếu handshake không thành công sau các lần thử, panel hiện **Retry connection**; không tự chạy game. Command file được ghi vào tempfile riêng và rename sang `commands.txt` tránh native đọc payload một nửa.
- Native `src/local/live-control.h::Measure()` là nguồn sự thật của `LIVE_MEASURE`, `LIVE_COUNTERS`. Bộ đọc chỉ chấp nhận đúng command id và phiên log, tối đa 2 MiB mỗi lượt đọc, không tải nguyên log nhiều GiB. Thành công cần có `LIVE_MEASURE` hợp lệ và `LIVE_DONE` đúng id. Timeout, game exit, thiếu frames, session khác đều fail-closed; IPC renderer không cho đưa code tùy ý, không cho chọn path.
- Renderer window độc lập (khi main Launcher đang hidden), có Measure và kết quả trực quan. IPC từ cửa sổ khác bị từ chối ở `launcher:benchmark-capture`.
- Kết quả JSONL nằm dưới thư mục benchmark riêng, không ghi `_SaveData`, `_PipelineCache`, hay `_Build/shader-feature-trial/_PipelineCache`.

## Những gì kết quả không chứng minh

- `fps`, `low1`, `p99_ms`: đo **native flip**, không phải số frame do Frame Generation thêm hoặc số frame màn hình hiển thị thực.
- `render_ms` và `record_ms` là **CPU time per native flip**, không phải GPU time; chúng có thể overlap và không được cộng để ra frametime.
- FPS = 60 ở cả hai mode khi presentation cap 60 Hz **không chứng minh** hiệu năng shader bằng nhau. Chọn cảnh dưới 60 FPS hoặc chỉ ghi nhận cả hai đạt cap.
- Không so sánh benchmark khi background shader precompile/prefetch còn chiếm CPU lớn, cảnh/camera khác nhau, hoặc kích hoạt DLSS/FSR/FrameGen khác nhau.
- Thêm đo telemetry là cơ sở để quyết định G2-B CPU producer vs Vulkan recorder; **không phải** phê duyệt thay `vkCmdDrawIndexedIndirectCount` hay bỏ pipeline barrier.

## Kiểm thử

- `cd launcher-electron && npm test`: **92/92 PASS** (7 synthetic benchmark tests + các test Launcher khác).
- Electron Win64 package `launcher-electron/scripts/package-latest.ps1`: **PASS**.
- Packaged UI smoke `--smoke-ui`: **ELECTRON_SCENE_BENCHMARK_UI_PASS**, **ELECTRON_UI_SMOKE_PASS**, exit 0; không chạy game.
- PowerShell runner `-DryRun` với `-DisableLiveControl` cùng inherited env: **không có KYTY_LIVE_FILE**; với `-LiveControlFile <absolute path>`: **đúng file**; parse 0 errors. Standard/Trial đều đi cùng code path.
- **Chưa** kiểm tra full end-to-end trong game thực. User sẽ chủ động Play sau khi có thời gian test. Đóng panel trong lúc game chạy sẽ **minimize**, có thể mở lại từ taskbar.

Source: `run-windows.ps1`, `launcher-electron/scene-benchmark.cjs`, `benchmark.html`, `benchmark.js`, `main.cjs`, `preload.cjs`, `logic.cjs`, `options.html`, `options.js`, `style.css`, `tests/scene-benchmark.test.cjs`.
