# KytyPS5 G2-C — Results and G2-D Admission (2026-10-26)

**Decision:** G2-C end-to-end CPU census **PASS** on newly linked Windows native emulator. **GO** for a *narrow, opt-in G2-D CPU experiment design*, **NO-GO** for changing default draw/dispatch behavior or promoting shader feature `0x3`. This pass only reads existing log/JSON/source; does not launch a game, precompile shaders, mutate saves/cache, or change renderer. Two independent read-only reviews: `agt_ecb4a318` and `agt_8e1fce6e`.

## Source integrity

| Field | Standard 0x0 | Experimental 0x3 |
|---|---|---|
| Session | `_Build/scene-benchmark/session-DVVeRx/` | `_Build/scene-benchmark/session-hHS5BW/` |
| Native stdout | `_Build/run-logs/20261026-124547-969.out.log` | `_Build/shader-feature-trial/run-logs/20261026-124817-605.out.log` |
| Raw census | `census-1792993640163.json` | `census-1792993798940.json` |
| Census frames / entries | 218 / 691 | 214 / 739 |
| FPS windows | 2 × 15 s | 2 × 15 s |
| Scene code | `m04_00_00_00` | `m04_00_00_00` |
| Render/output | 1920×1080 / 3840×2160 | 1920×1080 / 3840×2160 |
| Presentation cap | 60 Hz | 60 Hz |
| Shader trial state | `Translation features 0x3 off` | `translation features 0x3`, isolated cache |
| Native census correlation | Exact LIVE_CENSUS, ENTRY and DONE match | Exact match |

Logs have no stderr exceptions. Both have completed in-game shader warmup before the FPS windows, but broader background prefetch is incomplete; a single Standard boot followed by one Trial boot cannot control thermal/cache/order. Same map is **not** proof of same camera/position/object workload.

## FPS windows (native flip, not frame generation)

| Mode and sample | FPS | 1% low | render CPU ms/flip | record CPU ms/flip | P99 frame interval ms |
|---|---:|---:|---:|---:|---:|
| Standard std1 | 44.87 | 35.86 | 20.73 | 16.28 | 26.9 |
| Standard std2 | 44.33 | 33.89 | 21.15 | 15.98 | 28.2 |
| Trial trial1 | 44.46 | 37.55 | 21.25 | 16.12 | 25.5 |
| Trial trial2 | 45.33 | 36.98 | 20.61 | 16.54 | 25.9 |
| **Standard mean of windows** | **44.600** | **34.875** | **20.940** | **16.130** | **27.550** |
| **Trial mean of windows** | **44.895** | **37.265** | **20.930** | **16.330** | **25.700** |

Observed mean FPS +0.295 (+0.66%); mean 1% low +2.39 (+6.85%) with seven worst intervals per sample; record CPU actually rises by 0.20 ms. Zero intervals ≥50 ms in any of the four scored windows. These are **means of sample statistics**, not pooled percentiles.

Per-flip logical table draws: **16,088.75** Standard vs **15,987.55** Trial (−0.63%). Trial indirect tables and ring-copy bytes also differ; ring-copy bytes average 3,336,113 vs 3,044,096 (−8.75%). Shader translation `0x3` is NOT proven responsible for any observed FPS or tail gain.

## New G2-C scope breakdown

**Important:** `LiveCensus` reports **inclusive elapsed timing**, instrumented under `kind=12`, using the `a` ID namespace and full 64-bit `b` queue tag. `b=8000…` = async queue; unflagged keys = graphics queue, **which may also execute compute dispatches**. Times below are ms/native flip from one 5-second census per mode. Nested rows must **never** be added to parent scopes.

| Probe | Standard G queue | Trial G queue | Standard async | Trial async |
|---|---:|---:|---:|---:|
| `0x7ab20/1` TableEvaluate | **2.2056** | **2.3172** | 0.3685 | 0.3915 |
| `0x7ab20/2` TableGather | 0.3427 | 0.3789 | 0.1023 | 0.1099 |
| `0x7ab21/2` TableBlocks inclusive | **2.0826** | **2.1548** | 0.9799 | 1.0660 |
| `0x7ab21/1` TablePrepareBda (global-memory only) | 0.0901 | 0.0679 | **0.5573** | **0.5492** |
| `0x7ab22/1` CPU-dirty ring candidate | 0.5152 | 0.4876 | 0.0423 | 0.0544 |
| `0x7ab22/2` conventional acquisition | 0.1411 | 0.1585 | 0.0329 | 0.0414 |
| `0x7ab21/3` dispatch indirect arguments | 0.0027 | 0.0030 | 0.0242 | 0.0277 |

Other **inclusive attempt wrappers**, not exclusive overhead: graphics `TableTry` `0x7ab23/1` = **5.2949 / 5.4711 ms/flip**; `TableContinue` `0x7ab23/2` = **4.0229 / 4.2626 ms/flip**. Both include downstream draw work; do **not add** to each other or to Evaluate/Blocks.

Approximate per-call normalization (native aggregate rounded):
- Standard graphics Evaluate: 6,445.36 calls/flip, **0.3422 µs/call**. Trial: 6,364.19 calls/flip, **0.3641 µs/call**.
- Standard graphics Gather: 6,445.36, **0.0532 µs/call**; Trial **0.0595 µs/call**.
- Standard graphics Blocks: 6,419.36, **0.3244 µs/call**; Trial **0.3400 µs/call**.
- TableEvaluate accounts for about **86%** of combined Evaluate+Gather graphics helper time.

Attribution: `TableEvaluate` does mapping-epoch maintenance, guest-memory bounded mapping checks/prefetch, dependent table reads through `NativeXprReader`, descriptor packing/LOD stats and possible indirect-image enumeration. `TableGather` decodes V# words, hashes/gets resolved candidates and prefetches; it does not resolve buffers into GPU device addresses. `TableBlocks` performs CPU/GPU dirty validations, read/write ordering, buffer/ring resolution, and final uploads. `TablePrepareBda` ensures global reads' page-table ranges (not a candidate to skip synchronization).

Other evidence: graphics QueueRun inclusive = 17.4466 ms/flip Standard and 18.1333 Trial. No positive measured synchronous GPU download hotspot; rounding to 0.0 for an event counter **does not prove zero occurrences**. The census has no frame-by-frame latency distribution and adds TSC collection overhead.

## G2-D — Admission and engineering next step

**GO for an opt-in, reversible CPU-only prototype after discriminating narrow bottlenecks.**

1. **Evaluate investigation, priority #1.** With a *single census-gated timer per aggregated subphase*, separate (i) locate/map/prefetch/address level processing, (ii) dependent `NativeXprReader::Read` table reads, (iii) image/sampler key construction/LOD and (iv) indirect enumeration. Additionally count packed-stage vs `by_operands` fallback, run/word counts, mapping misses and eval failure at bounded frequency. Do not timestamp each run/word. Do not change guest reads, page validation, masking, ordering or pointer lifetime.
2. **TableBlocks, priority #2.** Separately count frequency of **read-only shader stages** whose initial write-pass loop has no matching `written || atomic` buffer. A potential narrow *opt-in* experiment precomputes `has_buffer_writes[stage]` when the shader plan is built, skipping only the entirely rejected first pass for stages with no writes. All mixed/read-write stages must still execute write-before-read ordering; preserve `TableReset`, plan revision, buffer ownership/epoch/register lifetime and fallback behavior. Benefit not yet measured, could be small.
3. **Async BDA, priority #3.** On async dispatch, `TablePrepareBda` ~0.55 ms/flip, from ~340 global-memory calls/flip: distinguish bounded range construction, `PrepareBdaReadRanges` success/failure and full `PrepareBda` fallback before considering any local optimization. Avoid skipping memory residency checks.
4. **Ring secondary.** Need counters separating held hit, shared ring hit, Map failure, backing-read failure, successful copy, fallthrough to conventional acquisition; current 0.5 ms/flip ring candidate does not prove unnecessary copies. Preserve dirty mapping/proofs/registration and epoch invariants.
5. **Defer Vulkan/barriers, GPU→CPU indirect-count, draw batching and shader default change** absent more evidence. Do not treat Try/Continue inclusive times as overhead that can be removed.

**Promotion criteria:** a separately gated patch that is default-OFF; native CPU compile/restricted ThinLTO build PASS; test old/new result equivalence for failed/accepted draws and resource lifetime; same-location screenshot/image correctness; matched-scene A–B–B–A process boot with comparable logical draws, rendering resolution, graphics toggles and warmup state; census OFF for measured FPS, ON separately for hotspot attribution; repeats beyond the observed 0.66% FPS variation; rollback must be possible without rebuilding cache.

**Roadmap checkpoint:** G2-C captured/validated. G2-D prototype research/plan **GO**, actual optimization **not yet implemented**. New native benchmarking should be done only after a concrete guarded candidate is built and tested; do not tell user to re-run unchanged G2-C.

Source refs: `src/local/table-xpr.inc` TableEvaluate, TableGather, TableBlocks, TablePrepareBda, TableTry/Continue, `src/local/live-census.h`, `src/local/live-control.h`. Review agents: `agt_ecb4a318`, `agt_8e1fce6e`.
