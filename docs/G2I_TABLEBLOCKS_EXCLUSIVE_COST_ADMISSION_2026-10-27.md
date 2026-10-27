# G2-I — TableBlocks unclassified-cost audit and sampled CPU diagnostics (2026-10-27)

## Decision / scope

**Static cost-accounting audit complete. G2-I sampled instrumentation BUILT + TESTED; live G2-I data NOT YET COLLECTED.** No renderer optimization, shader mode change, PM4 batching change, guest-mapping/protection bypass, game launch, save edit, or shader cache precompile was performed.

G2-H in-game ON-only acceptance: `docs/G2H_ON_ONLY_CENSUS_RESULTS_2026-10-27.md`; **49.47/49.80 FPS** in two independent 15s windows of the same G2-H On process, with 100% **sampled** packed-level specialization. Do not mistake the existence of coverage for improved FPS; the user does not want another Off baseline and this workflow will not request one.

## Correct inclusive vs nested scope accounting

Latest user-provided native `_Build/scene-benchmark/session-C4lk7U/census-1793069546855.json`, 232 native flips, same map `m04_00_00_00`. Costs below are **instrumented elapsed ms/native flip**, not measured exclusive CPU self-time nor avoidable time.

| Scope (kind=12) | Graphics | Async |
|---|---:|---:|
| TableBlocks parent `0x7ab21/2` | **1.8013** | **0.9784** |
| Child read-only resolve `0x7ab1e/5` | 0.5879 | 0.0899 |
| Child read-only reproof `0x7ab1e/6` | 0.0374 | 0.0168 |
| **Parent minus known non-overlapping children: unclassified interval** | **1.1760** | **0.8717** |
| TablePrepareBda sibling `0x7ab21/1` | 0.0593 | 0.5027 |
| Nested ring candidate `0x7ab22/1` | 0.3549 | 0.0427 |
| Nested fallback obtain `0x7ab22/2` | 0.1209 | 0.0254 |

**Do not double-subtract ring candidate/fallback obtain**: both are nested *inside* read-only resolve. Do not subtract TablePrepareBda because it precedes TableBlocks and is a sibling. Do not add TableTry/Continue, TableEvaluate, or TableDraw parent scopes: they contain overlapping work. The **1.1760 / 0.8717** ms residual includes writable acquisition, specialization checks, resolved-buffer reuse, descriptor words, final block upload, loops, and profiler insert/update overhead; it is **not a guaranteed optimization budget**.

TableBlocks was called **5,004.18 graphics times/native flip** and **1,147.57 async times/native flip**. The source does a final stage block upload for every non-empty output, and writable buffers can call `ObtainBuffer(..., true, ...)` without a dedicated timer. Earlier D/G CPU micro-tunings had no demonstrated FPS gain; any new feature must first identify a truly expensive operation.

## Why PM4/QueueRun is NOT 16 ms of parser overhead

The outer `LiveCensus::QueueRun` (kind=9) measures the **entire** PM4 loop, including nested native draws, shader work, callback service, GPU submissions and Vulkan command construction:

| Scope | Inclusive ms/native flip |
|---|---:|
| Graphics PM4 QueueRun | **16.4903** |
| Async PM4 QueueRun (seven queues combined) | **4.4218** |
| Graphics NativeXpr attempt scopes (kind=2 a=0/1/2) | **5.3187 + 4.0234 + 0.2082 = 9.5503** |

A simple parent minus three native attempt subscopes leaves **6.9400 ms** of other work, which still contains handlers, callback synchronization, state observations, protection flushes, and loop bookkeeping. These are TSC elapsed intervals under live profiling; FPS counters use different non-census windows and thread CPU time. No causal inference from subtraction.

`src/graphics/guest_gpu/graphicsRun.cpp:950` calls `g_gpu_state->ProcessCommands()` on each PM4 loop visit. Its pending-acquire poll and, when pending work exists, its mutex/queue callbacks **must not be moved, skipped or batched**, because it orders faults/readback/guest mapping before subsequent commands. Existing native paths already batch up to 64 compatible indirect draws; larger batching touches observer state, suspension/deferred advance, protection and scheduler semantics. **No PM4 runtime changes** in G2-I.

Three independent read-only reviewers: `agt_de837e2d` (TableBlocks), `agt_ace12216` (PM4 semantics), `agt_cb7dcbcd` (reader optimized assembly). No subagent edits.

## New G2-I diagnostics, Census-gated only

Native only: `src/local/g2i-blocks-diagnostics.h`, `src/local/table-xpr.inc`. `TableBlocks` samples **one invocation every 64 calls** (per render thread, reset while Census inactive), with a fixed-size local count/cycle accumulator and RAII flush even on early `return false`. No per-descriptor hash insertion/logging or per-packet clocks; only two actual operations have timestamp pairs **when a particular TableBlocks call is selected for sampling**. Sampling is systematic and subject to periodic workload bias. `TableG2FAddCount` and new locally scoped `TableG2IAddCycles` write at sampled invocation exit into the already existing 32,768-slot render-thread census table.

Both new metrics use **kind=12** and preserve full 64-bit `b` queue tags (graphics 0, async high bit 63, outside queue bit62).

Count-only family `a=0x7ab2a`, `b=metric index 1..12 | queue`:

| b | Metric |
|---:|---|
| 1 | sampled TableBlocks invocations |
| 2 | completed sampled invocations (not early refused) |
| 3 | stages processed |
| 4 | descriptors accepted past write/read pass discriminator |
| 5 | writable/atomic descriptors |
| 6 | writable, nonzero-range `ObtainBuffer` calls |
| 7 | read-only descriptors |
| 8 | read-only entries reused (including proven shared ring copy) |
| 9 | read-only entries newly resolved |
| 10 | final block `upload.Copy` calls |
| 11 | bytes in final block `upload.Copy` calls |
| 12 | stages without a block |

Timed family `a=0x7ab2b`, `b=phase 1..2 | queue`:
- Phase **1** = sampled elapsed `buffer_cache.ObtainBuffer(address, size, true, formatted)` **ONLY**, not adjacent owner checks/texture invalidation.
- Phase **2** = sampled elapsed `upload.BufferDeviceAddress() + upload.Copy(block.data(), bytes, 16)` **ONLY**. This also counts fetching the output buffer device address but does not include preceding descriptor preparation.
- The **sum of sampled timer cycles** appears in `ms_per_frame` **for sampled calls only**; do not compare this directly to inclusive 1.8013ms full-population TableBlocks, multiply blindly by 64, or treat it as a FPS gain. `calls_per_frame` is the sampled timed-operation count.

Every guest descriptor check, `HasImageStartingAt`, CPU/GPU modification epoch proof, `ObtainBuffer` (read-write and read-only), ring observer guard, `EnsureBufferContents`, `GetBufferIfLive`, `InvalidateMemoryFromGPU`, user data, shader buffer word generation, descriptor output, upload arguments and order is retained. There is a new conditional on sampled counters in hot functions, whose overhead in normal play has **not** been measured; do not claim it is absolutely zero. No setting needed: the existing **Scene Benchmark → Profile CPU (5s)** is the explicit opt-in.

Launcher:
- `launcher-electron/scene-benchmark.cjs` focus keys `0x7ab2a`, `0x7ab2b` added.
- `launcher-electron/benchmark.js` shows graphics/async sampled descriptor mix, buffer reuse rate, uploads/call, average bytes/upload, writable acquisitions/call and the two sample-only elapsed times, with explicit warning not to compare directly with the full TableBlocks parent.
- The existing G2-D/G/H options and standard/experimental shader mode logic are untouched, so do **not** mistakenly toggle `G2-H` or require an Off baseline just to measure G2-I.

## Test/build verification (local Windows)

- New C++20 standalone test `tools/local/g2i-blocks-diagnostics-policy-test.cpp`: **PASS** with O0 assertions (accounting invariants and accumulated cycles).
- New `launcher-electron/tests/g2i-blocks-diagnostics.test.cjs`: **5/5 PASS** (sample gating, count/queue/timing key wiring, source guards for buffer safety, console parser, UI).
- Entire `cd launcher-electron && npm test`: **130/130 PASS**.
- Native `renderDraw.cpp.obj`: **PASS exit 0**; two pre-existing warnings.
- Full `kyty_emulator.exe` Release/ThinLTO: **PASS exit 0** with `--parallel 1`, backend cap `KYTY_LLD_THINLTO_JOBS:STRING=2`; executable built Oct 27 at ~10:08 local.
- Native `--shader-feature-trial-capabilities`: **PASS**, isolated experimental cache `0x3` still READY, ~6.729 GB unchanged.
- Latest Launcher package script: **PASS**; packaged Electron `--smoke-ui`: **ELECTRON_UI_SMOKE_PASS exit 0**, including existing Scene Benchmark button. Nonfatal `SCREENSHOT_UNAVAILABLE main: UnknownVizError` in GUI smoke. **No in-game G2-I Census** has been performed.

## Gates for next engineering step

**G2-I static admission: PASS. G2-I live telemetry: PENDING.** Next decision needs a *single* 5-second manual CPU Census on a normal **G2-H On-only** gameplay session (only when convenient, no Off baseline), but user action is **not required to accept the static/build milestone**. If new counters are missing, report telemetry failure/old executable, not zero. If counts fail `Descriptors = WritableDescriptors + ReadonlyDescriptors`, `WritableObtainCalls = timed phase 1 calls`, `UploadCalls = timed phase 2 calls`, or `UploadCalls + EmptyStages <= Stages`, do not use the sample.

If final uploads dominate the sampled contribution and have sufficient volume, **G2-J** may investigate safe block-upload overhead reduction, but only with generated assembly, source equivalence, and default-off rollback. If writable `ObtainBuffer` dominates, study exactly which calls are avoidable without reordering marking GPU writes or bypassing owner proofs; if neither dominates, instrument the remaining descriptor/epoch checks at a safer aggregation grain. **NO-GO for any new performance patch without attributable workload evidence.**

Game launch command when a G2-I Census is eventually requested:
```powershell
cd "C:\Users\hoang\Desktop\dev\KytyPS5"
.\launcher.cmd
```
Options Graphics: Shader Standard 0x0, G2-D Off, G2-G Off, **G2-H On only if user wants their current research configuration**; Scene Benchmark On. Profile CPU (5s) once after warmup; no precompile/shader cache operations, no fresh baseline needed. If no test, continue offline analysis next.
