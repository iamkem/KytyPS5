# G2-F — Sampled NativeXprReader / TableEvaluate Mapping & Prefetch Diagnostics (2026-10-26)

## Status / decision

**Diagnostic source + native emulator executable + Launcher built; no actual G2-F game census yet.** This is **instrumentation, not an FPS optimization**. No shader translation changes, GPU→CPU readback shortcuts, Vulkan barriers, save/cache maintenance, extra guest queries, or heavy precompile. Native game was not launched during this implementation.

Earlier baseline and rationale: `docs/G2E_CENSUS_RESULTS_G2F_ADMISSION_2026-10-26.md` (3 actual G2-E native censuses from one standard-mode boot). On the matching workload, graphics `TableEvaluate` ~2.445 ms/native flip, grouped reads ~0.789, locate/check/prefetch ~0.660, descriptor ~0.254, setup ~0.046. These are *instrumented CPU elapsed times*, not guaranteed potential savings.

## Implementation

### Native, `renderDraw.cpp` only

- New header `src/local/g2f-evaluate-diagnostics.h`: small fixed-array counter accumulator, constant `SampleEvery=32`, and precisely scoped **consecutive issued-line prefetch duplicate** helper.
- `src/local/table-xpr.inc::TableEvaluate`: only when **manual native CPU Census** is active, sample **one evaluation in 32** (fixed systematic sampling of that render thread; no randomization or dynamic allocations). All return paths use RAII to publish counters, including rejected/unmapped/fallback paths. The packed and fallback branches keep all existing guest accesses, validations, image/LOD construction and short-circuit ordering.
- One optional counter pointer flows to `NativeXprReader`, **only** for `TableEvaluate`. `NativeXprGather` still constructs the reader without counters.
- `NativeXprReader::Read` retains the previous watcher-decision cache for the last 4KiB page, acquire granule bitmap load, exact `HasReadWatchers`, direct <=16-word inline loop, direct >16-word memcpy and watched/cross-page fallback `NativeXprReadWords`. The fallback still attempts `TryReadGpuShaderSpan` in 16-word chunks and otherwise reads watched-aware single guest words. Diagnostics only count which existing branch was taken; **no watcher/mapping validation bypass**.
- `locate` retains 16KiB page cache, bounded range rejection, mapping epoch handling, `IsFullyMapped` on every miss and all 64-byte-line prefetch instructions. Counters track hits/misses/failure and consecutive repeated **issued prefetch line addresses within each dependency level** (not all duplicate lines within a level). Duplicate tracking resets before each dependency level, for packed and fallback.
- The count-only weighted insertion helper `TableG2FAddCount` sits locally in `table-xpr.inc`. It follows the existing `LiveCensus::Add` key/hash/probe algorithm, but increments `entry.calls` by actual sampled event counts; `cycles=0`, so the exporter does not invent time. No changes to heavily shared `live-census.h` or `live-counters.h`. Updates occur only once per *sampled evaluation exit*, never per guest word/line/page hash update. The original 32,768-slot census table is reused; no new IPC or arbitrary native commands.

### Native metric keys (kind=12, b = 1-based metric id OR queue tag)

**Reader:** `a=0x7ab27`

| id | Metric | Unit |
|---:|---|---|
| 1 | read_calls | calls |
| 2 | read_words | 32-bit words |
| 3 | reuse_last_4k_page | calls |
| 4 | new_4k_page | calls |
| 5 | granule_clear_shortcut | calls |
| 6 | watcher_checks | queries |
| 7 | watcher_present | queries |
| 8 | watcher_absent | queries |
| 9 | direct_small_calls (<=16 words) | calls |
| 10 | direct_small_words | words |
| 11 | direct_large_calls (>16 words) | calls |
| 12 | direct_large_words | words |
| 13 | watched_single_page_fallback | calls |
| 14 | crossing_4k_page_fallback | calls |
| 15 | watched_aware_span_attempts | calls |
| 16 | watched_aware_span_success | calls |
| 17 | watched_aware_span_failure | calls |
| 18 | word_fallback_words | words |

**Locate:** `a=0x7ab28`

| id | Metric | Unit |
|---:|---|---|
| 1 | sampled_evaluations | evaluations |
| 2 | complete_evaluations | evaluations |
| 3 | dependency_level_batches | levels |
| 4 | locate_calls | runs |
| 5 | bounded_range_rejections | errors |
| 6 | mapping_page_probes | 16KiB probes |
| 7 | mapping_cache_hits | probes |
| 8 | mapping_cache_misses | probes |
| 9 | mapping_failures | errors |
| 10 | prefetch_lines_issued | 64-byte lines |
| 11 | adjacent_prefetch_duplicates | lines |

`calls_per_frame` contains **sampled event counts per native flip**, not estimated all-workload events/frame; **do not compare raw values with full-population G2-E counts**. To estimate ratios, use common sampled denominator (e.g. direct-small / read-calls; map-hit / map-probes; duplicate / issued-lines). One out of 32 systematic sampling reduces diagnostic overhead but introduces selection bias if the same periodic workload lines up with selection. Rare paths can be missed. Keep graphics (b high bits 0), async (b high bit 63) and outside-queue (b bit 62) separate.

Basic consistency checks over sampled evaluations:
- Reader calls = page reuse + new page + cross-page.
- New page = granule shortcut + exact watcher checks.
- Exact watcher checks = watcher present + absent.
- Reader calls = direct small + direct large + watched fallback + cross-page.
- Span attempts = successes + failures.
- Map probes = hits + misses.
- Prefetch adjacent duplicate count <= issued-line count.

**Important:** No `ms_per_frame` for these records: 0 is intentional, **not evidence a branch takes 0 CPU time**. They are used alongside older G2-E phase timers; the latter still have their original instrumented overhead.

### Launcher

- `launcher-electron/scene-benchmark.cjs`: G2-F keys added to existing `focusEntries`, raw census JSON unchanged, stores exact 64-bit keys.
- `launcher-electron/benchmark.js`: dedicated G2-F section displays sample volume, direct small/large vs watched/cross-page ratio, mapping hit rate and adjacent prefetch duplication rate **separately for graphics and async**; labels these as count-only. Existing G2-C/D/E cards remain.
- No new setting needed. Opt-in still **Options → Graphics → Scene Benchmark = On**, then manually **Profile CPU (5s)** during gameplay, with 5s lead to return focus. G2-D Table Read-only Pass should be **Off** and Shader Translation Standard **0x0**, to avoid irrelevant experiments.

## Verification

- New standalone C++20 policy test `tools/local/g2f-evaluate-diagnostics-policy-test.cpp` with assertions enabled (`-O0`): PASS. Checks adjacent-line duplicate policy resets at dependency level and reader branch-counter invariants.
- New 5 Node tests `launcher-electron/tests/g2f-evaluate-diagnostics.test.cjs`: PASS.
- Updated two legacy G2-E source-structure tests to accept counter-preserving function bodies/signature.
- Full `cd launcher-electron && npm test`: **116 / 116 PASS**.
- Native renderDraw.cpp.obj build **PASS, exit 0**, warnings in pre-existing imageView.h and TableBlocks alias.
- Native Release emulator `cmake --build _Build/latest/native-build --target kyty_emulator --parallel 1`: **PASS, exit 0**, controlled ThinLTO backend `KYTY_LLD_THINLTO_JOBS:STRING=2`; last executable timestamp 2026-10-26 15:05 local. No gameplay.
- Native `--shader-feature-trial-capabilities`: **PASS, exit 0**; isolated Experimental `0x3` cache inspected **READY**, 6,729,442,428 bytes (no rebuild).
- `launcher-electron/scripts/package-latest.ps1`: PASS.
- Packaged Electron `--smoke-ui`: **ELECTRON_UI_SMOKE_PASS**, exit 0. This validates UI wiring without native game play. **No live G2-F data has yet been checked for count-field correctness**.

## G2-F acceptance / next G2-G gate

Manually on Windows:

```powershell
cd "C:\Users\hoang\Desktop\dev\KytyPS5"
.\launcher.cmd
```

1. Options → Graphics: **Shader Translation = Standard 0x0**, **Table Read-only Pass = Off**, **Scene Benchmark = On**.
2. Manually press Play, stand in the same Boletaria 1-1 camera/scene, let warmup settle, press **Profile CPU (5s)** once. No need for an FPS test, extra boot, or new shader precompile.
3. Inspect `_Build/scene-benchmark/session-*/census-<id>.json` and the paired native log. G2-F `0x7ab27/0x7ab28` counters must be present with nonzero `sampled_evaluations`; verify the branch-count invariants above and exact queue tags.
4. Choose a **single** G2-G default-off optimization only if samples show avoidable work (e.g. many immediately repeated 64-byte-line prefetches and enough mapped page hit rates to justify a safe CPU change). If watched/cross-page paths dominate, investigate safe path behavior first; do not bypass tracked read semantics.
5. When moving to a performance A/B, measure native FPS with Census off, compare matching `table_draws`, scene/camera, renderer settings and warmup; pair images to verify correctness. A sampled `G2-F` statistic is not by itself an FPS improvement.

**Decision:** G2-F diagnostic tooling has passed build/tests, pending real census admission. **NO-GO** for changing runtime reading semantics or promoting a new optimization by default. Real G2-G work depends on data, not speculation.
