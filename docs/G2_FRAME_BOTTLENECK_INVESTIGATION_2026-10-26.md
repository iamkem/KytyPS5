# G2 — Điều tra đường xử lý frame KytyPS5 / RTX 5070 (26/10/2026)

**Trạng thái:** hoàn tất nghiên cứu tĩnh + phân tích log hiện hữu. **NO-GO đối với tối ưu Vulkan chưa đo đạc**; **GO đối với phép đo A/B nhẹ do người chơi chủ động thực hiện**. Không chạy game, precompile, profiler GPU hạng nặng, sửa cache/save hay chỉnh mã renderer trong nghiên cứu này.

Checkout: `C:\Users\hoang\Desktop\dev\KytyPS5`, HEAD khảo sát `0985d035`. Ba Codex subagents đọc/review/báo cáo: `agt_9148d9c8` (CPU/recording), `agt_e6ae350f` (count-indirect/readback), `agt_ede39c8f` (A/B methodology).

## 1. Dữ liệu thực tế

| Tính chất | Standard 0x0 | Experimental 0x3 |
|---|---:|---:|
| Log | `_Build/run-logs/20261026-092622-023.out.log` | `_Build/shader-feature-trial/run-logs/20261026-091822-227.out.log` |
| RTX GPU | GeForce RTX 5070 | GeForce RTX 5070 |
| Translator active | 0x0, cảnh báo `Translation features 0x3 off` | 0x3, `Shader feature trial: isolated cache ... features 0x3` |
| Guest render / output | 1920×1080 / 3840×2160 | 1920×1080 / 3840×2160 |
| Presentation | Giới hạn 60 Hz | Giới hạn 60 Hz |
| Warmup inputs / recipes | 10.316 / 10.407 | 1.419 / 1.348 |
| Warmup shader duration | khoảng 55,924 giây | khoảng 4,246 giây |
| Static binary hits | 2.526 | 2.428 |
| Static store misses | 1.264 | 152 |
| Binary bị driver từ chối | 0 | 0 |
| First-use shader translation | 17 programs / 84 ms tổng | 12 programs / 227 ms tổng |
| First-use pipeline compile | 900 pipelines / 1.192 ms tổng | 190 pipelines / 189 ms tổng |
| `SLOW Frame` threshold entries | 13 | 7 |
| `LIVE_MEASURE` / `LIVE_COUNTERS` | **0** | **0** |

**Cảnh báo so sánh:** phiên Standard tồn tại trong log khoảng 82 giây, Trial khoảng 322 giây; cảnh, camera, số frame trong vùng benchmark, thời gian warmup, played-pipeline coverage **không được khớp**. Các tổng số là số sự kiện trên **toàn phiên**, không phải per-second/per-frame hay bộ số liệu đối chứng. Không suy ra mức tăng FPS/1% low từ 7 so với 13 slow-frame events. Đặc biệt, giới hạn 60 Hz che giấu mọi cải tiến vượt điểm cap.

SLOW Frame phản ánh **mẫu vượt ngưỡng**, không phải phân phối frametime. Trong đó 8/13 Standard và 6/7 Trial có trường `idle` chiếm ít nhất 80% frame (render thread chờ việc; không đủ để quy lỗi GPU). Những event còn lại chủ yếu gắn với compile; ví dụ Standard `344.7 ms, compile=262.4 ms`, Trial `178.5 ms, compile=147.6 ms`. Một event Standard `144.9 ms` có `compile=107.6`, `record_wait=93.4`, `upload_wait=105.5`; **các scope này chồng lấn, không được cộng với nhau**. Đây là bằng chứng có hitch do pipeline creation/upload/worker tại thời điểm cụ thể, **không** chứng minh steady-state Vulkan recording là nút thắt.

## 2. Nút thắt ứng viên: đường guest producer → Vulkan recorder → GPU

- `src/graphics/guest_gpu/graphicsRun.cpp::ThreadRun`: một host render/translation owner tiêu thụ guest graphics/compute, giải mã PM4, giải quyết resource/table và chuẩn bị lệnh. Guest async queue **không tự động** đồng nghĩa với đa luồng dịch lệnh host.
- `src/local/table-xpr.inc::TableDraw`: TableEvaluate, TableGather, TableSet, tra cứu resource và chuẩn bị BDA/arguments đều đứng trước Vulkan emission; một số cảnh có hàng ngàn draw/table evaluations per frame.
- `src/local/vulkan-recording.cpp`: một `Kyty.Record` worker replay tuần tự stream lệnh; có thể producer đợi full queue hoặc explicit drain. Thời gian CPU record không bằng GPU execution time.
- `src/graphics/host_gpu/renderer/commandScheduler.cpp::ReplaySubmit`: đợi upload sequence, kết thúc command buffers, giữ graphics queue mutex, gọi QueueSubmit và cập nhật driver tick. GPU readback wait có thể bao gồm toàn bộ backlog producer/replay/upload/submit/GPU; bản thân elapsed wait không xác nhận GPU saturation.
- `CompleteDispatch`/`CompleteDraws` dùng adaptive batching và `eAllCommands → eAllCommands` dependency tại boundaries. Source có lời bình benchmark lịch sử cho GPU idle/worker overhead; **chưa đo được chi phí hiện tại trên RTX 5070**. Không xóa barrier hoặc thay batch mặc định theo phỏng đoán.

**Kết luận:** steady-state latency trên serial render-producer → recorder → GPU chain vẫn là **giả thuyết ưu tiên**, chưa định danh stage. Cần `render_ms`, `record_ms`, `render_busy`, `low1` trên một cảnh đối chứng trước; tiếp đó mới `census`/short `trace` nếu có ích. Render/record CPU time có thể trùng nhau, **không cộng chúng thành frame time**.

## 3. G2.1 — Count-indirect CPU readback: thực sự có nhánh nhưng chưa có tần suất

Source:

- `src/graphics/guest_gpu/command_processor/pm4Handlers.cpp::CpOpDrawIndirectMulti` đọc bit 30 `count_indirect` của packet word 3, `max_count_or_count` ở word 4, địa chỉ count ở word 5–6.
- `src/graphics/guest_gpu/graphicsRun.cpp::DrawIndirectMulti` (khoảng dòng 1624): khi count address non-null, gọi `SyncGpuCleanBacking(addr, 4)`, CPU dereference, clamp; chỉ sau đó thử GPU indirect arguments. Trường hợp maximum zero vẫn có thể đi qua sync.
- `src/kernel/memory.cpp::SyncGpuCleanBacking` (khoảng dòng 1296): có nhiều fast exit khi không có GPU range/read watchers hoặc không dirty; **sync được gọi không có nghĩa GPU wait**. Nếu GPU-dirty thì `BufferCache::ReadMemory` có thể download rộng hơn 4 byte (cửa sổ dirty gần 512 KiB), dẫn tới chờ driver/transfer/graphics timeline.
- `src/graphics/guest_gpu/graphicsRun.cpp::TryGpuIndirectDraw` đã dùng GPU-resident argument buffer cho fixed-count khi đáp ứng các kiểm tra mapping, alignment, primitive/topology, bounds/ownership.
- Vulkan renderer hiện dùng `vkCmdDrawIndirect`/`vkCmdDrawIndexedIndirect` fixed-count; không bật feature `VkPhysicalDeviceVulkan12Features::drawIndirectCount`.

**Không thấy** `pm4`, `LIVE_CENSUS`, `SYNC-STACK` hay telemetry riêng cho count-indirect trong các log ngày 26/10. Do đó chưa thể gọi đây là confirmed bottleneck.

### G2.1 — Đề xuất đo trước khi sửa

1. Thêm opt-in fixed counters vào PM4 parse: packet totals indexed/non-indexed, count-indirect bit, zero/null-count-address, max/count distribution.
2. Scoped count-readback ở `DrawIndirectMulti`: đếm GPU-dirty, sync branch outcome, copied bytes, actual wait time và count clamp/zero. Không in từng packet, không phát sinh extra guest reads.
3. Phân biệt GPU-args success/CPU fallback và lý do fallback; dùng existing `LIVE_COUNTERS` xuất per-frame.
4. **Chỉ GO cho `vkCmdDraw*IndirectCount`** khi đo thấy dirty count readback lặp lại với ms/frame đáng kể và chứng minh guest/host ordering, count-buffer usage/alignment/lifetime, max count, index/start-instance semantics, Vulkan feature support, image-equivalence.

Vulkan `VK_KHR_draw_indirect_count` được nâng vào core Vulkan 1.2; `drawIndirectCount` feature phải bật, count buffer phải hợp lệ. Đó là API option, **không phải bằng chứng game đang được lợi**.
Nguồn: https://docs.vulkan.org/guide/latest/extensions/VK_KHR_draw_indirect_count.html

## 4. G2.2 — Đo đạc không thay mã nguồn

`src/local/live-control.h::Measure` đã in `LIVE_MEASURE` gồm `fps`, `render_ms`, `record_ms`, `render_busy`, `low1`, `p99_ms`, `max_ms`, `over50`, `over100`; và `LIVE_COUNTERS` per-frame. Chỉ chạy khi có `KYTY_LIVE_FILE`.

**Quan trọng:** `tools/local/bench-windows.py live` hardcode command file `_Build/windows-bench/live-commands.txt` và chỉ đọc Standard `_Build/run-logs`; **không dùng nguyên helper này để đo Trial**. Cũng không dùng `prepare/reset/restore`, `ab-spot.ps1` hoặc `bench-run.ps1` cho phép đo thủ công: chúng có thể move/swap save, mô phỏng input, dùng debugger memory poke hoặc tự chạy chương trình.

Lộ trình an toàn người chơi chủ động thực hiện:

- Khởi động một Launcher mới từ PowerShell đặt `KYTY_LIVE_FILE` đến **một file lệnh riêng trong `$env:TEMP`**, không set vĩnh viễn. Đóng Launcher cũ trước khi đặt env vì app dùng single-instance lock. Tự Play một chế độ, đến **cùng save/scene/camera**, để game settle sau warmup.
- Từ một PowerShell riêng ghi nguyên văn `id <milliseconds UTC>\nsleep 5\nmeasure 15 std1\n` (Trial: `trial1`) vào file lệnh. File này chứa **chỉ sleep+measure**, không có `poke32`, `glide`, `pad`, `prepare`, `reset`. Trở lại game trong 5 giây.
- Kiểm tra `LIVE_MEASURE`, `LIVE_COUNTERS`, `LIVE_DONE` đúng id ở log phiên đang chạy: Trial `_Build/shader-feature-trial/run-logs`, Standard `_Build/run-logs`. Dùng 3 cửa sổ 15 giây cho mỗi mode; ưu tiên một spot naturally below 60 FPS. So sánh A/B/B/A, không chạy song song.
- Nếu fps cùng chạm 60, ghi nhận là **censored by 60 Hz cap**, vẫn so sánh CPU render/record và slow tail có chú thích; đừng kết luận zero GPU gain.
- Nếu còn mơ hồ, chạy `census 5` dưới opt-in file riêng, sau đó mới cân nhắc short `trace`. `prof`/Nsight GPU Trace tác động lớn hơn lên CPU/RAM và chưa cần dùng. Nsight GPU Trace có ngân sách capture bộ nhớ riêng cỡ GiB nên tránh trên PC từng BSOD vì memory pressure.

### Khi đã có A/B metrics, đọc tín hiệu như sau

| Tín hiệu | Hướng điều tra |
|---|---|
| `render_ms` lớn, `record_ms` thấp, `render_busy` cao | Guest producer: PM4/table evaluations, resource lookup, shader/first-use CPU work |
| `record_ms` lớn, `render_ms` thấp, FPS dưới cap | Recording worker / Vulkan driver CPU |
| `render_ms` và `record_ms` cùng thấp, frame time cao | Guest frame pacing, wait, GPU/present, sync; cần census/timeline, không khẳng định GPU-bound |
| `compile` spikes/low1 thấp khi vào cảnh mới | Shader/pipeline first-use, warmup coverage |
| `SyncReadsRender` và `ReadbackWait` có ms/frame cao | Sau đó phân loại GPU dirty / count-indirect / SRT với counters cụ thể |
| FPS = 60 nhưng CPU headroom khác nhau | Cap đang che kết quả; chọn scene nặng tự nhiên dưới 60 |

Các chỉ số chỉ là **triage**, không phải chứng minh causality. CPU render/record đồng thời có thể overlap.

## 5. Roadmap GO/NO-GO

| Bước | Nội dung | Quyết định |
|---|---|---|
| G1 | Biên dịch/kiểm chứng trial 0x3 | **DONE technical**, chưa có measured FPS/1% low GO |
| G2-A | A/B live `measure` 15s, cùng scene và HUD settings | **GO**, game do user chủ động khởi động |
| G2-B | Thu `census`/trace nhẹ nếu producer/worker/sync chưa rõ | **GO có điều kiện** |
| G2-C | Thêm opt-in readback/count-indirect counters | **GO design**, chỉ triển khai sau khi cần bổ sung telemetry |
| G3 | Sửa `vkCmdDraw*IndirectCount`, barrier, batching hay worker | **NO-GO** khi chưa chứng minh hotspot |
| G4 | Test hình ảnh/FPS/low1/VRAM cùng scene | Sau G2 và một patch hẹp |

**Không hồi sinh** model/instance fade, SSR64, density7, force shadow LOD, speculative pipeline reuse hay blanket barrier removal — các hướng đã có NO-GO ở `docs/PROJECT_STATUS.md`.

Nguồn bổ sung cho phép đo CPU/GPU khi cần: https://docs.nvidia.com/nsight-graphics/UserGuide/expected-workflow.html và https://docs.nvidia.com/nsight-graphics/UserGuide/gpu-trace-overview.html (tài liệu API/công cụ, **không phải benchmark RTX5070 trên KytyPS5**).
