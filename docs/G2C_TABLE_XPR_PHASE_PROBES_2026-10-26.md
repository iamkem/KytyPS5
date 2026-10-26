# G2-C — Table XPR CPU phase probes (2026-10-26)

**Status:** source instrumentation + 102/102 tests + native object compile + **bounded ThinLTO emulator link PASS** + Electron package/smoke verified. **Actual in-game G2-C census NOT YET PERFORMED.** No game/save/cache/shader precompile was run.

Previous evidence: `docs/G2B_CPU_CENSUS_RESULTS_G2C_ADMISSION_2026-10-26.md`. In Boletaria 1-1 RTX 5070, existing `kind=12 / a=0x7ab1e` draw phase 1 (Evaluate+Gather) ~2.64 ms/flip, phase 4 (emission) ~2.03, phase 3 (BDA+Blocks) ~1.85. Inclusive and nested timings, not additive. Trial vs Standard have different table_draw workloads; no causal shader uplift proven.

## Implemented opt-in timers

All use **existing `LiveCensus::Scope(LiveCensus::DrawPhase, a, b)`**, active only with the already-existing manual Scene Benchmark → **Profile CPU (5s)**. Old synthetic key `0x7ab1e` draw / `0x7ab1f` dispatch and existing phase IDs retained exactly; no guest state, resource lookup, queue scheduling, buffer-ownership, shader execution or pipeline cache algorithm changed.

| Key `a` | Phase `b` low bits | Meaning | Boundary / caution |
|---|---:|---|---|
| `0x7ab20` | 1 | TableEvaluate | All calls, graphics and compute, incl. failed evaluation and mapping checks |
| `0x7ab20` | 2 | TableGather | All calls, graphics and compute, incl. buffer words gather/prefetch |
| `0x7ab21` | 1 | TablePrepareBda | Only when global memory is used, from after no-global fast exit |
| `0x7ab21` | 2 | TableBlocks | Inclusive complete function, incl. buffer resolution, ring candidate and final upload |
| `0x7ab21` | 3 | Dispatch indirect args | Only when indirect_args != 0, buffer Ensure/owner/offset |
| `0x7ab22` | 1 | CPU-dirty ring candidate | Inclusive of shared ring reuse / map & copy attempt / fallback decision (not 'memcpy time') |
| `0x7ab22` | 2 | Conventional ObtainBuffer | Includes EnsureBufferContents (when CPU-written), ObtainBuffer, validation and assignment; may include fallout from failed ring path |
| `0x7ab23` | 1 | TableTry attempt | After TableSweepPairs, nested with old TableTry phase 0 |
| `0x7ab23` | 2 | TableContinue attempt | At function entry (including early rejection), may execute TableDraw, and count != successful continuations |

**Queue flags:** the native `b` is OR'd with `QueueAsync = 1ull << 63` or `QueueNone = 1ull << 62`. Preserve the entire `kind/a/b` key in JSON and distinguish graphics/async. These new probes are **inclusive nested scopes**, not exclusive CPU times. A TableGather call from TableBlocks, and TableBlocks' nested ring path, are counted by their outer scopes as well. No sums across overlapping scopes. Lower-order differences close to timestamping overhead are not reliable speedups.

`launcher-electron/scene-benchmark.cjs` now stores all `0x7ab20..0x7ab23` entries in `focusEntries` within `census-results.jsonl` and the full `census-<id>.json`. `benchmark.js` labels each timer and shows a separate G2-C focus list; old results without these probes remain supported and simply have no focus entries.

## Validation completed

- Node native-source structural guards cover unique keys, unchanged ordering/evaluation and ownership checks (5 new tests), plus JSON G2-C focus parser test fixture.
- `cd launcher-electron && npm test`: **102/102 PASS** (97 original + 5 new).
- Focused C++ compilation **PASS**:
  ```powershell
  & 'C:\Program Files\CMake\bin\cmake.exe' --build '_Build/latest/native-build' --target 'CMakeFiles/kyty_emulator.dir/src/graphics/host_gpu/renderer/renderDraw.cpp.obj' --parallel 1
  ```
  Compiler reported 2 warnings (imageView.h noreturn; pre-existing TableBlocks Kind alias unused), **zero new errors**.
- Latest Electron package `launcher-electron/scripts/package-latest.ps1` PASS; packaged `--smoke-ui` **ELECTRON_UI_SMOKE_PASS, exit 0** with G2-B/Binary Feature Trial still ready. UI smoke is synthetic; cannot demonstrate new native probes.
- **Full bounded Release emulator build** `cmake --build _Build/latest/native-build --target kyty_emulator --parallel 1`: **PASS, exit 0**, after reconfigure with `-DKYTY_LLD_THINLTO_JOBS=2`. This caps ThinLTO backend workers independently of Ninja job count; default remains `all` for other configurations. `_Build/latest/native-build/kyty_emulator.exe` has a new 2026-10-26 build timestamp. `--shader-feature-trial-capabilities` reports the expected exact signature, exit 0; Electron trial cache inspection returns `ready=true`, 6,729,442,428 bytes. Native game-load/integrity and in-game census remain untested.

## Gate for live G2-C measurements

Release target previously used `/opt:lldltojobs=all`, which Ninja `--parallel 1` does not bound; risky on the machine's RAM/BSOD history. This change introduces an **opt-in** `KYTY_LLD_THINLTO_JOBS` CMake cache option, default `all`, validating 1..99. Current Windows `_Build/latest/native-build` cache is set to **2**, and the full link completed successfully without running any game.

Next step: player manually runs the freshly linked native via the **existing Launcher**, with **Scene Benchmark On → Profile CPU (5s)**, same Boletaria camera for Standard and Trial, and checks for keys `0x7ab20..0x7ab23` in `census-*.json`. No need to rebuild shader pipeline caches. Only after paired G2-C census in similar workload decide G2-D opt-in code optimization.

**Do not promote Shader Translation 0x3 to default**; measured 1.9–6.7% same-map FPS differences have different logical draw counts and background prefetch histories.
