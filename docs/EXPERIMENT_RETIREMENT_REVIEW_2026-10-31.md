# KytyPS5 — experiment retirement review (2026-10-31)

**Purpose:** keep the working tree focused on proven performance and correctness work. History retains original measurements and removed one-off phase reports. This first PR is **documentation-only cleanup**, not a claim that runtime trial code has been deleted or performance has improved.

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

## Runtime trial cleanup — still required, not performed in this docs-only PR

When DevSpace Windows becomes available, remove G2-D/G2-G/G2-H native trial flags and opt-in code **together** across:

- `src/local/table-xpr.inc`, `src/local/native-xpr.inc` and `src/local/performance-switches.h`
- trial-only helper headers `src/local/table-readonly-pass.h`, `src/local/table-prefetch-dedupe.h`, `src/local/table-unbounded-levels.h`; native policy tests and CMake test registrations
- `launcher-electron/logic.cjs`, `options.js`, `options.html`, relevant Launcher tests and settings migration (old JSON flags ignored with no effects)
- any related runner/test/docs references, but **not** main Vulkan/PM4/TBL, shader caches, readback queue or protections.

Preserve default player experience, host/GPU synchronization, guest memory observation order, compilation correctness and prior performance baseline. **Do not remove** the separate XPR Table renderer, shader cache, upstream fixes or the Scene Benchmark utility.

## Upstream sync gate

Source: `chenxiao07/KytyPS5` `experiment/perf-40fps-20260926` HEAD `7de6fd9e` (2026-10-31). Compared to our `integration/chenxiao-v20261023b-20261023` HEAD `4bb4bba3`, upstream is **220 ahead**, local **89 ahead**, with significant renderer, memory, native launcher and settings differences. Draft upstream review PR #1 is **not mergeable** at first GitHub check. The source sync requires explicit conflict resolution and native Windows build/test; never resolve by overwriting our entire source tree.

## Private/local files excluded from cleanup

Never automatically delete ignored `_Build/`, `_SaveData/`, `_SaveData.rar`, `_Mods/`, `_PipelineCache/`, shader cache, `launcher-settings.json`, `game-path.txt`, proprietary game files, user's nontracked documents or backups. Deleting even an old experimental build folder may destroy logs or a launch path; check ownership/runtime state first.

**Status:** this PR removes only the six archived docs files above; no native code, Launcher, build/test/run or cached/user data changed.
