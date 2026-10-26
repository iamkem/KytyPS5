# G2-A — Kết quả benchmark Standard 0x0 vs Experimental 0x3, RTX 5070

Ngày 26/10/2026 (các phiên khởi động 11:39 và 11:43 theo giờ Windows). **Đã đo, nhưng chưa chứng minh tối ưu shader là nguyên nhân tăng FPS.** Nghiên cứu chỉ đọc log/JSONL, không thay game, source renderer, save, cache, build hay GPU settings.

## Dữ liệu nguồn

- Standard: `_Build/scene-benchmark/session-Z6JykD/results.jsonl`, log `_Build/run-logs/20261026-113910-282.out.log`.
- Trial: `_Build/scene-benchmark/session-unchB6/results.jsonl`, log `_Build/shader-feature-trial/run-logs/20261026-114332-222.out.log`.
- Mỗi phiên chỉ có **1 process startup**, với **3 cửa sổ đo 15 giây**. Mode thứ tự Standard rồi Trial, không phải A/B/B/A. Mỗi JSONL tương ứng đúng `LIVE_MEASURE`, `LIVE_COUNTERS`, `LIVE_DONE` trong log, stderr rỗng.
- Cả hai: RTX 5070; game 1.07, map được ghi `m04_00_00_00`, render 1920×1080, output 3840×2160, present cap 60 Hz. Standard ghi `Translation features 0x3 off`; Trial ghi `translation features 0x3` trong isolated store. Map giống nhau **không chứng minh cùng tọa độ nhân vật, camera, hướng nhìn hay số object**.
- Native `fps` là số flip/frame game, không bao gồm frame generation, `render_ms` và `record_ms` là **CPU time per native flip** (có overlap); `render_busy` là render CPU / wall time, không phải GPU load.

## Sáu mẫu gốc

| Mode | Mẫu | FPS | 1% low | render CPU ms/flip | record CPU ms/flip | P99 frametime ms |
|---|---|---:|---:|---:|---:|---:|
| Standard 0x0 | std1 | 44.47 | 35.42 | 20.57 | 15.60 | 26.8 |
| Standard 0x0 | std2 | 44.33 | 36.19 | 20.58 | 16.87 | 26.7 |
| Standard 0x0 | std3 | 44.60 | 37.16 | 20.90 | 16.40 | 26.2 |
| Trial 0x3 | trial1 | 46.80 | 39.10 | 20.30 | 16.29 | 24.5 |
| Trial 0x3 | trial2 | 48.07 | 39.17 | 19.55 | 15.54 | 24.6 |
| Trial 0x3 | trial3 | 47.47 | 38.91 | 19.71 | 16.17 | 25.1 |

| Mean across three windows | Standard | Trial | Trial minus Standard |
|---|---:|---:|---:|
| FPS | 44.467 | 47.447 | **+2.980 (+6.70%)** |
| 1% low FPS | 36.257 | 39.060 | **+2.803 (+7.73%)** |
| render CPU ms/flip | 20.683 | 19.853 | −0.830 (−4.01%) |
| record CPU ms/flip | 16.290 | 16.000 | −0.290 (−1.78%) |
| P99 frametime ms | 26.567 | 24.733 | −1.833 (−6.90%) |
| render_busy percent | 91.97% | 94.17% | +2.20 percentage points |
| intervals ≥50 ms or ≥100 ms | 0 | 0 | none in sampled windows |

Mean 1% low / P99 above is the **mean of the three window metrics**, not a pooled percentile. Both modes are below 60 FPS during capture, so present cap does not directly censor these averages. No in-window first-use compile hitch is positively visible, but warmup histories differ greatly and a 407 ms compile frame occurs in Trial **before** trial1.

## Critical confounding: per-native-flip workload is not equal

| LIVE_COUNTERS mean / flip | Standard | Trial | Change |
|---|---:|---:|---:|
| `table_draws` | 16,573.6 | 15,935.6 | **−3.85%** |
| `indirect_tables` | 10,182.3 | 9,848.4 | −3.28% |
| `table_continued` | 11,036.9 | 10,556.2 | −4.36% |
| `render_passes` | 102.53 | 99.77 | −2.70% |
| `table_ring_copies` | 1,603.0 | 942.7 | **−41.19%** |
| `table_ring_bytes` | 6,077,811 | 3,282,715 | **−45.99%** |
| `upload_wait_us` | 636.1 | 498.9 | −137.2 µs/flip |
| `upload_busy_us` | 2,262.1 | 2,395.0 | +132.9 µs/flip |
| `record_wait_us` | 2.37 | 1.27 | tiny |
| `sync_downloads` | 0.0 | 0.0 | rounded to one decimal / flip |
| `sync_reads_render` | 0.0 | 0.0 | rounded to one decimal / flip |
| `async_readbacks` | 33.57 | 33.47 | nearly identical |

`table_draws` counts logical draws successfully emitted by the table path, not individual Vulkan API calls (`src/local/table-xpr.inc`). `table_ring_copies` counts copies of CPU-dirty small V# spans into the ring on resource binding, not GPU→CPU downloads (`table-xpr.inc`, ring-copy branch). Readback counts must not be conflated with counted synchronous GPU waits; values rounded to 0.0 do **not** prove literally zero events.

Render CPU per 1,000 logical table draws:

- Standard: **1.248 ms / 1,000 draws**
- Trial: **1.246 ms / 1,000 draws** (about −0.17%)

This crude normalization is NOT a proper cost model but highlights that the 4.01% lower render CPU time almost exactly tracks the 3.85% lower table-draw workload; **the gain cannot be causally assigned to 0x3** without equalizing workload.

## Phân tích kỹ thuật

- Both modes strongly load the render producer (render_busy 92–94%, render CPU ≈20 ms per frame). `record_wait_us` is only ~1–2 µs/flip, so **recorder backpressure is not the principal observed producer wait**. `record_ms` includes worker CPU and spin, not just Vulkan API execution.
- Asynchronous readbacks (~33.5/flip) still exist. `sync_downloads=0.0`, `sync_reads_render=0.0` offer **no positive support** for a hot synchronous indirect-count GPU→CPU download path in these specific samples.
- `table_ring_bytes` reduction is large but shared/held ring-path traffic also falls; it indicates workload/path differences, not proven more efficient reuse.
- The observed FPS differences can arise from scene/camera/animation state, table workload differences, different cache/warmup histories, shader translation, or a combination. No screenshots/coordinates were retained for matching the benchmark positions.

## Kết luận GO/NO-GO

**G1 trial 0x3:** Tech PASS; observed FPS **+6.7% in these sessions** (repeatable inside each mode). **NO-GO for default promotion** pending same-view A/B/B/A and image correctness.

**G2-A telemetry:** PASS, 6 native measurements correctly captured.

**G2-B next:** GO for opt-in **`census 5`** in the same scene and/or narrow on-demand timers around PM4/Table XPR producer phases and ring copy/resolve branches. Existing `LiveCensus` scopes count overlapping elapsed work; do not sum nested phases as exclusive CPU time. Identify the top `ms/flip` producer hot path **before code optimization**.

**G2 indirect-count replacement / barrier removal / arbitrary batching:** **NO-GO**; no measured hotspot, high correctness and GPU sync risk.

### Test plan for causal 0x3 confirmation

At identical camera/character position and stable scene with unchanged Graphics, compare `A=0x0, B=0x3, B=0x3, A=0x0` (distinct process starts). Warm up exact view and collect **3×15 s** after stable background state for each run; capture a screenshot for exact workload/image checks. Compare `table_draws`, `indirect_tables`, ring traffic per flip as admission criteria before attributing any FPS delta to the shader translator. One additional uncontrolled Standard→Trial pair is not sufficient.

## Review

Two independent read-only subagents: `agt_fa2ed2c8` benchmark validity/caveats and `agt_0b517144` counter definitions and producer bottleneck. No emulator, precompile, cache management, or renderer modifications were performed for this analysis.
