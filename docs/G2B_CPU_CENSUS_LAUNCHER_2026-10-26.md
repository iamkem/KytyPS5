# G2-B — Opt-in PM4 / Table XPR CPU Census, KytyPS5 Launcher — 2026-10-26

## Quyết định

**GO** cho phép đo nhẹ, thủ công bằng native `LIVE_CENSUS`. **NO-GO** cho sửa Vulkan/renderer hay nâng shader features `0x3` thành mặc định trước khi có timed hotspot và workload-matched A–B–B–A. Đây là bước tiếp nối `docs/G2_AB_SCENE_BENCHMARK_RESULTS_2026-10-26.md`.

Dữ liệu G2-A đã có 3x15 giây cho mỗi mode, RTX 5070:
- Standard: FPS 44.47, 1% low 36.26, render CPU 20.68 ms/flip.
- Experimental: FPS 47.45, 1% low 39.06, render CPU 19.85 ms/flip.
- +6.7% FPS quan sát được **không thể quy về shader 0x3**: Trial có ít hơn ~3.85% `table_draws` và ít hơn ~46% `table_ring_bytes` mỗi native flip. Nhìn chung `render_busy` là 92–94%; `record_wait_us` chỉ khoảng 1–2 µs/flip, synchronous readback counters gần 0 theo độ chính xác hiển thị.

## Triển khai

Cửa sổ Scene Benchmark (chỉ xuất hiện khi **Options → Graphics → Scene Benchmark (15s) = On** và người dùng bấm **Play**) có hai phép đo thủ công, không chạy đồng thời:

1. **Measure FPS (15s)**: giữ nguyên phép đo `LIVE_MEASURE` và kết quả `results.jsonl`.
2. **Profile CPU (5s)**: khi game đã sẵn sàng (native `LIVE_DONE` handshake), người dùng bấm nút mới, trở về game trong 5 giây; main process ghi duy nhất
   ```
   id <unique id>
   sleep 5
   census 5
   ```
   vào file lệnh riêng của phiên, qua cơ chế temporary-file + rename sẵn có. Không cung cấp raw command/payload/path/duration cho renderer.

Native `src/local/live-control.h` đã có `census 5`, không cần thay binary / rebuild shader. Kết quả gồm `LIVE_CENSUS` header, nhiều `LIVE_CENSUS_ENTRY`, `LIVE_DONE`, tất cả khớp **đúng id trong log do runner khởi động**.

Backend phân tích key 64-bit `a`/`b` dưới dạng chuỗi hex, giới hạn 32.768 entries, từ chối sai id, trùng key/header, dữ liệu âm/NaN/không hợp lệ, `LIVE_ERROR`, không có entry, dưới 2 frames, timeout hoặc kết thúc phiên trước khi hoàn tất. Với kết quả hợp lệ:
- `_Build/scene-benchmark/session-*/census-<id>.json` — **đầy đủ entries**, metadata native frame count, module path/base, mode, log, pairedMeasurementId (FPS sample gần nhất trong cùng phiên, nếu có).
- `_Build/scene-benchmark/session-*/census-results.jsonl` — metadata + top 12 scopes theo ms/frame.
- Panel hiển thị top 8 entries, calls/frame, ms/frame và cảnh báo về overlapping scopes. Kết quả FPS và CPU census hoàn toàn độc lập.

**Cơ chế an toàn:** cùng session command file riêng, gated opt-in, renderer IPC chỉ có `benchmarkCensus()` không tham số, chỉ cho benchmark window được gọi, từ chối census hoặc measure khi readiness probe / một phép đo khác đang chạy. Không thực hiện input simulation, GPU profiler, memory poke, save/cache management, pipeline precompile, game auto-launch hay đổi settings. Game chơi bình thường vẫn có thể ghi save/cache theo cơ chế sẵn có.

## Ý nghĩa thực tế của census

`LIVE_CENSUS` là **thời gian elapsed scope trên render thread, tính ms per native game flip**, không phải GPU execution, không phải CPU-exclusive time; waits/preemption và nested scopes có thể overlap. **Không cộng tổng những scope khác loại để tuyên bố frame cost.**

Các kind quan trọng:
- `9 QueueRun`: toàn bộ run PM4 inclusive (không phải chỉ chi phí PM4 parsing).
- `12 DrawPhase`: phân tích các giai đoạn Table XPR, cũng bao gồm các phase normal-path.
- `2 NativeXpr`; `7 GraphicsPrograms`; `11 CommandSync`; `4/5/6` GPU wait/readback wait/sync download.
- Table XPR synthetic key `a=0x7ab1e` / `a=0x7ab1f`; `b` low byte là phase (queue flag ở bit 63/62 cần giữ nguyên).
- Table draw phase 1 = Evaluate+Gather, 2 = Set, 3 = BDA/Blocks, 4 = Emission, 9 = Arguments/Indices; 5/6/7 là nested buffer resolve, clean reproof, set validation. Phase 0 là inclusive wrapper nhưng **TableContinue bypass**, không trừ kiểu exclusive.
- `table_ring_copies/bytes` chỉ phản ánh lượng copy; muốn chứng minh bottleneck cần kết hợp phase 3/5 và đo timer hẹp nếu census chỉ ra.

Giới hạn native: `census` dùng TSC và bảng 32.768 entries, không có overflow count; có khoảng 100 ms heuristic drain sau tắt scope chứ chưa có atomic render-thread ack. Native clamp frames từ 0 lên 1; Launcher từ chối captures chỉ có 1 frame. Công cụ này là triage profiling, không thay Nsight/ETW profile độc lập nếu cần xác minh sâu.

## Kịch bản test user

1. Mở `C:\Users\hoang\Desktop\dev\KytyPS5\launcher.cmd`, giữ **Scene Benchmark On**.
2. Vào **Standard 0x0**, đứng tại đúng cảnh/góc camera Boletaria 1-1, đợi background warmup.
3. **Measure FPS (15s)** → **Profile CPU (5s)** → **Measure FPS (15s)**; mỗi nút sau khi báo Ready, chuyển focus về game trong 5 giây.
4. Nếu hợp lý, so sánh lại Experimental `0x3` đúng cùng vị trí/camera; ưu tiên kiểm tra cùng logical table draws/flip.
5. Gửi `census-results.jsonl` và `census-*.json` của mỗi phiên, cùng `results.jsonl`. Chưa tiến hành GPU-bound performance run tự động.

## Kiểm thử tại thời điểm hoàn thành

- `cd launcher-electron && npm test`: **97/97 PASS** (5 census-specific tests + 92 tests sẵn có). Synthetic native log, không game.
- `node --check` main, preload, benchmark.js, scene-benchmark.cjs: PASS.
- `launcher-electron/scripts/package-latest.ps1`: Windows Electron package PASS.
- Packaged `DemonsSoulsLauncher.exe --smoke-ui`: **ELECTRON_SCENE_BENCHMARK_UI_PASS**, kiểm tra cả hai nút khi chưa có game đều disabled; **ELECTRON_UI_SMOKE_PASS**, exit code 0.
- **Không** chạy gameplay/census thực trong lượt tích hợp, kết quả G2-B thực tế chưa có. Cache gốc và trial vẫn nguyên trạng.

Source: `launcher-electron/scene-benchmark.cjs`, `benchmark.html`, `benchmark.js`, `main.cjs`, `preload.cjs`, `style.css`, `tests/scene-census.test.cjs`, `tests/scene-benchmark.test.cjs`.

Read-only independent technical reviews: `agt_6a06dfb7`, `agt_f2e8d126`, `agt_71312fec`.
