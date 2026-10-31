# KytyPS5 — experiment retirement review (2026-10-31)

**Purpose:** keep the working tree focused on proven performance and correctness work. History retains original measurements and removed one-off phase reports. The initial PR #2 archived documents. The follow-up on 2026-10-31 removes retired native code, Launcher options and diagnostics; no measured FPS improvement is claimed.

## Grounded decisions

| Trial | Actual result | Decision |
|---|---|---|
| G2-D Readonly Table Pass Skip | On ~44.90 vs Off 45.00 FPS in intentionally limited two-boot comparison; functional skip worked, no measurable native FPS benefit. | **RETIRE trial**, preserve standard read/write ordering. |
| G2-G Prefetch Dedupe | On ~49.90 vs Off 50.30 FPS, workloads varied; ~19% graphics advisory prefetch candidates suppressed but no positive FPS result. | **RETIRE trial**, don't restore as default. |
| G2-H Packed Unbounded Levels | 100% eligible branch coverage and correct ON-only runtime, **no matched FPS uplift/pixel equivalence evidence**. Historical ON native 49.47/49.80 FPS remains our benchmark reference. | **UNPROVEN**; do not promote; retain measured G2H result report until a replacement canonical benchmark is established. |
| G3-B3 speculative macro offload/readback shortcuts | Source and trace audit NO-GO; no admitted performance implementation. | Keep correctness conclusions; no optimization code to retire. |
| G3 PGO diagnostics | 18 differing function hashes identified (12 compiler warnings + six profile unknown-function records), including TableEvaluate, TableBlocks and draw dispatch. | **KEEP**: actionable profile repair check; no FPS uplift yet. |

## Documentation archived from the tracked tree in this preliminary cleanup

- `docs/G2D_AB_READONLY_PASS_RESULTS_2026-10-26.md`
- `docs/G2D_READONLY_TABLE_PASS_OPTIN_2026-10-26.md`
- `docs/G2F_RESULTS_G2G_PREFETCH_DEDUPE_2026-10-27.md`
- `docs/G2G_PREFETCH_DEDUPE_AB_RESULTS_2026-10-27.md`
- `docs/G2H_PACKED_UNBOUNDED_LEVELS_OPTIN_2026-10-27.md`
- `docs/G2H_ON_ONLY_RUNTIME_CHECK_2026-10-27.md`

Original measurements are recoverable from Git history. Keep `docs/G2H_ON_ONLY_CENSUS_RESULTS_2026-10-27.md` as the only documented historical 49.635-native-FPS reference, `docs/G3*` for dependency/correctness findings and `docs/NATIVE_60FPS_TARGET_G3_2026-10-27.md` for the finite acceptance target.

## Runtime trial cleanup — implemented 2026-10-31

- Removed G2-D/G2-G/G2-H native experimental branches and switches in `src/local/table-xpr.inc`, `native-xpr.inc`, and `performance-switches.h`; restored the original flags-Off paths, including writable-first two-pass ownership and bounded guest read checks. The active Table/XPR renderer, BDA/PM4/Vulkan synchronization, buffer ownership proofs and existing generic LiveCensus remain.
- Removed G2-F/G2-I one-off sampled instrumentation and 15 trial-only native headers, policy-test sources and Launcher tests. Generic CPU Census and optional GPU Timeline remain.
- Removed the three UI selectors and configuration/environment assignments from Electron Launcher, along with G2-specific benchmark presentation. Existing `launcher-settings.json` is not modified during migration: `clean()` ignores obsolete JSON keys.
- Added `launcher-electron/tests/retired-trials-cleanup.test.cjs` to check legacy setting rejection and the retained guest-memory and buffer-safety invariants. **116/116 Electron/Node tests PASS**. Canonical native build `cmake --build _Build/latest/native-build --target kyty_emulator --parallel 1` **PASS**, existing unrelated compiler warnings only.
- No emulator gameplay was launched for pixel/FPS certification. The historical ~49.64 FPS was with G2-H On and may not represent the retired-path frame time. Do not claim matched baseline or automatic uplift.

**Do not remove** the separate XPR Table renderer, shader cache, readback queue, RAM/PGO protections or Scene Benchmark utility. No game/shader cache, save, mod, or personal file was removed.

## Upstream sync gate

Source: `chenxiao07/KytyPS5` `experiment/perf-40fps-20260926` HEAD `7de6fd9e` (2026-10-31). Compared to our `integration/chenxiao-v20261023b-20261023` HEAD `4bb4bba3`, upstream is **220 ahead**, local **89 ahead**, with significant renderer, memory, native launcher and settings differences. Draft upstream review PR #1 is **not mergeable** at first GitHub check. The source sync requires explicit conflict resolution and native Windows build/test; never resolve by overwriting our entire source tree.

## Private/local files excluded from cleanup

Never indiscriminately delete ignored `_Build/`, `_SaveData/`, `_SaveData.rar`, `_Mods/`, `_PipelineCache/`, shader cache, `launcher-settings.json`, `game-path.txt`, proprietary game files, user's nontracked documents or backups. The single **audited exception** on 2026-10-31 was obsolete `_Build/g3b-staging/`: 73 files / 357.42 MiB moved to Recycle Bin by `tools/local/windows/cleanup-obsolete-artifacts.ps1 -Execute` after canonical output and process checks. It was not a game launch target; all other build/user folders remained protected.

**Status:** tracked runtime trial removal is complete and built/tested offline; one confirmed obsolete staging directory has also been recycled. No runtime/gameplay FPS result yet. Other generated `_Build/` archives and backups remain protected; upstream full merge remains gated by conflict resolution and native validation.
