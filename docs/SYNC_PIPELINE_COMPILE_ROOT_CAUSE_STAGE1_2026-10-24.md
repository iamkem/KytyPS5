# Demon's Souls 1.07 / KytyPS5 — synchronous compute-pipeline stall investigation (static stage, 2026-10-24)

## Scope and safety

User request: investigate why CPU render thread stalls while creating compute pipelines, and whether integrated features cause it. Used only existing source, 24 Oct 2026 gameplay logs, compiler and unit tests. **Did not launch game, run shader precompile, delete/change cache, change user settings, touch game saves, push/commit or edit the main dirty checkout.** Patch in integration worktree only. It rebuilds the pre-existing native output executable in `_Build/latest/native-build` but does not run it.

## The 49-second hitch is real and precisely bounded

Source log `_Build/run-logs/20261024-083902-329.out.log`, lines 5609–5628: consecutive synchronous `SLOW CreateComputePipeline` with compute program IDs 5019–5026 and distinct shader hashes:

| ID | `CreateComputePipeline` duration (ms) |
|---|---:|
| 5019 | 5,480.3 |
| 5020 | 6,391.8 |
| 5021 | 5,737.6 |
| 5022 | 6,407.1 |
| 5023 | 5,739.1 |
| 5024 | 5,678.8 |
| 5025 | 6,719.2 |
| 5026 | 7,144.0 |

Together **49,297.9 ms**, within `SLOW Frame 49,385.6ms, cpu=49,233ms, compile=49,328.8ms, record_wait=1.0ms` at line 5628. Approx. 99.82% of the frame-duration magnitude is accounted for by these eight source scopes. The slow timer begins **after** acquiring `PipelineCache::m_mutex`, so lock *acquisition* is not the recorded delay. Source scope includes pipeline layout, binary/driver-cache lookup, Vulkan pipeline creation and some following bookkeeping; cannot attribute all 49.3 seconds to one internal driver call.

Log end-of-session: **3** on-demand shader translations (**24ms** total), **2,767** on-demand pipelines (**80,813ms** total). **3,206 static binary hits / 3,090 absent** on the static-store path; *zero damaged/refused/unkeyed*. Static-binary store opened 67,097 pipeline records, 5,690 MiB total, with lazy per-key payload reads; this is NOT equivalent to 67K loaded Vulkan pipeline handles. `Pipelines out of video memory: 544 made again (1,427ms total; max 88.1ms)` across entire session, far too small to explain this **one** 49s frame. Earlier and later sessions show severe stalls even with zero remakes. No `PIPESRC`/`PIPESPV` per-call stage breakdown in the captured runs, so the exact eight shader IDs cannot be classified into static hit, disk reading, `vkCreatePipelineBinariesKHR`, cache-probe success, full fallback or NVIDIA driver execution.

## Correct implementation path in source

- `src/graphics/host_gpu/renderer/renderCompute.cpp` dispatch path calls synchronous `PipelineCache::CreateComputePipeline`.
- `src/graphics/host_gpu/renderer/pipeline/pipelineCache.cpp` lines ~4165–4216 takes `m_mutex`, tests in-RAM cache, then executes `CreatePipelineInternal` with `FirstBuild`. `LiveCensus::WaitScope(WaitCompile)` spans this work. `FirstBuild` selects Fast by default on NVIDIA.
- `src/graphics/host_gpu/renderer/pipeline/shaders.cpp` lines ~1329–1407 constructs descriptor/pipeline layouts and compute-stage create info, invokes `CreatePipelineHandle`, which checks key-exact static and played pipeline binaries, then driver-cache probe/fallback. Real Vulkan creation is `graphics.device.createComputePipelines` inside the returned callback. **Fast mode tries a driver-cache hit before fallback to `eDisableOptimization`; this does not guarantee fast cached creation or binary import.**
- Table compute is intentionally asynchronous `TryCreateComputePipeline` on `TableWorkers()` and uses `native_bindings=true` and a different cache; it cannot simply be swapped for the normal pipeline with the same guest shader hash. The 08:39 log contains multi-second table async builds of several of the **same guest shader hashes** later/elsewhere in the same process as the stalled normal compute builds. Source creates about half of hardware-concurrency table worker threads. This **supports a contention hypothesis** but log line timestamps do not prove a simultaneous driver bottleneck or a safe concurrency limit to choose. **Do not cap workers or disable Table XPR without a matched A/B.**
- Source warmup minimum is **24,576 MiB**; actual `LocalPlatform::PhysicalMemory()` was **24,499 MiB**, 77 MiB below. Four most recent sessions and 08:39 all report `Shader warmup: recording only`, `Pipeline warmup: skipped`. This *causally explains why recorded pipelines may need first-use creation*, not why the Vulkan call sometimes takes 5–7s. Forcing startup warmup would risk gigabytes of added RAM; this machine had mere **hundreds of MiB available** during the historical extreme-stall session and a previous MEMORY_MANAGEMENT BSOD. **Do not bypass the safeguard.**
- RAM Safety / shader prefetch limits constrain background worker progress; they can leave the render thread a first-use translation, but the 08:39 run translated only 3 programs on demand, so **translation is not the dominant cause of that specific 49s burst**. RAM Diet's remakes are similarly ruled out as *primary cause of this burst* by measured totals. DLSS, Distance Detail, Texture Reduce, FG and OC audit have no demonstrated causal linkage in these logs.

## Concrete source bug found and safely fixed

At `pipelineCache.cpp` inside `ProgramCache::WaitForMemory`, the old line:

```cpp
if (p.Followed() != nullptr) return true;
```

consumed a pending priority-window shader group **only as a boolean predicate**. `Prefetch::Followed()` increments `window.next` under `follow_mutex` before returning its pointer. The selected group could lose its follow-queue opportunity even though it had not been executed (it may still be translated by general queue later). This is a verified scheduling bug, especially noticeable when prefetch is RAM-throttled.

The isolated integration worktree changes `WaitForMemory` from `static` to an instance method so that it may **execute exactly the selected group**:

```cpp
if (auto* group = p.Followed()) {
    if (RunGroup(p, *group)) p.followed.fetch_add(1, std::memory_order_relaxed);
    return true;
}
```

`RunGroup` already performs atomic `Pending -> Running` compare/exchange, so racing with other prefetch/follow workers cannot translate the same group twice. This is the same priority exception explicitly allowed by `PrefetchWork` before the low-memory pause; it **does not increase worker count, adjust the 1/4-GiB prefetch gates, enlarge caches, or enable startup warmup**. Existing memory-pressure loop and 250ms sleep remain intact.

Independent read-only reviewer verified the consumed-follow fix has no new double-processing, deadlock or loop issue: `RunGroup` uses an atomic claim. It also found a **pre-existing input lifetime race** in `PrefetchWork`: when the sequential cursor reached `p.groups.size()`, the code `swap(p.inputs.records)` could free records still being consumed by another priority/follow worker's `PrefetchTranslate`. Removed that premature free; the existing `Prefetch` destructor already joins all worker threads **before** inputs are destroyed. Also renamed the early progress log to say **sequential slots visited**, not every shader translated. This **does not add memory at peak**, but if all 20K sequential slots finish well before the game ends, input records will remain resident until the prefetch is destroyed instead of being released early; conservative lifetime correctness was prioritized over premature memory reclamation. No new allocations/workers were introduced and no RAM pressure limit was raised. The existing priority-queue exception can still process requested shader groups below the speculative-prefetch memory threshold.

Native `kyty_emulator` incremental Windows C++ compile + link **PASS** (3 existing unrelated compiler warnings); full launcher unit suite now **67 total, 61 PASS, 0 FAIL, 6 SKIP**, `git diff --check` PASS. New structural regression tests in `launcher-electron/tests/prefetch-follow-memory-regression.test.cjs` check that a selected priority group is actually attempted and that input records are not freed before worker join. These are **structural tests, not dynamic concurrency stress tests and not proof of in-game stutter improvement**. The patched executable is in the established `_Build/latest/native-build/kyty_emulator.exe`; no game was run.

## Other code findings (not modified)

1. **Driver-cache persistence:** `SaveDriverCache` returns early if byte `size == saved_size`, so new content of the same size could be ignored. This is a possible source-proven persistence omission, but **unconfirmed as an issue on these NVIDIA runs** and changing it could read/hash hundreds of MiB on every save; not a safe blind performance patch.
2. **Save-vs-create overlap:** periodic saves can overlap pipeline creation. The 08:39 log shows cache saves between slow creates; such work might compete for driver locks, CPU or paging, but **the log does not prove contention caused the 5–7s delays**. Do not add unverified locking/serialization to the render thread.
3. **Shared binary mutex:** static binary loader serializes shared payload initialization including I/O and `vkCreatePipelineBinariesKHR`, but cannot identify the slow shader IDs without per-call evidence. A lock redesign requires full thread-safety verification and may create more memory pressure.
4. **In-RAM cache lock scope:** `CreateComputePipeline` holds `m_mutex` while the synchronous pipeline is built; avoiding lock would require correctness-proven reservation/publication and cannot eliminate the render-thread's need for this pipeline.

## Decision / next gate

- **GO** only for the tiny self-evident shader-follow queue correctness fix, verified by compile and structural regression test; **do not claim FPS/1%-low gains**.
- **NO-GO** to bypass RAM warmup guard, add new cache copies, redo offline precompile, reorder pipeline validation, disable DLSS/XPR or add speculative source-level parallelization.
- A real fix for *49s Vulkan pipeline creation* needs per-call separation of binary lookup, file/decompression, binary import, driver-cache probe and Vulkan call. `KYTY_PIPELINE_SOURCE_LOG` already exists but would produce verbose in-game logging and has **not been enabled or requested**. Do not ask for repeated runtime A/B until there is a concrete low-risk modification with a useful correctness/performance gate.
