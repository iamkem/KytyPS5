# G3-B2 — Real RTX 5070 GPU Timeline / macro-critical-path decision (2026-10-27)

**Status:** G3-B2 real GPU timeline **CAPTURED AND ANALYZED** in one user-controlled Launcher game boot. Classification: **host-side GPU-feeding / serial producer pipeline constrained (moderate confidence), with important guest readback/WAIT synchronization; NOT demonstrated to be a saturated graphics-GPU workload**. This is a bottleneck **direction**, not isolation of exclusive CPU compute cost or proof that GPU hardware is otherwise idle. No emulator rendering architecture change admitted or FPS gain claimed.

## 1. Provenance and trace integrity

- Branch: `integration/chenxiao-v20261023b-20261023`, input HEAD `d9643b1a`. Game started **only by user** through `.\launcher.cmd` and Launcher Play, not by the assistant. Scene reported by the game: `m04_00_00_00` (Boletaria 1-1); Vulkan device `NVIDIA GeForce RTX 5070`.
- Same-boot session directory: `_Build/scene-benchmark/session-iouw5o/`. Matching runtime stdout: `_Build/run-logs/20261027-112542-992.out.log`, lines 1455-1456 and 1483-1484 show exact-ID `LIVE_TRACE` and `LIVE_DONE`.
- Capture A `gpu-trace-1793075199227.bin` with companion `.bin.hz`; `239,413` records, TSC `3,493,477,877 Hz`, ~2s.
- Capture B `gpu-trace-1793075217510.bin` with companion `.bin.hz`; `262,161` records, TSC `3,493,478,095 Hz`, ~2s.
- Both entries are present in `gpu-timeline-results.jsonl` as Standard mode. They are **two observational samples in the same game session**, NOT an On/Off A/B and NOT paired FPS measurements. Raw trace files were analyzed read-only using the existing `tools/local/live-trace.py`. Neither session was reopened.
- Native binary, Launcher package, shader caches, save data and nontracked user files were **not** changed. No build, repack, shader precompile, or game relaunch.

## 2. Observations from native timestamp events

| Metric | A: `1793075199227` | B: `1793075217510` |
|---|---:|---:|
| Trace records | 239,413 | 262,161 |
| Interior native Flip-to-Flip intervals | **85** | **95** |
| Mean native Flip interval | **22.93 ms** | **20.62 ms** |
| Mean timestamped GPU command-buffer-span **union** / interval | **11.24 ms** | **11.19 ms** |
| Uncovered Flip interval (not proof of hardware idle) | **11.69 ms** | **9.42 ms** |
| Mean explicitly instrumented render-thread idle | **0.50 ms** | **0.70 ms** |
| Command-buffer GPU timestamp spans | **6,357** | **6,900** |
| TickDone completion monitor events | **6,444** | **6,997** |
| Failed `WAIT_REG_MEM` / `FrontSuspend` events | **5,200** | **5,847** |
| Guest `ReadMemory` wait scopes, all threads | **7,232** | **7,963** |
| Union of guest readback-wait scopes per Flip | **7.82 ms** | **7.33 ms** |
| Median producer `GpuSubmit` marker → worker replay-start marker | **0.041 ms** | **0.033 ms** |
| P95 producer marker → replay-start marker | **0.650 ms** | **0.533 ms** |

**Interpretation:**
1. Command buffer timestamps occupy approximately half the measured Flip interval, with many repeated `>0.4 ms` gaps; work arrives in bursts, not continuously. This does **not** measure physical device utilization or all graphics/compute/copy/presentation engines.
2. The render producer is seldom in its *explicit scheduler idle* states, consistent with sustained work on a **single CPU producer** interleaving graphics and guest compute queues. Earlier same-scene G2-H On-only, non-traced FPS windows reported ~18.92ms render CPU and ~14.90ms separate recorder CPU per ~20.15ms Flip (`docs/G3A_MACRO_RENDER_PIPELINE_AUDIT_2026-10-27.md`). These historical same-day counters support the CPU-pressure hypothesis but are not exact counters for this traced run. Thread CPU times **must not be summed**.
3. The median producer-to-recorder replay entry delay is small; a persistent **record-stream entry** backlog is *not* the best primary hypothesis. The replay marker is **before** `vkEndCommandBuffer`, queue mutex and actual `vkQueueSubmit`; it does **not** bound full driver submission latency. Recorder throughput remains a secondary investigation, not ruled out.
4. ~61 failed WAIT comparisons per Flip and numerous readback wait scopes reveal substantial scheduling/dependency activity. Guest readback scopes span CPU handoff, pending GPU copies and host copying; waits from multiple guest threads overlap heavily. **Do not sum wait time across guest threads** or call ~7-8ms/Flip an exclusive host render-thread stall. The existing two traces do not carry `tracew`'s producer-range provenance; GPU producer-of-readback cannot be proven from plain `trace`.
5. A coarse **readiness heuristic** checking each long GPU command-buffer gap against producer-enqueued and worker-replayed tick markers found most long gaps without an already-marked queued successor; this favors *undersupply of commands* over an always-filled GPU queue. However the heuristic depends on approximate CPU/GPU clock alignment, incomplete queue coverage and trace boundaries. It is corroboration, **not a causal proof**.

## 3. Timestamp and correctness caveats

- `tools/local/live-trace.py:Trace` approximates GPU clock offset via minimum observed `TickDone CPU - GPU timestamp end`. Tick completion observation itself is delayed and uncalibrated. Durations of same-clock GPU spans are more reliable than exact placement against CPU events; millisecond-scale gap trends are evidence, sub-100us causal ordering is not.
- `src/graphics/host_gpu/renderer/context.cpp:ReplayBegin` records TOP timestamp. `src/graphics/host_gpu/renderer/commandScheduler.cpp:ReplaySubmit` records BOTTOM, ends command buffers, locks queue, then invokes `vkQueueSubmit`. `TickMon` retrieves results after timeline tick completion. Spans may include GPU dependency stalls; transfers, Vulkan prologues and present are not comprehensively covered by these pairs.
- `src/graphics/guest_gpu/graphicsRun.cpp:GuestGpu::ThreadRun` serializes PM4 submissions and ordered guest callbacks through one render producer, with per-queue requeue/blocked/epoch rules. `RenderIdle` only tracks explicit empty/blocked scheduler waits, not all host thread stall causes.
- `src/graphics/guest_gpu/graphicsRun.cpp:CommandProcessor::WaitRegMem`: `FrontSuspend` marks a **failed predicate** and calls `SuspendPm4`, not a duration and not necessarily equality. Event packs the low 32 bits of observed and reference values; compare function/mask are absent. Decoder formerly printed `==` incorrectly; this review corrected the text to `WAIT_REG_MEM suspended ... observed_lo32 ... ref_lo32 ... (mask/predicate not recorded)`, without changing native data.
- GPU span matching is not perfect (6,357 spans vs 6,444 completion monitor events in A; 6,900 vs 6,997 in B), so uncovered time must not be equated with literal GPU idleness. Guest qIDs refer to scheduling submissions, not independent Vulkan device queues.
- A/B differences in Flip duration can arise from camera/scene activity or trace overhead; **no performance delta is claimed**. Existing shader cache and first-use GPU compilation timings are separate from the steady-state bottleneck decision.

## 4. G3-B2 decision — rank one macro investigation

**Winner: P0 host producer / PM4-to-command feed with correctness-preserving synchronization, not a GPU shader-pass rewrite.**

| Hypothesis | Verdict | Rationale |
|---|---|---|
| **Serial CPU producer and coarse-grained GPU work-feed gaps** | **PRIMARY, moderate confidence** | High host producer activity, short explicit idle, repeated GPU span gaps, often without submitted replacement commands |
| **Dependency/readback and guest WAIT chain** | **IMPORTANT CO-FACTOR; unisolated** | Hundreds/thousands of WAIT/readback events and concurrent guest wait intervals; cannot separate required waits from avoidable handoff overhead without causal proof |
| **Vulkan recording/driver** | **SECONDARY** | Substantial recorder CPU historically, but replay-start lag small; driver/vkQueueSubmit time still unmeasured |
| **GPU shader / graphics-pass throughput** | **LOWER PRIORITY FOR THIS SCENE** | Timestamped graphics work not continuously covering the Flip interval; **not a claim that full GPU device is unsaturated** |
| **Loading/shader warmup** | Separate hitch track | Does not explain per-frame command feed without matched evidence |

**G3-B2 GO:** choose host producer critical-path design as G3-B3 research target. **G3-B3 code NO-GO yet:** no identified safe, exclusive whole-frame CPU work category with proven semantics and meaningful savings.

## 5. G3-B3 bounded architecture hypothesis / invariants

**Investigate a split-phase PM4 producer architecture at *coarse work-unit granularity* only:** identify *pure*, immutable shader-plan/PM4 metadata preparation that can be moved before the serialized translation-time execution boundary, while all guest-memory observations, SRT snapshot evaluation, buffer/image owner validation, Vulkan resource use, callbacks and guest WAIT remain committed **on the original ordered producer**. This is a scoped feasibility study, **not permission to parallelize guest PM4 execution**.

Acceptance conditions before any implementation:
1. A source-level dependency proof for the candidate work unit (inputs immutable and versioned; side-effect free; no guest writable BDA/SRT/data reads; no GPU-written alias and no guest-visible callback dependence).
2. An explicit causal ordering design for per-frame/epoch and readback/compute → guest WAIT → subsequent graphics, with lifetime ownership, image layouts, buffer barriers and upload retirement preserved. Earlier `docs/GPU-DRIVEN-XPR.md` recorded SRT value drift between translation and execution and rendering/device-loss failures; do not reintroduce live-SRT GPU reads.
3. Show that the isolated *entire* work unit costs enough host critical-path time and overlaps with GPU gaps to plausibly reduce Flip interval. Do not substitute a large call-count or nanosecond microbenchmark for this gate.
4. Any future patch **opt-in / default Off**, reversible, native build **only** in `_Build/latest/native-build`, packaging **only** in `_Build/latest/launcher`, gameplay **only** via `.\launcher.cmd` / Play, and pixel/world/13-world correctness plus user-visible FPS/1%-low after admission. No Off baseline requirement or multi-boot A/B imposed.

**Disallowed:** guessing larger PM4/draw/dispatch batches; removing barriers; delaying guest SRT snapshots; introducing speculative recorder threads; suppressing readbacks; reallocating build output outside `_Build/latest`; shader cache regeneration; micro G2-J reactivation.

## 6. Work performed in this session

- Verified full trace metadata and the two matching `LIVE_TRACE` / `LIVE_DONE` log records and source-device scene.
- Ran offline `frames`, `gpu` and `frame` decoder modes for **both** trace IDs; derived cross-frame union and overlap statistics read-only; independent DevSpace subagent reviewed CPU/recorder/synchronization limitations in **read-only** mode.
- Clarified misleading `WAIT_REG_MEM ==` diagnostic text in `tools/local/live-trace.py` to display only what the actual trace records. No native code modified.
- No game run by assistant, builds, packaging, shader precompilation, asset deletion or changes to private user files.

**Roadmap:** G3-A COMPLETE → G3-B1 Launcher integration COMPLETE → **G3-B2 real GPU-trace classification COMPLETE (moderate confidence)** → G3-B3 one bounded macro source/architecture proof NEXT, rendering patch not yet admitted → G3-C FPS, hitch and visual correctness PENDING. New traces are not requested unless a future specific unknown truly blocks the chosen work.
