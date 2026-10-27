# G2-H Experimental ON-only runtime check — 2026-10-27

**Historical note, superseded for FPS/Census:** A later user-performed run successfully recorded live G2-H CPU Census and two 15s FPS windows. See `docs/G2H_ON_ONLY_CENSUS_RESULTS_2026-10-27.md` for the verified results. This file documents only the earlier 09:46 handshake-only run.

## Verdict

**GAME START + SCENE LOAD + WARMUP OBSERVED (G2-H ON). FPS/CENSUS ACCEPTANCE: NOT RECORDED.**

The user intentionally tested only **G2-H On** and explicitly does **not** want to run a fresh G2-H Off baseline. Respect that constraint. No assistant gameplay, shader precompile, save/cache edits, or build occurred in this analysis.

## Actual new evidence

- Latest user-produced game run: `_Build/run-logs/20261027-094623-374.out.log`, modified 2026-10-27 09:47:49 local; paired `*.err.log` is 0 bytes.
- New benchmark session folder `_Build/scene-benchmark/session-y2yDfe`, created ~09:46. It contains **only `commands.txt`** (17 bytes), with `id 1793069186348` (no `measure` or `census` instruction), and **no `results.jsonl`, `census-results.jsonl` or `census-*.json`**.
- Native log explicitly: `Performance switches: KYTY_TABLE_READONLY_PASS_SKIP=0 KYTY_TABLE_PREFETCH_DEDUPE=0 KYTY_TABLE_UNBOUNDED_LEVELS=1`. Shader Translation Experimental 0x3 **off**, present cap 60Hz, GPU NVIDIA RTX 5070. Scene `m04_00_00_00` was entered.
- No-op handshake has `LIVE_DONE id=1793069186348` (native command receiver responded). **No `LIVE_MEASURE`, `LIVE_CENSUS` or corresponding measurement `LIVE_DONE`**.
- Shader warmup finished `10290/10316` permutations in ~55.7s; pipeline warmup compiled `1570/10407` recipes and marked warmup done beside game. Runtime printed video-memory samples beyond native flip 2940; there were 2 compile-heavy slow frames during warmup/early scene transitions, not scored FPS samples.
- A startup `shader binding layout failed` warning for a couple programs also occurred in previous runs; do not assign it to G2-H without comparison. No runtime stderr output. This log does not prove pixel correctness or generalized long-session stability.
- No benchmark statistics, number of eligible/specialized packed levels, On FPS, 1% Low, render CPU, or NO-GO/GO FPS verdict can be computed from available artifacts.

## Why no benchmark file

The Launcher `scene-benchmark.cjs` publishes an `id` alone during the readiness `probe()`, which expects only `LIVE_DONE id=...`. Actual `capture()` publishes `sleep 5\nmeasure 15 <label>` and after success appends `results.jsonl`. Actual `census()` publishes `sleep 5\ncensus 5` and after success creates a census JSON. The session file contains only the handshake command. This most directly indicates neither measurement action was sent. This is **not** proof of a bug in native census instrumentation or that the user intentionally skipped a step; the exact UI sequence is not observable.

## Minimal On-only validation, if the user chooses

No Off baseline required or requested. After launching `C:\Users\hoang\Desktop\dev\KytyPS5\launcher.cmd` with Shader Standard 0x0; G2-D Off, G2-G Off, G2-H On, Scene Benchmark On:

1. Enter map and let warmup settle.
2. In the separate **Scene Benchmark** window, wait for status `Ready`; click **Profile CPU (5s)**. Return focus to gameplay during countdown. Wait for completion. This single sample verifies G2-H levels eligible vs specialized counts via `kind=12,a=0x7ab29` in `census-*.json`.
3. For an absolute On FPS figure (not causal FPS gain), also click **Measure FPS (15s)** once. Expect `results.jsonl`. No second boot or Off run needed.
4. If the user declines further runtime actions, status remains **runtime observed, FPS/census unverified**, and prioritize static compiler/metadata audit instead of inventing a benchmark.

Current practical recommendation is to keep G2-H **default Off for normal play**, not from a demonstrated regression but due to missing performance/visual acceptance. Old G2-D/G trials stayed Off because their prior A/B produced no gain; this G2-H session did **not** measure them.

## Engineering controls

Commit `b3a04201` contains the G2-H native change, Launcher integration, and tests; no new source changes in this result audit. The recorded scope stops at on-only startup + scene load. Preserve pre-existing untracked files and do not touch game/shader cache/save.
