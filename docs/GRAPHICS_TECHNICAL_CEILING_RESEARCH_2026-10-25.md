# KytyPS5 / Demon's Souls Remake — Nghiên cứu giới hạn kỹ thuật đồ họa

**Ngày:** 2026-10-25
**Checkout:** `C:\Users\hoang\Desktop\dev\KytyPS5`; branch `integration/chenxiao-v20261023b-20261023`; HEAD khi kiểm tra `3c369ecb`.
**Nền tảng mục tiêu:** RTX 5070 12 GB / Demon's Souls PPSA01341 1.07.
**Phạm vi:** read-only review mã nguồn, tài liệu Git và log đã có; không chạy game, shader precompile, GPU capture; không sửa game, save, cache hay cấu hình.
**Independent reviews:** DevSpace Codex `agt_690b415b` (scheduler/indirect count), `agt_e1754a89` (shader), `agt_5f98b7ef` (fidelity). Copilot `agt_a3ba63be` thất bại `PROVIDER_EXECUTION_ERROR`, thay bằng Codex; không tính là kết quả review.

## 1. Kết luận và phân biệt ba loại giới hạn

- **Giới hạn hiệu năng FPS ổn định:** chưa đo được critical path thực tế trên RTX 5070. DLSS 720p gần TAA 1440p là tín hiệu phù hợp với CPU/recording/synchronization-bound hoặc giới hạn hiển thị 60 Hz, **không phải proof**.
- **Giới hạn stutter:** pipeline creation/translation first-use và background warmup còn tồn tại. Cache hiện tại đã dùng `VK_KHR_pipeline_binary`, cache `.table.bin`, warmup/prefetch. Ba log 16:05/16:08/16:12 ghi gần 10.3K shader permutations / ~55 s và first-use ~1.1K pipeline.
- **Giới hạn độ chính xác hình ảnh:** game giữ assets và hiệu ứng, nhưng renderer chưa được nghiệm thu ngang PS5; alternate PS5 Pro path dùng DLSS/FSR chứ không chứng minh tương đương native PS5 Pro reconstruction. Không kết luận hình ảnh là tốt/xấu nếu không có matched screenshots/videos.

## 2. Những tối ưu đã làm — không tái triển khai

`docs/GPU-DRIVEN-XPR.md`: GPU-driven Table XPR/TableDispatch, V# direct-map, SRT prefetch, region epoch, index/argument cache, TableSet validation, async pipelines, table driver cache. Trước đây native ~45.1 và Table ~52.4–52.6 FPS ở Boletaria 1-1 trên test PC khác; không phải lợi ích tiềm năng cộng thêm cho RTX 5070.

`docs/PROJECT_STATUS.md`: NO-GO cho model/instance fading (combined hỏng hình), geometry density 8→7 (không thấy FPS gain), virtual/light occlusion convars (không giảm PM4 draw packets), force shadow LOD (mất geometry), ready-pipeline-reuse, SSR64/particle/contact bundle, và re-enable index-buffer culling. Không khôi phục các công tắc này.

## 3. Phát hiện mới/còn thực tế trong source

### A. Renderer batch boundaries có dependency rộng — **GO để đo; NO-GO sửa ngay**

`src/graphics/host_gpu/renderer/commandScheduler.cpp` `CompleteDispatch()` và `CompleteDraws()`: khi chốt batch, `eAllCommands → eAllCommands` + memory read/write dependency, sau đó `Flush()`. Mã đã điều chỉnh batching dựa trên `GpuBusy()` và giới hạn độ dài; các thử nghiệm cũ còn cho thấy GPU submission cost và CPU recording-worker cost. Candidate là *narrow sync theo dependency thực*, không phải xóa barrier.

- Đo: `tracem`/GPU timestamps hoặc một short GPU Trace khi máy ổn định; quy thời gian idle về đúng boundary.
- Bắt buộc bảo toàn RAW/WAR/WAW, buffer aliasing, BDA indirect accesses, upload tails, compute chain.
- Không suy lợi ích từ thử nghiệm bỏ upload/copy pre-barrier trước đây: `docs/GPU-DRIVEN-XPR.md §3.12` đã cho thấy FPS không đổi.

### B. GPU-produced indirect draw-count bị kéo về CPU — **GO nếu phổ biến và nằm trên critical path**

`src/graphics/guest_gpu/graphicsRun.cpp::DrawIndirectMulti()`: `SyncGpuCleanBacking(count_addr)`, đọc `*count_addr` trên CPU, clamp với `max_count_or_count`, mới sau đó thử `TryGpuIndirectDraw(...)`. Nếu GPU sở hữu count buffer, đây là GPU→CPU→GPU dependency có thể tránh bằng indirect-count tương đương.

- **Chưa có dữ liệu** chứng minh tần suất hay stall cost của nhánh `count_addr != nullptr` trong cảnh hiện tại.
- Gate: đếm số lần count GPU-owned, CPU sync/readback time và phân bố scene; chỉ sau đó xét `vkCmdDraw*IndirectCount`/compatible conversion.
- Semantics cần giữ: clamp/zero count, stride, per-draw start instance, argument offsets, index bounds, address ownership; fallback trường hợp không thể biểu diễn.

### C. Shader wave64 trên subgroup32: feature source có nhưng cache ngăn dùng — **HIGH-VALUE RESEARCH, chưa GO ép bật**

`src/graphics/shader/recompiler/frontend/translate/Translate.h`: `TranslatorFeatureCooperativeHalves=0x1`, `TranslatorFeatureTableSlotsAtUse=0x2`. `src/graphics/host_gpu/renderer/pipeline/pipelineCache.cpp::InitializeStaticCache()` giữ feature set khớp static store để không khiến pipeline trong kho trở thành unusable; `src/graphics/presentation/window/vulkanWindow.cpp` hỗ trợ cooperative-halves trên NVIDIA.

Ba logs 2026-10-25 16:05/16:08/16:12: `Vulkan compute wave64: emulated on 32-lane subgroups` và `Translation features 0x3 off: the static pipeline store was made without them`. Vì vậy hai tính năng trên **không được áp dụng ở mặc định hiện tại**. Feature `NativeFloatMinMax=0x4` vốn không bật trên NVIDIA. Không dùng env FORCE hoặc đổi stamp để 'unlock' vì shader SPIR-V/pipeline binary key thay đổi, có thể tái phát synchronous compile kéo dài.

- Dựa trên source: `ProveWaveLaneLocal()` loại trường hợp không chứng minh an toàn; fallback two-lane còn cần cho cross-half/complex flow; cooperative workgroup barriers là đúng nếu hai subgroup trao đổi.
- Gate offline: có bao nhiêu *hot shader* chưa lane-local và pipeline nào được cache đóng dấu cũ; đánh giá tương thích incremental rebuild, không chạy precompile trên máy RAM-tight.
- Gate runtime sau này: paired CPU/GPU per-shader timing; shader equivalence ở divergent masks, odd workgroups, particles/water, transparency. Hiệu quả 11% ở RTX5090/courtyard một phiên cũ **không dự báo** RTX5070.

### D. Temporal DLSS/FSR fidelity — **GO cho static semantic mapping**

`src/graphics/host_gpu/renderer/renderSuperResolution.cpp`: lấy color/motion/depth/output, jitter, motion scale, reset + game exposure. Guest PS5 Pro parameter block có slot 6 là **reactive mask**, nhưng `RunSuperResolution()` hiện resolve 4 ảnh và không truyền reactive mask tới common UpscaleInputs. Đây là lead để nghiên cứu particle/transparency trails, **không phải** bằng chứng nguyên nhân ghosting.

- Gate: xác định reactive-mask format, range, clear/update timing; NVIDIA Streamline/DLSS vs FSR API có chấp nhận tương ứng hay không; không tự synthesize mask khi thiếu semantics.
- Visual gate khi được user chạy: cùng cảnh pan camera, foliage, VFX, transparent particles, HUD, disocclusion; không 'fix' bằng tắt history nếu gây shimmer.

### E. HDR, brightness, colors và VRAM — **GO cho audit, NO-GO nâng cấp mù**

`renderSuperResolution.cpp` có exposure pass để sửa mismatch độ sáng ~2.2× đã gặp; `src/graphics/presentation/videoOut.cpp` và `window/swapchain.cpp` có HDR10/PQ. Cần kiểm tra đường linear→exposure→game tonemap→PQ/SDR **đúng một lần**, đánh giá black clipping, banding, highlight rolloff bằng ảnh HDR đã diễn giải đúng.

RTX5070 có 12 GB VRAM; tài liệu `docs/PORTABLE-README.md` cho biết cảnh nặng có thể gần 11 GB. 4K output có render targets và history buffers không giảm tỷ lệ theo internal 720p. Trước enhancement phải xem VRAM budget/evictions và swap system RAM.

### F. Công nghệ Vulkan mới — nghiên cứu có điều kiện, không đổi kiến trúc trước khi đo

- `VK_EXT_descriptor_buffer` có thể giảm descriptor management CPU nếu `vkUpdateDescriptorSets` thực sự là hotspot; Table XPR đã dùng shared descriptor-set caching nên chưa có lý do đổi toàn bộ.
- `VK_EXT_device_generated_commands` có thể giúp state-changing multi-draw on GPU, nhưng Vulkan warning rằng đơn giản một action token có khi còn chậm hơn `drawIndirect`; PS5 PM4/aliasing và pipeline states khó chứng minh.
- `VK_KHR_pipeline_binary` **đã dùng**, không là 'new feature' để add lại; cải thiện ưu tiên/hit rate trong giới hạn RAM mới đáng nghiên cứu.

## 4. Roadmap và gate

| Phase | Nội dung | Điều kiện lên GO |
|---|---|---|
| G0 | Baseline non-destructive trên current source/log; tách warmup, GPU busy, render/record critical path | Xác nhận số liệu ổn định cùng cảnh, không lấy SLOW Frame threshold làm FPS |
| G1 | Static audit cache/feature-stamp 0x3; hot shader classification | Có danh sách hash/coverage, không bắt user precompile |
| G2 | Multidraw count sync census + boundary GPU bubble attribution | Nếu count-sync hoặc barrier có ms/frame critical-path đáng kể mới sửa một ứng viên |
| G3 | Narrow implementation (một candidate tại một thời điểm), static tests and build | Không đổi semantics, bảo toàn guest memory ordering và Vulkan hazards |
| G4 | User-run A/B cùng cảnh, sau warmup, cùng output/display refresh, screenshots/short clips | Mean/1% low & GPU metrics cải thiện vượt biến động, không crash/corruption/VRAM regression |
| Q1 | Reactive mask / DLSS motion / exposure / HDR accuracy | Semantics proven + reference image/video matched; không bật thử nghiệm đã retired |

**Next recommended action:** không viết GPU optimization patch mới; ưu tiên truy nguyên **hot shader + cache feature-stamp 0x3** và `DrawIndirectMulti()` count-sync trên dữ liệu existing, đồng thời chuẩn bị một phép đo critical path ngắn do user chủ động chạy nếu cần. Đừng tăng số worker/force warmup, bỏ barrier, xóa cache, chạy shader precompile hoặc chỉnh save. Không cần thêm UI preset.

## 5. Investigation G1/G2 — kiểm tra thực tế ngày 25/10 (3 Codex subagents)

Đã review độc lập: DevSpace `agt_b4a9ec75` (cache stamp), `agt_239ad20c` (count-indirect), `agt_469d5ad9` (shader/semantic risks). Không agent nào sửa file, chạy game, build hoặc precompile.

### G1 — Đã xác minh nguyên nhân nhưng CHƯA cho phép migrate cache

- **Cache stamp thật**, file `_PipelineCache/static/PPSA01341_01.007.000.features`: `0 3 e83d291c179fb692`. Trường 1 = SPIR-V feature set mà **static store** được tạo bằng (`0`); trường 2 = precompile lần cuối đã **thử** (`3`); trường 3 = hints hash.
- Log `_Build/run-logs/20261024-014159-precompile/merge.out.log`: `merged 1048 shards, 67097 pipelines`; `made with translation features 0x0 (this precompile's: 0x3)`; `Shader precompile: complete`. Incremental merge không prune/fresh giữ trường 1, nên **complete không có nghĩa game bật features**.
- `src/graphics/host_gpu/renderer/pipeline/pipelineCache.cpp::InitializeStaticCache()` lấy **trường 1** qua `ReadStaticFeatures()`; RTX5070 hiện chấp nhận hai bit `0x1 CooperativeHalves` và `0x2 TableSlotsAtUse`, nhưng runtime dùng `0`; mọi log chạy gần đây báo `Translation features 0x3 off`.
- `staticPrecompile.inc::StaticCacheCurrent()` và `StaticCacheFeaturesCurrent()` lại kiểm tra **trường 2**, nên status có thể báo features current dù thực tế game vẫn tắt. Đây là **khoảng lệch về thông điệp trạng thái**, không phải bằng chứng pipeline bị lỗi.
- Cache vẫn hữu ích: log `20261025-161231-316.out.log` ghi 67,097 stored pipelines, 2,518 pipelines được tạo từ store và 1,366 không trong store; driver không từ chối binary. Log có slow frames `compile=120.9 ms`, `compile=115.3 ms`, nhưng đây là **threshold events**, không phải steady FPS, và không chứng minh feature stamp gây miss.
- **Không** sửa tay `.features`, ép env `KYTY_LANE_LOCAL_COOP=1`/`KYTY_TABLE_SLOTS_AT_USE=1`, chạy `--prune` hoặc rebuild mặc định. Làm vậy có thể thay SPIR-V, mất tương thích với kho ~5.6 GiB, gây miss/compile nhiều giây và rủi ro RAM/BSOD. Với cache cũ, incremental `--stamp` đơn thuần **không** nâng trường 1.
- Đường research an toàn là giữ nguyên cache gốc, lập phương án **sidecar cache/feature-versioned variants** tách biệt (runtime hiện chọn feature **global**, nên cần thiết kế trước), kiểm tra sematics shader, sau đó mới benchmark thủ công nếu user cấp phép môi trường thử nghiệm riêng.
- Lịch sử `9935d547` báo cooperative-halves: RTX5090 1-1 cinematic ~+11% trên một cảnh; `966c891d` báo kết hợp table-slots-at-use rất quan trọng để tránh register spills. **Không ngoại suy** sang RTX5070; đúng hai feature cần test cùng đường thực thi an toàn và image-equivalence.

**G1 disposition:** root cause CONFIRMED; static migration policy **NO-GO** cho cache đang dùng; nghiên cứu sidecar/policy có thể GO, không có FPS gain mới được đo.

### G2 — Đã xác minh đường GPU→CPU→GPU có điều kiện; CHƯA chứng minh xuất hiện trong game

- `src/graphics/guest_gpu/command_processor/pm4Handlers.cpp::CpOpDrawIndirectMulti()` đọc `count_indirect` từ payload bit 30 và `count_addr`. Nếu flag=0 thì count immediate; nếu flag=1 thì `DrawIndirectMulti()` ở `graphicsRun.cpp` gọi `SyncGpuCleanBacking(count_addr,4)`, đọc 4 byte count về CPU, clamp `max_count_or_count`, sau đó mới `TryGpuIndirectDraw()`.
- `TryNativeMultiDraw()` **loại riêng** packet count-indirect khỏi đường Native XPR; đường `renderDraw.cpp` chỉ dùng `vkCmdDrawIndirect` / `vkCmdDrawIndexedIndirect` với count **host-known**.
- `src/kernel/memory.cpp::SyncGpuCleanBacking()` **không luôn gây GPU wait**: vùng không GPU/watcher hoặc không dirty thì trả về ngay; chỉ nếu buffer GPU-dirty thực tế mới `ReadMemory()`. Một readback 4 byte có thể mở rộng sang dirty-window và đợi transfer/scheduler.
- `vulkanWindow.cpp::RequiredVulkan12Features()` không bật/kiểm tra bit `drawIndirectCount`; có `multiDrawIndirect` và `drawIndirectFirstInstance`. `VK_KHR_draw_indirect_count` đã vào Vulkan 1.2 nhưng phải **kiểm tra và bật feature** trước khi dùng. Cần plumbing count buffer + maximum qua `Draw*Args`, ownership/synchronization, clamp/zero/stride/index semantics.
- Tool đã có live `pm4 <seconds>` (số opcode, **không** count-indirect bit), `LiveCensus::ReadbackWait` và aggregate `SyncReadsRender` (không quy riêng call site). Logs hiện không có PM4/census theo chiều này. **Không có bằng chứng saved gameplay dùng nhánh count-indirect thường xuyên**, vì thế không gọi đây là confirmed FPS bottleneck.
- Next minimal measurement (sau approval code change nếu cần): counters tại parse/sync boundary `count_indirect flag`, `GPU-dirty-before-sync`, `duration`, `fallback reason`; không đọc thêm dữ liệu guest ngoài logic sẵn có. Runtime test phải do user chủ động mở game; không chạy capture nặng trên máy chưa ổn định.
- Khronos: https://docs.vulkan.org/guide/latest/extensions/VK_KHR_draw_indirect_count.html và https://docs.vulkan.org/guide/latest/synchronization_examples.html.

**G2 disposition:** candidate code path CONFIRMED, hotspot/frequency **UNKNOWN**, implementation **NO-GO** cho đến khi đo.

### Thứ tự hành động

1. Tập trung vào **G1 non-destructive compatibility design** (sidecar/feature-aware pipeline key + status nói rõ 'attempted' vs 'active'). Không dựng cache mới chỉ để xóa cảnh báo.
2. Nếu muốn phát triển G2, thêm **counters nhẹ** trước tiên, đo bằng `pm4`/census ở gameplay do user chạy; chỉ triển khai indirect-count nếu đo được milliseconds bị chặn.
3. Những hướng sửa broad barriers, culling, SSR64/combined, model/instance fading, density7 vẫn không có GO mới.

## 6. Nguồn đối chiếu

**Local:** `docs/PROJECT_STATUS.md`, `docs/GPU-DRIVEN-XPR.md`, `docs/PORTABLE-README.md`, `src/graphics/host_gpu/renderer/commandScheduler.cpp`, `src/graphics/guest_gpu/graphicsRun.cpp`, `src/graphics/host_gpu/renderer/renderSuperResolution.cpp`, `src/graphics/shader/recompiler/frontend/translate/Translate.h`, `src/graphics/host_gpu/renderer/pipeline/pipelineCache.cpp`, log `_Build/run-logs/20261025-161231-316.out.log`.

**Bên ngoài, kiến thức API chứ không là proof benchmark Kyty:**
- Khronos pipeline barriers: https://docs.vulkan.org/samples/latest/samples/performance/pipeline_barriers/README.html
- Khronos device-generated commands: https://docs.vulkan.org/features/latest/features/proposals/VK_EXT_device_generated_commands.html
- Khronos pipeline binary: https://docs.vulkan.org/features/latest/features/proposals/VK_KHR_pipeline_binary.html
- Khronos descriptor buffer: https://docs.vulkan.org/features/latest/features/proposals/VK_EXT_descriptor_buffer.html
- Khronos subgroups: https://docs.vulkan.org/guide/latest/subgroups.html
- NVIDIA GPU Trace: https://docs.nvidia.com/nsight-graphics/UserGuide/gpu-trace-overview.html
- NVIDIA Nsight Systems Vulkan trace: https://docs.nvidia.com/nsight-systems/UserGuide/
