# G2-B CPU Census results / G2-C admission — 2026-10-26

**Result:** G2-B capture completed; **GO for targeted, opt-in instrumentation of PM4/Table XPR producer; NO-GO for speculative behavior or Vulkan pipeline changes**. Investigation was read-only against actual G2-B results and code. No game was launched, caches/saves were not changed, and renderer was not patched.

## Evidence (noon Windows run, RTX 5070)

- **Standard:** `_Build/scene-benchmark/session-zVDjKk/results.jsonl`, `census-1792991602282.json` (223 flips, 663 scopes); native log `_Build/run-logs/20261026-121134-619.out.log`.
- **Experimental 0x3:** `_Build/scene-benchmark/session-ZEbfuN/results.jsonl`, `census-1792991829789.json` (226 flips, 672 scopes); native log `_Build/shader-feature-trial/run-logs/20261026-121516-043.out.log`.
- Each mode did `Measure FPS (15s) → CPU Census (5s) → Measure FPS (15s)`, **one boot per mode**, Standard then Experimental. Both identify RTX 5070, game map `m04_00_00_00`, guest render 1920×1080 / output 3840×2160, presentation cap 60 Hz, and correct standard/trial cache feature flags. Same map does **not** establish the same world/camera/object state. No sample interval >=50ms during the 4 scored FPS windows.
- Census header IDs/entries match one native `LIVE_CENSUS` and `LIVE_DONE` for each boot; raw full 64-bit scope keys are preserved in JSON. Stderr logs empty.

### FPS and CPU before vs after census

| Measure | Standard before | Standard after | Trial before | Trial after |
|---|---:|---:|---:|---:|
| FPS | 45.20 | 45.60 | 45.33 | 47.20 |
| 1% low FPS | 33.99 | 33.62 | 37.44 | 39.34 |
| P99 flip interval ms | 27.7 | 28.3 | 25.7 | 24.9 |
| Render-thread CPU ms/native flip | 20.35 | 20.40 | 21.07 | 20.04 |
| Recorder CPU ms/native flip | 16.69 | 16.42 | 16.31 | 16.18 |
| Render busy % | 92.0 | 93.0 | 95.5 | 94.6 |

Mean FPS **45.40 → 46.265 (+1.91% observed)**; mean 1% low **33.805 → 38.390 (+13.56% observed)**. Mean render CPU **20.375 → 20.555 ms/native flip** (Trial is slightly higher); measured graphics PM4 QueueRun is essentially unchanged. This **does not establish causal benefit from 0x3**. A different scene workload remains the largest confounder.

### Workload (LIVE_COUNTERS per native flip; mean of before/after)

| Metric | Standard | Trial | Difference |
|---|---:|---:|---:|
| Logical `table_draws` | 16,672.5 | 15,892.75 | **−4.68%** |
| `indirect_tables` | 10,222.65 | 9,834.4 | **−3.80%** |
| `table_continued` | 11,047.2 | 10,499.6 | **−4.96%** |
| `table_dispatches` | 1,421.2 | 1,427.7 | +0.46% |
| `table_ring_bytes` | 3,460,189.5 | 3,356,724.55 | −2.99% |
| `upload_wait_us` | 553.55 | 506.2 | −8.55% |
| `async_readbacks` | approx. 33.65 | approx. 33.6 | nearly identical |
| `sync_reads_render` / `sync_downloads` | 0.0 / 0.0 | 0.0 / 0.0 | rounded per native flip |

During G2-A the ring byte difference had been substantially larger (roughly −46%). Its current reduction to roughly −3% confirms cache/workload history matters. A 0.0 display of synchronous counts is rounded, not proof of absolute zero events.

Recorded shader warmup finished before measurements; **broader prefetch was still incomplete at session close** (Standard 814/12070, Trial 385/19010). Whole-session first-use totals differ (Standard 38 shader programs / 148ms and 1125 pipelines / 836ms; Trial 0 programs and 178 pipelines / 178ms) but there is no positive evidence of first-use compile hitch **inside** the measured windows. Warmup completion is not equivalent to globally idle background compiler.

## CPU Census — elapsed inclusive scopes per native flip

| Scope `kind/a/b` (shorthand) | Standard ms/flip | Trial ms/flip | Interpretation |
|---|---:|---:|---|
| `9/0/0` | **17.1326** | **17.1218** | Graphics QueueRun across ~22 PM4 processing runs/flip, includes downstream draw/dispatch/resource work, not PM4 decode alone |
| `2/0/0` | 5.2991 | 5.3898 | Two NativeXpr draw/multidraw **attempt** wrappers, including table execution |
| `12/0x7ab1e/0` | 5.0533 | 5.1795 | TableTry inclusive wrapper; **TableContinue bypasses it** |
| `2/1/0` | 4.2685 | 4.1868 | Direct indexed XPR attempt (including attempted table draw paths) |
| `12/0x7ab1f/(QueueAsync|0)` | 2.5704 | 2.6665 | Async TableDispatch inclusive |
| `9/0x50/QueueAsync` | 2.1915 | 2.2660 | Async queue PM4 processing |
| `11/0/0` | 0.1699 | 0.1679 | Command-memory sync checks incl indirect tables, **not actual GPU wait evidence** |
| `kind 6` all keys | 0.0051 | 0.0043 | Very small elapsed tracked sync-download scope total; most rounded call rates ~0 |

**The top 17 ms are accumulated across ~22 graphics queue runs per frame**, about 0.779 ms/run—not one PM4 operation. `QueueRun` includes child scopes, so all scopes (and per-queue totals) **must not be added** to estimate total CPU time. Census scopes use wall-clock-like elapsed TSC time, include waits/preemption and instrumentation, and may overlap; `record_ms` comes from separate OS CPU accounting.

### Table XPR graphics draw phases (`kind=12, a=0x7ab1e, b=phase`)

| Phase | Meaning | Standard ms/flip | Trial ms/flip |
|---|---|---:|---:|
| 1 | **TableEvaluate + TableGather** | **2.6401** | **2.6141** |
| 4 | **Emission / transitions / state / binding / draw recording** | **2.0339** | **2.1062** |
| 3 | **BDA preparation + TableBlocks** | **1.8514** | **1.8634** |
| 9 | Draw arguments/index grouping | 0.8784 | 0.8772 |
| 5 | Nested fresh V# buffer resolve (graphics only) | 0.7835 | 0.7934 |
| 2 | TableSet | 0.5170 | 0.5164 |
| 7 | Nested TableValidateSet | 0.3468 | 0.3516 |
| 0 | TableTry inclusive only | 5.0533 | 5.1795 |

Phase 1 has ~6428 versus ~6088 invocations/flip; emits are batched, so invocation count != logical table draws. In particular, phase 0 has different coverage from phases 1–4 because continued draws use `TableDraw` without `TableTry`. **Do not subtract phase 1+2+3+4+9 from phase 0 to estimate exclusive overhead.** Phase 5/6 are nested within phase 3; 7 inside phase 2, 10/11 inside 9.

### Table XPR compute dispatch

`kind=12, a=0x7ab1f`: async phase 0 inclusive **2.5704 / 2.6665**, phase 3 BDA/blocks/indirect-args **1.4645 / 1.5168**, phase 1 evaluate+gather **0.5202 / 0.5306**, phase 4 emission **0.3200 / 0.3413**. Graphics dispatch has separate b with QueueAsync unset; do not merge them or call shared helper scopes graphics-only.

No kind 4/5 waits were collected. Kind 13 barriers are **count-only with 0 cycles by design**; their `0.0000 ms` is not a barrier-cost measurement.

## Admission / next steps

**G2-B observed hotspot:** PM4 producer + Table XPR preparation. The biggest already-timed draw sections are evaluate+gather (~2.6 ms/flip), emission (~2.0 ms/flip), BDA/blocks (~1.85 ms/flip); async compute TableDispatch phase 3 (~1.5 ms/flip) is separately notable. **These are candidates for further split, not proofs an optimization improves steady-state FPS.**

**GO for G2-C diagnostic instrumentation only:**

1. Scope `TableContinue` and `TableTry` separately and record attempted / successful / fallback counts so the census denominators match.
2. Split draw phase 1 into `TableEvaluate` vs `TableGather`, with bounded counters for runs/slots/words and packed vs slow fallback. Keep tags/scope active **only when census enabled**; preserve normal renderer behavior.
3. Split draw/dispatch phase 3 into BDA preparation, blocks, writable/held/read buffer resolution, indirect argument preparation. Distinguish graphics from async and helper context.
4. Narrow timer on V# ring branch: map/allocation, `TryReadBackingToHost` copy, commit, shared/held reuse and fallback/invalidation; avoid per-packet logging and extra guest accesses.
5. If emission remains expensive, break phase 4 into render target transitions/BeginRendering, dynamic state/binds/pushes, and draw recording.
6. Benchmark same **camera/character position**, frame workload, screen, graphics settings, with explicit A–B–B–A distinct process boots. Record background compilation/prefetch state and census overhead.

**NO-GO:** changing indirect-count API, dropping barriers, weakening buffer dirty/ownership invariants, broad batching, skipping TableEvaluate or changing runtime semantics, promoting shader trial 0x3. All need a narrow hotspot, correctness proof and measurable matched-workload A/B.

## Known limitations / caveats

Native census has 32,768-slot open-addressing table with no overflow count, start/stop of collection use 100ms heuristic drains without a render-thread acknowledgment, and reports rounded per-flip numbers after calibrating TSC. `frames` is clamped to at least one in native code, with 1-frame reports rejected by the Launcher. The source does not report intrinsic timing overhead; short tiny phase differences are not causal. There are only **one census and two adjacent 15-second measurements per mode** in the current data. No exact-view screenshot/coordinate match is preserved.

Independent read-only subagent reviews: `agt_7c81c9e2` (full phase breakdown), `agt_7fcdd7da` (warmup / before-and-after / source correctness).
