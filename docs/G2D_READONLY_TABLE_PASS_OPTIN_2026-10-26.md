# G2-D — Table Read-only Pass Skip (opt-in), 2026-10-26

## Scope / decision

**Experimental CPU-only prototype BUILT and validated at code/policy/Electron command/UI levels. Default = OFF.** This is not a proven performance win; **NO-GO to enable by default** until user-performed matched-scene FPS, visual, and census A/B testing establishes benefit. It does not alter shader translation, pipeline formats, Vulkan submission barriers or saved guest memory.

Previous evidence: `docs/G2C_CENSUS_RESULTS_G2D_ADMISSION_2026-10-26.md`. G2-C RTX 5070 recorded TableBlocks ~2.08–2.15 ms/native flip on graphics queue, but no metric measuring the empty write scan that is skipped here. Improvement could be tiny or negative.

## Exact change

In `src/local/table-xpr.inc::TableBlocks`, the original two passes remain *exactly* ordered per shader stage: writable/atomic buffers first, read-only buffers second. For a stage whose **complete table-buffer plan** contains no `resource.written || resource.atomic`, the first pass would merely reject all entries before validation or resource side effects. The optional switch starts the loop at `N=plan.buffers.size()`, performing the entire read pass unchanged. Other stages, including any mixed or atomic-only buffer stage, start at 0 as before.

- `src/local/table-readonly-pass.h` provides `Eligible(planCount, info.buffers)` and `Begin(enabled,eligible,count)`, compiled by the actual emulator and standalone C++ policy tests.
- `TablePair::readonly_buffer_stage[2]` is cached only when `TableRuns` installs stage programs. Eligibility is conservative: table-mode shader, metadata cardinalities match, ≤32 buffers, no writable or atomic buffer. Missing, mismatched, unsupported, or not-yet-installed stage is not eligible.
- `TableReset` reinstates default-ineligible metadata; `TableRuns` recomputes both stages on program replacement/respecialization. No shader-pipeline cache stamp or serialization format change.
- All `specialized` checks, written buffer handling, `writes` output, dirty/generation/registration/owner proofs, CPU/GPU epochs, image-start guards, ring-copy reuse, fallback `ObtainBuffer`, and draw emission/barriers remain unchanged.

**Switch:** `KYTY_TABLE_READONLY_PASS_SKIP` registered in `src/local/performance-switches.h`, defined at `src/local/native-xpr.inc` with default 0. Only 0/1 permitted. Launcher settings `table_readonly_trial` defaults false; Electron forces `KYTY_TABLE_READONLY_PASS_SKIP=0` in normal Play even if an inherited/JSON value had 1, or sends 1 after explicit opt-in.

**Census diagnostic**: Existing `LiveCensus::Add(kind=12,a=0x7ab24,b=(bufferCount << 8)|enabled|queueFlag,cycles=0)` adds one aggregate count per **nonempty eligible stage per TableBlocks call**, and only when native CPU census is active. Values are `calls_per_frame` by mode/queue and buffer count, not expensive per-descriptor traces. The separate G2-D summary calculates **eligible calls/flip, eligible first-pass iterations/flip, actually skipped iterations/flip** from these entries; `0.0000 ms` is count-only, not cost. No changes to common `live-counters.h` schema. Non-census FPS benchmark stays unobstructed by diagnostics.

## How to test

Launcher `C:\Users\hoang\Desktop\dev\KytyPS5\launcher.cmd`.

Choose **Options → Graphics → Shader Translation Mode: Standard (0x0)** and leave it unchanged across the first comparison. Then choose **Table Read-only Pass (Experimental)**:

- **Off (baseline)**: `KYTY_TABLE_READONLY_PASS_SKIP=0` — previous TableBlocks traversal.
- **On (G2-D CPU test)**: `KYTY_TABLE_READONLY_PASS_SKIP=1` — only the empty write traversal may be skipped.

Keep **Scene Benchmark (15s) = On**. At the same character position and camera in `m04_00_00_00`, allow shader startup and first-use work to settle. Run **Measure FPS (15s) → Profile CPU (5s) → Measure FPS (15s)**. Exit the game normally; restart with the other G2-D toggle, unchanged graphics. Prefer the order **Off → On → On → Off**, each as a **distinct game boot**, with screenshots at the same camera to verify geometry/lighting/fog/particles and compare `table_draws`, indirect tables, render passes, and ring traffic.

Native `LIVE_CENSUS_ENTRY` G2-D keys use `a=000000000007ab24`, with `b` encoding counts and whether the pass was skipped. Both current Launcher and raw session `census-*.json` support them; `census-results.jsonl` also contains `focusEntries`. `results.jsonl` holds native FPS, 1% low, P99 and render/record CPU time without census in the measurement window.

**Rollback:** Options → Graphics → Table Read-only Pass (Experimental) → **Off** → OK → Play. Doesn't rebuild cache and doesn't rewrite saves. If visual corruption/crashes occur, stop the experiment and revert. Do not change shader mode during this A/B: shader `0x3` effects were not causally isolated in earlier comparisons.

## Validation (current turn)

- Standalone C++ test: `tools/local/table-readonly-pass-policy-test.cpp` built with LLVM clang++ 19 and executed, exit 0. Verifies empty/read-only/atomic/written/mixed stages (positions 0..N), mismatched counts, 32-buffer cap, and byte-identical visitation order with switch off/on.
- Electron `cd launcher-electron && npm test`: **106/106 PASS** (G2-C and G2-D tests included).
- Native `renderDraw.cpp.obj` compiled PASS, existing warnings only.
- Full native `_Build/latest/native-build/kyty_emulator.exe` Release link **PASS, exit 0**, resource-bounded: Ninja `--parallel 1`, ThinLTO backend `KYTY_LLD_THINLTO_JOBS=2`. A broad first build was interrupted by tool timeout because a shared header had triggered extensive recompilation; diagnostic counters were moved into already-existing LiveCensus so shared `live-control.h` and `live-counters.h` remain unchanged. Final incremental bounded link succeeded. Binary timestamp 2026-10-26 13:35 local.
- Binary handshake `--shader-feature-trial-capabilities` PASS, exit 0; trial 0x3 cache admission remains READY with 6,729,442,428 bytes and same sidecar.
- Actual `run-windows.ps1 -DryRun` **PASS** for four combinations: Standard/Experimental translator and Off/On CPU switch; -Set explicitly overrides inherited flag. No gameplay started.
- Windows Electron package `launcher-electron/scripts/package-latest.ps1` **PASS**.
- Packaged Electron `DemonsSoulsLauncher.exe --smoke-ui` **ELECTRON_G2D_READONLY_PASS_UI_PASS** and **ELECTRON_UI_SMOKE_PASS**, exit code 0; screenshot main capture reports optional UnknownVizError but no UI smoke failure.
- Installed game/save/cache not opened by emulator during tests; no shader precompile, no gameplay A/B performed.

## Next gates

1. **User runtime A/B and image-correctness**, G2-D Off vs On within same shader mode. Quantify `eligible iterations / flip` and `skipped iterations / flip` from CPU census; require nonzero skips for admission.
2. If skips are frequent, compare FPS/1% low and CPU render time with matched `table_draws` and frames, preferably alternating Off/On/On/Off. No promotion for a marginal difference inside normal scene variability.
3. If improvement is weak or eligibility negligible, retire the default-off switch and redirect G2-D to high-cost `TableEvaluate` subphase diagnosis (mapping, dependent reads, descriptor assembly, indirect enumeration). No shader cache rebuild or Vulkan barrier changes.

**This is an experimental, reversible research switch; it is not automatically an FPS optimization.**
