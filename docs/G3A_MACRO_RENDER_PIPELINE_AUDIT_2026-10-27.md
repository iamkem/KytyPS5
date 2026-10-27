# G3-A — Macro render-pipeline / CPU-GPU critical-path audit (2026-10-27)

**Scope:** architectural performance research on KytyPS5 / Demon's Souls Remake PC, branch `integration/chenxiao-v20261023b-20261023`, source base `f2b79615`. **No new renderer code, benchmark binary, gameplay, shader cache or save-data modifications.** G2-J and all further speculative per-lookup, prefetch, descriptor or read micro-optimizations are **DEFERRED** by user direction. The target is to identify a frame-critical **large unit of work or unnecessary pipeline dependency**, not improve the speed of one already cheap operation.

**G3-A result: offline source/log research COMPLETE; CPU/GPU bottleneck classification INCOMPLETE without correlated GPU execution.** The best *investigative* order is (1) serialized CPU producer/resource preparation; (2) Vulkan recording/driver throughput; (3) PM4 suspension/readback and GPU dependency hand-offs. This is a priority ranking by available evidence, **not proof** that these are the three largest exclusive frame costs.

## 1. What the current measurements prove

Recent **one-boot G2-H-On-only** scene: `_Build/scene-benchmark/session-C4lk7U/results.jsonl` contains two 15-second **Census-off FPS windows** at `m04_00_00_00`, RTX 5070, Standard shader 0x0, G2-D Off, G2-G Off and G2-H On (explicit experimental, not promoted default). Native log `_Build/run-logs/20261027-095048-465.out.log`. `render_ms` and `record_ms` are **thread CPU time per native flip** (see `src/local/live-control.h:316-355`); `render_busy` is render-thread CPU / elapsed window, **NOT GPU utilization**. Render and recording worker execute concurrently. Never add their CPU times to get a frame duration.

| 15-second Standard window | #1 | #2 | Mean (descriptive only) |
|---|---:|---:|---:|
| FPS/native flip | 49.47 | 49.80 | **49.635** |
| Implied wall interval, 1000/FPS | 20.21 ms | 20.08 ms | **~20.15 ms** |
| Render thread CPU | 19.04 ms/flip | 18.80 ms/flip | **18.92 ms/flip** |
| Render thread busy | 94.2% | 93.6% | **93.9%** |
| Recording worker CPU | 14.76 ms/flip | 15.04 ms/flip | **14.90 ms/flip** |
| 1% low FPS | 42.54 | 43.32 | 42.93 (mean of window statistics, not pooled 1st percentile) |

Mean of raw per-flip counters from the two same-boot FPS windows (not an A/B):

| Observable work / native flip | Approx. mean |
|---|---:|
| Logical table draws | **10,833.8** |
| `table_continued` | **6,673.0** |
| `indirect_tables` | **8,773.9** |
| `table_dispatches` | **1,358.1** |
| Render passes | **85.95** |
| Guest host callbacks / `guest_commands` | **119.7** |
| `pm4_suspends` | **59.0** |
| `submission_requeues` | **57.0** |
| `submission_slices` | **93.1** |
| `async_readbacks` | **31.6** |
| `upload_copies` | ~659.2 |
| `upload_bytes` | ~12.29 MB, decimal bytes |
| `region_syncs` | ~835.1 |
| `timeline_queries_render` | ~3,872.5 |
| `upload_wait_us` | ~868.6 **us** (cross-thread counter, NOT solely a blocked render-thread interval) |
| `record_wait_us` | **0.2 us** |

These are activity signals, **not** exclusive time measurements. The `upload_wait_us` value spans relevant participating threads; `record_wait_us` implies little observed **producer blocked by a full record stream**, not a lightweight Vulkan driver or idle recording worker. About 31.6 async readbacks with `sync_downloads` rounding to 0 **do not rule out guest-critical dependencies**. Hardware GPU busy time for this RTX 5070 run was **not captured**.

The contemporaneous **instrumented** CPU Census `session-C4lk7U/census-1793069546855.json` includes **graphics `QueueRun` 16.4903 ms/flip** and **seven async guest queues combined ~4.4218 ms/flip**. It also includes native draw attempts and other nested work. These elapsed TSC scopes are NOT exclusive PM4 decode time. They have profiling overhead and do not reconcile by naive addition/subtraction to the uninstrumented per-flip thread CPU figure. Likewise `TableBlocks` 1.8013ms graphics / 0.9784ms async and `TableEvaluate` 2.8226ms graphics / 0.5699ms async are instrumented inclusive scopes, not savings budgets.

G2-I session `_Build/scene-benchmark/session-0kGGe2/census-1793070890967.json` is **CPU Census-only**, with no valid FPS window. Its G2-I sampled writable acquisition and uploads are diagnostic, not a new speedup. User explicitly does not want a new Off baseline; **do not demand one** or represent historical Off measurements with changing workloads/binaries as causal A/B.

The game presents with a **60 Hz cap**, but measured native-flip frequency is below 60. The logged 60-Hz setting alone cannot explain the steady ~49–50 flips/s.

## 2. Actual architectural execution path and contention

```text
PS5 guest AGC submits graphics / compute command buffers
  └─ GuestGpu::Enqueue → guest submission queues / frame epoch
       └─ ONE host GPU processing thread (GuestGpu::ThreadRun)
            ├─ queued memory/readback/fault callbacks in strict order
            ├─ PM4 Execute / ProcessPm4 (resumable, suspends on waits)
            │    ├─ predication & state observer
            │    ├─ native compatible batches (up to 64 draw packets)
            │    ├─ TableContinue / TableTry / TableDraw, TableDispatch
            │    └─ descriptors, guest reads, BufferCache, image transitions
            └─ CommandScheduler recording / Flush / deferred Submit
                 ├─ upload stream worker + timeline dependency
                 ├─ serialized Vulkan call replay by Kyty.Record
                 └─ vkQueueSubmit → Vulkan GPU queue / GPU execution
                      ├─ graphics + compute + transfers / dependencies
                      ├─ GPU timeline tick complete / flip-ready callback
                      └─ video-out / present scheduler / swapchain
```

Source landmarks:
- `src/libs/agc.cpp:4203-4274`: AGC queue IDs and submissions.
- `src/graphics/guest_gpu/graphicsRun.cpp:235`: `ProcessCommands` ordered fault/readback/mapping callbacks; `:607-783`: guest queues and scheduling; `:783-936`: CP execution; `:947-1163`: recursive PM4 loop, predication, native fast path, handler/suspension.
- `src/local/table-xpr.inc:1781`: `TableDraw` path; `TableEvaluate`, `TableSet`, `TablePrepareBda`, `TableBlocks`, index/argument proofs, Vulkan emission.
- `src/local/vulkan-recording.cpp:178-320`: producer record stream and `Kyty.Record` consumer; chunks are 64 × 64KiB and published on thresholds or explicit flush. Driver API replay retains order.
- `src/graphics/host_gpu/renderer/commandScheduler.cpp:196-265,609-750`: adaptive draw/dispatch batch/defer and completion, recording worker's deferred `ReplaySubmit`, upload wait and Vulkan queue submission.
- `src/graphics/presentation/window/swapchain.cpp:1487,1635`: independent presentation handoff, driver submit/GPU tick wait and swapchain `presentKHR`.

**Important properties:**
- Several PS5 async-compute queues are **interleaved on ONE host CPU renderer thread**; async guest queue label is **not** proof of parallel CPU execution or overlapping hardware async compute.
- Existing compatible native draw batching already handles up to **64** packets; the scheduler also batches draw/dispatch and defers submissions. Additional batching is not automatically useful.
- PM4 callback poll and flush protect ordering of faults, guest mappings and readbacks. A `WAIT_REG_MEM` suspend/requeue may be a necessary dependency rather than a waste.
- Writable image/buffer aliases and BDA/page proofs govern GPU memory ownership. Memory validation performed at **translation time** cannot generally be moved to **GPU execution time** without preserving snapshot semantics.
- Vulkan work recording is separated from actual driver submission and **from GPU completion**; `m_driver_tick` after `vkQueueSubmit` does not mean the GPU completed it.
- Presentation has independent waits and frame-dropping/pacing behavior. Native `Flip()` period is not the display's scanout-to-scanout or photon latency.

## 3. Ranked *macro research* priorities

### P0 — serial CPU PM4-to-render path / per-draw state and resource work

Evidence: sustained **18.92ms render CPU** in a ~20.15ms native-flip interval; roughly **10.8k logical draws** and **1.36k table dispatches/flip** through a predominantly ordered producer. This is the strongest available evidence of CPU-side pressure. It is **not a conclusive CPU-bound classification** until GPU execution is correlated.

Research: classify whole-frame work into guest PM4 parse/callback, program/plan lookup, resource preparation, command emission, and host handoffs **without counting inclusive/nested scopes twice**. Find *whole categories* of repeatable immutable work that can safely be prepared asynchronously before the point of guest-memory observation; preserve GPU-written buffers, draw ordering and resource ownership. A future architectural improvement should demonstrably avoid entire resource preparations or reduce critical-path work volume—not skip one cheap lookup.

### P1 — Vulkan recording / driver throughput and parallelism

Evidence: `Kyty.Record` consumes **14.90ms thread CPU/native flip** while producer exhibits only **0.2us/flip recorded queue-backpressure waits**. Native recording already batches chunks and submits in order. The recording thread may run simultaneously and can become the limit if producer gains speed. CPU wall thread usage **does not establish** exact Vulkan driver time, GPU utilization or a speedup from more worker threads.

Research: correlate producer-publication, recorder replay/driver API calls, deferred submit, GPU queue idle gaps and present. Avoid naively creating independent recording workers: Vulkan command-pool ownership, write ordering, pipeline/resource lifetime and submit mutex require an explicit correctness strategy.

### P1 — async compute / readback / suspension dependency chain

Evidence: **59 PM4 suspends**, **57 requeues**, **93.1 submission slices**, **~31.6 async readbacks**, and **~120 callbacks per native flip**. These events could fragment the critical path and reduce GPU/CPU overlap. But `sync_downloads=0` and missing render-thread GPU wait census do not prove an avoidable stall.

Research: map the ordered dependency graph from guest compute dispatch → GPU culling/compute → transfer/readback readiness → guest WAIT/PM4 resume → following graphics work. Determine which gaps are true waiting for data and which are proactive submission, with timeline markers. Never alter callback/service cadence or merge guest memory ranges merely to reduce event counts.

### P2 — resource transfer / warmup hitch behavior

Evidence: ~**12.3MB of upload copies**, ~**659 upload-copy events**, ~**835 BDA region syncs** per native flip; startup output includes shader/pipeline warmup and individual compile-heavy **100–190ms** slow frames. These sources deserve a separate **startup/streaming 1%-low** track, not conflation with steady-state FPS. Caches and upload batching already exist; counted bytes alone do not imply PCIe throughput saturation or redundant transfers. Shader precompile is **not authorized** by this audit.

Research: distinguish actual upload wait critical path, first-use driver pipeline compilation, resource layout transitions, and transient scene streaming pressure, using their existing logs and queue-correlated timing. Do not remove `StreamBuffer::Commit` watches, protection barriers, texture alias invalidation or GPU retirement checks.

## 4. Critical historical architecture lessons (in-repo evidence, NOT today's RTX 5070 benchmark)

Source: `docs/GPU-DRIVEN-XPR.md` — an evolving earlier design/research log (many experiments on *different hardware and changing builds*; do not generalize its FPS numbers to the current RTX 5070).

1. **Zero-copy GPU-driven live SRT is not automatically correct.** An earlier test observed **377/5,000 (~7.6%)** guest slot values changing between translation and later GPU completion, driven in part by CP DMA updating constants between draws. Moving all SRT evaluation to GPU execution risks reading *later* values. The safer snapshot-at-translation-time Table mode arose from this issue.
2. An earlier GPU-driven v4 design reduced CPU work but increased measured GPU busy ~**4.3ms** due to multi-level dependent reads. More GPU work did **not** improve FPS.
3. The later snapshot-based hybrid Table graphics/compute path reported large improvements **within its own same-process A/B**, after rebuilding the right specialization and fixing ordering; underlines that macro changes can matter, but also produced missing floor geometry, Stonefang invalid global-memory reads/device loss and Valley particle corruption before fixes. Every new macro path must validate geometry, shader output, BDA global reads, writable aliasing, image layouts, draw offset/instance state and frame lifetime.
4. The earlier PM4 timeline measured a **~4.8ms GPU tail dependency before next-frame culling** and early ~7ms frame stage in that old experiment; an actual critical path is sometimes a *handoff ordering constraint*, not hot-loop instruction count.
5. Earlier broad GPU barrier removal measured no significant benefit and was **unsafe**; do not repeat broad barrier experiments without queue/memory proofs.
6. Translation/pipeline caches and background workers were previously optimized; their warmup misses can dominate **startup/streaming frame tails**, not steady-state cost. Careless parallelism or cache invalidation can cause device loss or regressions.

## 5. Decision tree — no new code yet

**Current missing observable: same-session CPU submission → GPU queue execution → readback completion → native Flip/present timeline.** Hardware GPU busy in existing RTX 5070 windows is **UNKNOWN**. A high `render_busy` percentage does not establish GPU idle time or CPU-only limitation.

- **If the GPU queue shows significant gaps waiting for producer submissions** while render thread is busy, pursue **P0 serial host producer and P1 recording throughput**: move only provably immutable plan work off the critical path, improve coarse-grained reuse, or redesign boundaries with matching image/memory proofs.
- **If GPU work continuously occupies the relevant engine and CPU submissions are ready ahead of it**, focus GPU pass-level cost, shader execution, async-compute scheduling, render-target bandwidth, or queue overlap. Do not add CPU-side work to move GPU operations unless the timeline predicts a win.
- **If execution advances in bursts separated by guest WAIT/readback/presentation completion**, prioritize **P1 dependency chain and reduced hand-off latency**; preserve exact causal order, don't delete synchronization.
- **If steady-state is healthy but loading/transition frame tails are large**, split out **P2 warmup/pipeline/resource streaming** with different acceptance criteria.

No source change, feature flag or build should be admitted solely because it reduces a frequent counter or has a high inclusive sample percentage.

## 6. Available profiling options for future evidence (NOT executed or requested now)

**First choice: use existing low-overhead native `trace` path**, not a new profiler, and only when the user explicitly elects a future capture during an already-warmed On-only play session. Current code already has `trace <seconds> <path>` in `src/local/live-control.h:424-444`, native GPU TOP/BOTTOM timestamp spans in `src/graphics/host_gpu/renderer/commandScheduler.cpp:130-195`, and the trace decoder under `tools/local/live-trace.py`. Prefer a **short plain `trace`** for submission/GPU-span critical path. `tracem` adds per-draw/per-dispatch timestamps and is expensive and riskier in complex frames; reserve it for a narrow follow-up. Do not collect Census/FPS and heavy GPU marks simultaneously. Historical 5090 GPU timestamp measurements are not a substitute for a 5070 capture.

**External profiler option:** NVIDIA Nsight Systems supports correlated Vulkan CPU/API calls and GPU queue workload trace; Vulkan graphics/compute and submission rows can establish actual gaps and concurrency. Official references:
- https://docs.nvidia.com/nsight-systems/UserGuide/ (Vulkan API trace and GPU workload on Windows)
- https://docs.nvidia.com/nsight-graphics/UserGuide/expected-workflow.html (determine CPU-bound vs GPU-bound first, then GPU Trace)
- https://docs.nvidia.com/nsight-graphics/UserGuide/gpu-trace-overview.html (short targeted capture with memory requirements)

**If adding own GPU timestamp measurements later:** ensure per-queue `timestampValidBits`, `timestampPeriod`, correct TOP/BOTTOM stage and availability, asynchronous retrieval **after** the associated timeline tick, no host `WAIT_BIT` on a performance-critical render path, no new fences, queue-idle waits or extra submits. GPU timestamps from **different queues cannot be subtracted directly**. Reference Khronos Vulkan:
- https://docs.vulkan.org/spec/latest/chapters/queries.html
- https://docs.vulkan.org/samples/latest/samples/api/timestamp_queries/README.html

**Why not launch now?** The user requested **macro research only**, explicitly dislikes repeated Off baselines, and asked not to run a game from the assistant. Current offline evidence is enough to prioritize research. A new live GPU trace would answer the remaining classification uncertainty, but should be proposed only as an optional **single On-only collection** when needed.

## 7. Revised roadmap

| Phase | Meaning | Status / exit gate |
|---|---|---|
| G2-J | Per-owner relookup micro-optimization | **DEFERRED** |
| **G3-A** | Macro execution graph + measured critical-path audit | **OFFLINE RESEARCH COMPLETE**; CPU/GPU classification remains OPEN |
| **G3-B1** | CPU producer + recorder throughput design | **RESEARCH**; requires timeline evidence to choose redesign |
| **G3-B2** | Guest compute/readback/present critical-path design | **RESEARCH**; preserve causal dependency and ordered callback semantics |
| **G3-B3** | GPU pass hotspots / async overlap / pipeline throughput | **CONDITIONAL RESEARCH**; only if GPU queue timeline shows saturation |
| G3-C | Render + FPS/1% low + pixel and 13-world correctness gates | **PENDING** (no new runtime required for G3-A) |

Reviewers: independent read-only DevSpace subagents `agt_fddd9d8d` (end-to-end architecture), `agt_95d07472` (CPU/GPU and timestamp validity), `agt_e627f7e6` (resource and synchronization); no subagent wrote code. This report is a **research checkpoint**, not a claim of an implemented performance improvement.
