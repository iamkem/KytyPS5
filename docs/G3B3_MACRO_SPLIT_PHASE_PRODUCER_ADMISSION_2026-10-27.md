# G3-B3 — Macro split-phase producer admission audit (2026-10-27)

**Decision: NO-GO on a renderer patch or new worker at this checkpoint.** G3-B3 *architecture feasibility review* is complete; G3-B3 *performance optimization implementation* is **NOT ADMITTED**. This is a concrete negative research result, not an FPS improvement or a new gameplay milestone. G2-J micro-tuning remains DEFERRED.

## Scope and evidence

- Checkout `C:\Users\hoang\Desktop\dev\KytyPS5`; branch `integration/chenxiao-v20261023b-20261023`, starting HEAD `e4ae0177`.
- Real RTX 5070 same-boot, user-captured data: `_Build/scene-benchmark/session-iouw5o/gpu-trace-1793075199227.bin` (85 interior Flip windows) and `gpu-trace-1793075217510.bin` (95 windows), each with matching `.hz` and `gpu-timeline-results.jsonl`. Interpretation and caveats: `docs/G3B2_REAL_GPU_TIMELINE_MACRO_CRITICAL_PATH_2026-10-27.md`.
- Per Flip: native interval 22.93 / 20.62 ms, GPU command-buffer timestamp union 11.24 / 11.19 ms, producer explicitly idle 0.50 / 0.70 ms, guest readback-wait **union across overlapping guest threads** 7.82 / 7.33 ms. This indicates **work-feed pressure**, but no exclusive CPU work unit can yet be credited with an avoidable fraction of the interval. None of these uncovered timings is a performance budget.
- Independent read-only DevSpace reviews: `agt_68189457` (shader-plan/PM4 offload feasibility), `agt_fe60210a` (scheduler/recording/WAIT alternatives). Both returned **NO-GO** for immediate code changes. No source or userdata changed by reviewers.

## Hypothesis #1: hoist immutable TablePlan / TableRuns / TablePack

**Structural suitability: LIMITED; throughput eligibility: NOT PROVEN.**

1. `src/local/table-xpr.inc:2001-2087` `RenderExecutor::TableRuns` derives slot runs, dependency levels, flat operand arrays and unbounded-level metadata from previously compiled shader programs. `:2089-2169` `TablePack` materializes the packed form. Parts of the calculation are a candidate for pure worker execution **if redesigned** to consume immutable snapshots.
2. But `TableRuns` actually mutates `TablePair`, `table.addresses` scratch, vectors and packed-block spans. `TableStore` only calls it the first time a shader pair's program is installed (`:2209-2214`), as does compute `TableDispatch` on first program (`:2355-2357`). It is not the normal ~10.8k logical-draw-per-Flip recurrent path. A shader replacement, respecialization or program/map generation change can invalidate it, and `TableSweepPairs` can erase an unused pair.
3. Supporting diagnostic only: the **single launcher game-run output log** `_Build/run-logs/20261027-112542-992.out.log` has 650 `Table: VS` initialization messages, 629 **before the first trace completion header**, 20 between the two trace completion headers, 1 afterward. These are log positions and not in-capture timestamps or a timed cost; no exclusive TableRuns time is measured. Count does not prove optimization potential.
4. `pipelineCache.cpp:529-567` already sends out-of-memory resource-plan reloads to worker jobs in batches (up to four plans/job); `:584-608` retains synchronous fallback when needed. `:1330-1341` places compiled-shader-info extraction and IR destruction on compile workers. Simply adding another worker for similar pure work risks redundant scheduling, copies, stale work and cache contention.
5. **NO-GO now:** without measured recurrent producer cost and a strong version/lifetime contract, additional worker thread or speculative plan hoist does not have a plausible, proven macro frame benefit.

Potential *future* proof if a first-use hitch specifically points to `TableRuns`: own immutable program descriptors and shader code-address version, immutable completed plan result, producer-side generation/pair existence check, single ordered installation under producer, no table scratch touched from worker, stale-result cancellation at `TableReset` and `TableSweepPairs`. This is a **loading/hitch branch** until runtime evidence says otherwise, not a steady FPS patch.

## Hypothesis #2: parallelize or batch guest PM4

**NO-GO.** `src/graphics/guest_gpu/graphicsRun.cpp:947-1060` polls `ProcessCommands()` at each PM4 loop, observes predicates, start-instance state and packet side effects, and flushes page protections before state-changing packets. `:625-780` has one producer, frame-epoch eligibility, blocked queue requeue and ordered callback/guest-fault delivery. PM4 and user-data snapshots are **not immutable** between packets; a producer-independent PM4 predecode/translation unit was not demonstrated. `docs/GPU-DRIVEN-XPR.md` records observed translation-time vs execution-time SRT drift and graphics corruption in earlier GPU-driven experiments.

**Existing batching is nontrivial:** `src/graphics/host_gpu/renderer/commandScheduler.cpp:196-315` adapts draw/dispatch flush size based on backlog/GpuBusy, and defers only legal flush points; `src/local/vulkan-recording.cpp:178-320` already runs ordered replay on `Kyty.Record`. Increasing batch size or splitting recorder threads by assumption can delay GPU work, lose Vulkan ordering or violate buffer/image ownership. No trace demonstrates it would shorten frame time.

## Hypothesis #3: remove readback/WAIT latency or Vulkan recording overhead

**NO-GO for a shortcut; dependencies remain a research co-factor.**

- Plain `trace 2` samples include thousands of `FrontSuspend` markers and guest `GuestReadback` begin/end scopes, but no `tracew` GPU_WRITE producer-range provenance. `WAIT_REG_MEM` is a failed condition check (not measured stall duration), and guest readback scopes include callbacks, GPU copy availability and CPU-side copying. Concurrent guest waits overlap. **No causal proof** of redundant synchronization or safe hoist is present.
- **Additional existing evidence (no new capture):** plain traces do contain `RbFast` events (type 30) with the selected graphics producer tick: **2,205 / 2,258 events**. Of those, the independent `TickDone` monitor had already recorded that tick before the event in **1,946 / 1,960** cases; 253 / 298 were monitor-observed later (six in A had no matching monitor record). Crucial source reconciliation: `bufferCache.cpp:599-617` `ReadbackQueueReady` intentionally chooses this path **only when tracked writes are finished** and sets the copy's wait tick to the already completed master tick; the monitor thread's later `TickDone` does **not** mean the producer was unfinished. Thus the ~88% / 87% observed-before metric is largely expected by construction, **not** an avoidable GPU-writer stall or speedup budget. The `RbFast` source tick is not a whole readback GPU-write provenance map.
- The *remaining potential macro handoff* is after fast-copy admission: `readback-queue.h:151-205` sends a copy to a separate transfer queue, with its own timeline and ordered deferred recording; `bufferCache.cpp:619-640` waits for copy completion, priority operations, then invalidates host-visible memory and calls `WriteBackGpuOwned`. The current trace has no distinct transfer-queue GPU timestamp pair or exclusive split timing for transfer completion versus CPU copy. Therefore a transfer/guest write-back optimization remains **NOT ADMITTED**.
- In `src/graphics/host_gpu/renderer/commandScheduler.cpp:609-650`, worker `GpuSubmit(b=1)` is emitted **before** vkEndCommandBuffer, queue mutex and Vulkan queue submit; current replay-entry latency does not measure entire driver/recording work. The historical ~14.9ms record CPU is concurrent with the producer and is not an additive wall-frame cost.
- Vulkan barriers, writable BDA image aliases, `PageManager` protection and callback order, guest GPU read/write ownership, command-buffer lifetime, and GPU timeline retirement are correctness gates. No blanket relaxation.

## Concrete next gate, no speculative phase loop

1. **Steady-state throughput:** before any G3-B3 native patch, identify a recurring *entire category of producer work*, not a micro-helper, that is independent of guest-memory observations and has **measured exclusive critical-path impact** in an existing Census/traced evidence set. The existing G2-I `QueueRun` / `TableBlocks` data are inclusive/nested; cannot designate their aggregate as an avoidable budget.
2. **Dependency-bound alternative:** map a *named* compute → copy/readback → guest WAIT → subsequent graphics chain with proof of producer/source tick, completion dependency and end-user frame delay. The current plain traces cannot establish GPU write provenance. Do not install new GPU/host synchronization, skip copies or use `tracew` casually: only a short, bounded user-controlled follow-up would be justified **after** naming a specific causal unknown.
3. **Recorder-bound alternative:** require a bounded estimate of `vkEndCommandBuffer`/queue-lock/actual `QueueSubmit` delay (not just existing `replay_start`), and a correctness proof that scheduling work across workers preserves Vulkan command-pool and submission ordering. No evidence for extra threads yet.
4. If none of these admission conditions is met, **STOP / NO-GO** rather than create speculative default-Off runtime branches, new timers, or repeated A/B/Off baseline requests. The best next research pivot is the **whole-frame guest compute/readback/PM4 causal dependency graph**, not moving first-use plan preparation blindly. A new runtime capture or renderer build is **NOT REQUESTED** at this checkpoint.

## Preservation and verification

- G3-B3 contains **source/log-only research** and this report. No native/Launcher source change, no build, package, game launch, precompile, or shader-cache/save modification. All local untracked private assets retained.
- All future builds **only** `_Build/latest/native-build`; all future Launcher packaging **only** `_Build/latest/launcher`; gameplay **only** user-started `.\launcher.cmd` then Launcher **Play**, with On-only preferences. G2-J DEFERRED.
- Acceptance: **G3-B3 architectural rejection documented; G3-B3 code/optimizer NO-GO; G3-C runtime 1%-low/pixel/13-world unchanged and not implied by static findings.**
