# G2-E TableEvaluate subphase census — Results & G2-F admission (2026-10-26)

## Verdict

**G2-E native census PASS (3×5s, single standard-mode boot).** **GO for narrow G2-F branch-frequency instrumentation of dependent guest reads and locate/prefetch; NO-GO for any default-on or correctness-risking memory optimization.** There is no valid 15s FPS sample in this G2-E session. The measured subphase times are inclusive CPU elapsed under an instrumented 5-second census, not GPU execution time or achievable FPS savings.

No renderer behavior was changed, no game launched, no shader precompile, and no save/cache change was made in this results-analysis pass.

## Evidence and provenance

- Current source commit before report: `96ce97f7`, KytyPS5 Windows, RTX 5070; `src/local/table-xpr.inc`, `src/local/native-xpr.inc`, `src/local/live-census.h`.
- User-produced folder: `_Build/scene-benchmark/session-zLVxSn/`, files:
  - `census-1793000375215.json` (265 native flips, 782 census entries).
  - `census-1793000392368.json` (239 native flips, 862 entries).
  - `census-1793000421367.json` (242 native flips, 749 entries).
  - `census-results.jsonl` holds matching summaries/focus entries. **No `results.jsonl` for G2-E**, so no claim of before/after frame-rate improvement.
- One native stdout: `_Build/run-logs/20261026-143743-741.out.log` (stderr size 0), with `LIVE_CENSUS id=...` and exact `LIVE_DONE` for all 3 IDs.
- Logged: `Translation features 0x3 off`, `KYTY_TABLE_READONLY_PASS_SKIP=0`, `Scene: m04_00_00_00`, present cap 60Hz. Native G2-E binary path correct.
- Startup warmup reported `10306/10316` permutations and `1687/10407` pipeline recipes in about 55 s, no shader prefetch records left. Pipeline warmup completion is not global exhaustion of recipes or proof of no future first-use compilation.
- All 3 samples belong to **one process boot** but show different graphics workloads; same scene ID doesn't establish exact camera/character state.

## Timings (ms per native flip, scopes kind=12, graphics queue, `a=0x7ab25`)

| Scope | Census #1 (265 flips) | #2 (239 flips) | #3 (242 flips) | Mean #2 + #3 |
|---|---:|---:|---:|---:|
| `0x7ab20/1` **TableEvaluate inclusive parent** | 1.7716 | 2.4551 | 2.4352 | **2.4452** |
| phase 1 setup / mapping epoch | 0.0334 | 0.0465 | 0.0451 | **0.0458** |
| phase 2 locate, mapping checks, prefetch issue | 0.4748 | 0.6609 | 0.6598 | **0.6604** |
| phase 3 **grouped dependent `NativeXprReader` reads** | **0.5637** | **0.7917** | **0.7859** | **0.7888** |
| phase 4 descriptor / LOD output | 0.1878 | 0.2554 | 0.2529 | **0.2542** |
| phase 5 indirect image enumeration | no entry | no entry | no entry | no observed invocation |
| parent minus measured subphases | 0.5119 | 0.7006 | 0.6915 | **0.6961** |

The phase-3/2 subtotal is **~1.449 ms/flip = 59.3% of inclusive TableEvaluate** in the two later samples. Within only the timed children, reader ~45%, locate ~38%, descriptor ~15%; this does **not** establish that their entire times are avoidable. The parent-minus-children residual includes stage setup, loop control, timings and the child scope's hash-table insertion/aggregation overhead, **not measured exclusive time**.

Async queue (keep separate):
- Inclusive Evaluate **0.4806 / 0.4905 / 0.4653 ms/flip**.
- Locate **0.1429 / 0.1414 / 0.1386 ms/flip**.
- Dependent reads **0.1673 / 0.1666 / 0.1626 ms/flip**.
- Descriptor **0.0287 / 0.0281 / 0.0266 ms/flip**.
- Nonempty indirect images only in census #2: **4.74 groups/flip**, **0.0149 ms/flip**, other samples none. Not priority.
- Async TableBlocks of roughly ~1.0ms/flip remains a separate contender, not included in Evaluate.

## Workload and measurement-effect limits

| Graphics queue | #1 | #2 | #3 |
|---|---:|---:|---:|
| TableEvaluate calls/flip | 3,555.53 | 4,938.74 | 4,920.07 |
| Packed-stage calls/flip (`a=0x7ab26,b=1`) | 6,708.03 | 9,326.69 | 9,290.16 |
| Locate/read *dependency-level groups*/flip (each phase) | 10,959.72 | 15,383.62 | 15,317.87 |
| Operand fallback stages/flip (`b=2`) | **No entries** | **No entries** | **No entries** |

First sample processes ~38–39% fewer evaluations and level groups than samples 2 and 3, explaining much of its lower total time. Inclusive graphics Eval time/call across samples is **~498/497/495 ns**; grouped read time is **~51.4 ns per measured dependency level**; grouped locate time **~43 ns**. These are **instrumented intervals**. Their apparent stability is evidence for workload scaling, not evidence of a performance regression or improvement.

At graphics sample #2, roughly **30,767 level-scoped timing intervals/flip** exist just for locate/read, in addition to setup/descriptor scopes and ~9,327 count-only packed-stage table updates. Both phase timers record TSC intervals and update a 32,768-entry census hash table, with bookkeeping charged outside the child clock but inside TableEvaluate. **Profiling overhead can materially affect the inclusive parent**, especially when the measured intervals themselves are only tens of nanoseconds. No uncontaminated steady-state FPS measurement accompanies G2-E; do not extrapolate 0.79 ms into a promised FPS uplift.

The result shows **every observed evaluated stage uses the packed path**. There is no evidence that optimizing `by_operands` would help this particular scene. Missing census keys are evidence of **no observed invocation during these windows**, not unconditional impossibility.

## Source-backed interpretation and G2-F target

`TableEvaluate` follows dependency levels, explicitly locating/prefetching their runs before calling `NativeXprReader::Read`. `locate` already caches 16-KiB mapped-page proofs in a 256-entry epoch-invalidated array and checks all covered pages before issuing 64-byte-line prefetches. Do not remove bounded-range checks, full mapping proofs, signed offset handling or prefetch-before-read order.

`NativeXprReader` already:
- Reuses the **last 4-KiB page's read-watcher decision** within one TableEvaluate invocation.
- Uses an acquire-loaded read-granule bitmap before consulting `HasReadWatchers`, preserving watched-memory semantics.
- Uses an inlined short word-copy loop when `count <= 16`, then `memcpy` for longer direct reads.
- Routes watcher-protected or cross-page reads to `NativeXprReadWords`, which can read watched-aware spans/words and GPU-clean/GPU-dirty backing.

Thus proposing to 'introduce last-page caching', 'inline small memcpy' or bypass read watchers would either duplicate existing code or endanger correctness.

**G2-F next gate (read-only diagnostics first):**

1. Collect **census-gated aggregate counters**, separated by graphics/async, preferably one flush per evaluation (not hash updates per word), for **reader path**: same-4K-page reuse, page changes, granule-shortcut hits, exact watcher checks/results, direct-small/large bytes and calls, crossing-page and watched-aware slow-path calls/words.
2. Collect **locate** 16K mapping-cache probes/hits/misses/failed mapping checks, line-prefetch issued counts and **immediately duplicate cache-line prefetches within precisely defined dependency-level scope**. Do not add timestamp per run/word/page.
3. Avoid large header edits; attach diagnostic logic to the same `renderDraw.cpp` inclusion to keep native build small. Use fixed-size counters and no runtime allocations or additional guest memory queries.
4. Only if duplicated prefetch lines are frequent, consider **default-Off G2-F** test suppressing immediately duplicate advisory prefetch instructions (while preserving every guest check/read and level-order). Alternatively, if direct-read fallback dominates, study a **semantics-preserving** reader optimization with replay/path equivalence tests—not unsafe direct copies.
5. Validate with a bounded native compile/link (Ninja `--parallel 1`, ThinLTO `KYTY_LLD_THINLTO_JOBS=2`), controlled gameplay, matching table-draw counts, screenshots/visual correctness and **census OFF** during compared 15-second FPS samples. Merely measuring the two modes with profiler ON is not proof of an FPS gain.

**GO:** close G2-E evidence and proceed to G2-F micro-path diagnostics. **NO-GO:** optimizing the packed/fallback choice, speculative watcher-page cache changes, dropping mapping/dirty checks, modifying Vulkan barriers, or promoting shader 0x3 / G2-D based on these observations.

Independent read-only technical reviews: `agt_cfa191f4` (profile validity, timer overhead), `agt_2a6996cd` (reader correctness risks and conservative alternatives).
