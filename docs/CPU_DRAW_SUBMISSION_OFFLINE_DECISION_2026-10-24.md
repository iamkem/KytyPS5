# KytyPS5 / Demon's Souls 1.07 — CPU Draw Submission: offline feasibility gate (2026-10-24)

## Decision

**Do not implement another draw-submission optimization or add another measurement toggle now.** CPU draw submission is a credible *historical* bottleneck, but this current user's four gameplay captures contain no stable direct recording-thread CPU-time or `TableDraw` per-call profile sufficient to show a new optimization target. The four runs were intended as a different experiment (engine culling), so do **not** misrepresent them as an A/B of CPU draw submission. No new game runs, shader precompiles, save swaps, cache clears, GPU trace instrumentation, or source edits were performed for this gate.

## Existing credible evidence (historical source benchmarks, not this user's RTX 5070)

`docs/GPU-DRIVEN-XPR.md` records a same-process native-vs-table improvement of roughly 45.0/45.3 FPS to 49.6/49.8 FPS in 1-1, and 45.5/45.7 to 53.8/52.1 in Latria (`§3.7`). After warm-up it records native ~45 FPS vs table 52.4–52.6 FPS (`§3.12`). This is credible *prior benefit already incorporated into the present renderer*, not an available further gain. Existing accelerated code paths `TryNativeXprDraws`, `TryDrawIndirectRun`, `TableDraw`, and table compute are already active. The historical same-source `§3.3–3.14` also documents serious regressions when GPU-table access or premature buffer capture violates data ordering, so speculative batching/caching is high risk.

## Offline replay of the four user's 2026-10-24 logs

Read (without launching the game) these four files under `_Build/run-logs/`: `20261024-095032-417.out.log`, `20261024-095223-561.out.log`, `20261024-095431-850.out.log`, `20261024-095632-374.out.log`. Parsed only `SLOW Frame` events **>= 100ms**. These are threshold-selected episodes; they are **not** a complete FPS profile, and counters measure different overlapping pieces rather than disjoint totals:

| Run | Slow frames >=100ms | with `compile` | `compile` sum (ms) | `record_wait` sum (ms) | max slow frame (ms) |
|---|---:|---:|---:|---:|---:|
| Original | 32 | 26 | 4,751.0 | 132.2 | 1,997.2 |
| Virtual | 28 | 21 | 4,631.7 | 144.5 | 2,719.8 |
| Light | 25 | 20 | 4,118.5 | 112.0 | 1,757.9 |
| Combined | 26 | 20 | 3,561.5 | 123.3 | 2,483.1 |
| **Across all runs** | **111** | **87** | **17,062.7** | **512.0** | — |

Interpretation: **most logged severe hiccups include time categorized `compile`**, not `record_wait`; a single Combined hitch logged `SLOW Frame 881.7 ms`, `cpu=800.9`, `compile=757.6`, `record_wait=6.1`. However, `record_wait` tracks waiting for the recording thread; **small `record_wait` does not prove recording-thread CPU work is cheap**, and `compile` is a broad logged category, not exclusively driver `vkCreateGraphicsPipelines`. Other long frame walls (e.g. 2.5 seconds) are *not* completely explained by the tagged counters. The logs have no `LIVE_* measure` output or continuous `record_ms`/`render_ms` time series. **Thus they do not support a percentage FPS gain or diagnosis that current steady FPS is CPU submission-bound.**

## Bounded next step; no repeated trial-and-error

- **Now:** NO-GO for source changes to draw recording, command buffer batching, Vulkan pipeline reuse, or PM4 fallback paths. Do not reactivate deprecated audit/pipeline-reuse controls. Do not create any new UI or metrics.
- **If a future confirmed sustained CPU frame bottleneck exists:** use the existing `KYTY_LIVE_FILE` `measure <seconds> <label>` endpoint which *already* records `fps`, `render_ms`, `record_ms`, `render_busy`, `low1`, `p99_ms`. The helper `tools/local/bench-windows.py` can replace/move user saves via `prepare/reset`; **do not invoke those destructive/interactive helpers automatically**. A single short user-approved same-scene sampling with *current* source would separate busy recording CPU from render/GPU wait. Only then select a specific routine that dominates measured CPU time, and require semantics/test/screenshot/FPS gates before implementation.
- **Near-term substantive target supported by current telemetry:** investigate why on-demand shader/pipeline work repeatedly contributes to large `compile`-classified hitches, while retaining existing static cache and not triggering shader precompile on the user's memory-constrained system. This is **not** a draw-submission optimization; keep the initiatives separate.

## Safety and scope

Game never launched and precompile never invoked. No game saves, shader caches, user configuration, main checkout, native C++/JS code, or packaged application modified by this assessment. Existing memory pressure below 1 GiB available and earlier `MEMORY_MANAGEMENT` BSOD argue against unattended gameplay or heavy instrumentation. Unrelated dirty sources in the main checkout remain preserved.
