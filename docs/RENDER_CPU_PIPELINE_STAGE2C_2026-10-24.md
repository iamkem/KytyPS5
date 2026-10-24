# KytyPS5 / Demon's Souls PC — Stage 2C: cautious CPU/pipeline optimization (2026-10-24)

## Why this was selected

The most recent controlled graphics-queue audit, `_Build/run-logs/20261024-092409-163.out.log`, records 40 `DRAW_SUBMISSION_CENSUS` reports. In heavy scenes it shows approximately 6,400 encountered guest graphics draw packets plus 1,500 compute dispatch packets per guest submission-frame, and accelerated indexed-indirect packet grouping. These are not necessarily Vulkan draw counts or hidden objects. The same log's `SLOW Frame` entries show severe stalls; for example a ~7,790 ms frame with `compile=7354.4` ms, a *broad render-thread compile-wait category*, not proof of 7.35 seconds of Vulkan driver compilation.

`src/loader/gameArgs.cpp` already disables the guest's `doIndexBufferCulling` due a historic performance result in Boletaria; no change to that setting. Existing native XPR, table MRU, driver pipeline caches, static binaries, shader prefetch and background pipeline compilation are already substantial. An unproven aggressive rewrite of any of those subsystems could increase memory pressure and regress render correctness.

An independent, read-only source review identified a narrower opportunity: `CreateGraphicsPipelineImpl()` searches the published graphics pipeline map, then only the `async == true` path adopts a **completed** pending pipeline. When a synchronous request arrives with the exact same graphics pipeline key while the completed async entry is still pending, it used to proceed directly to `CreatePipelineInternal()`, performing potential duplicate work. It is not known how frequently this precise coincidence occurs in Demon's Souls: native binding mode and table-program specialization are part of the full key, so distinct normal/table/native variants cannot be merged.

## Implemented experiment — OFF by default

- `src/graphics/host_gpu/renderer/pipeline/pipelineCache.cpp`: native env `KYTY_READY_PIPELINE_REUSE=1` (exact value) enables **completed-only** reuse at synchronous graphics cache misses. The pending lookup uses the existing complete `GraphicsPipelineKey`, under the existing pipeline-cache mutex. `pending->done.load(memory_order_acquire)` pairs with the worker's `done.store(memory_order_release)`. A **shared** `adopt_completed` helper handles transfer of the already-created `Pipeline` + layout into the normal owned pipeline map and native indexed cache for both async and newly gated sync paths. The `async`-false miss with no pending key or still-running job follows its original path; **no sync waiting, no new job cancellation, no pipeline/state sharing across differing keys**, and no changes to guest graphics commands or shader cache.
- Bounded success evidence: the first 16 completed-only synchronous hits log `PIPELINE_READY_REUSE completed=1 waited=0 native=... vs_id=... ps_id=...`. An absence of this line when ON indicates no observed ready-to-adopt duplicate, not proof of an FPS benefit.
- `launcher-electron/logic.cjs`, `options.html`, `options.js`: explicit `ready_pipeline_reuse=false` default, Advanced-tab control **Ready Pipeline Reuse → Off / On (experimental, completed only)**, `-Set KYTY_READY_PIPELINE_REUSE=0|1` always passed so Off overrides stale inherited environment/runner values. Independent of RAM Safety, RAM Diet, Distance Detail, Occlusion Query Audit, quality presets, scaling and DLSS.
- `launcher-electron/tests/ready-pipeline-reuse.test.cjs`: three fixture/source guards check default OFF, preserved unrelated settings and presets, exact launch-time switch, a completed acquire-gated exact key, shared adopted ownership, busy fallback and bounded success logging.
- `launcher-electron/README.md` documents experimental semantics and limitations.

## Gates and limitations

1. **Correctness scope:** source matching is *full pipeline key*, not shader hash alone. Existing pending job must be fully published, and the helper uses the same async adoption implementation. No extra GPU dispatches or Vulkan render state changes.
2. **No evidence yet that this path triggers in gameplay.** This optimization can only eliminate duplicate synchronous compilation on a previously completed pending key. It does not speed cold shader translation, pipeline-key misses with no worker job, out-of-memory pressure, SRT evaluation, or most frame preparation. The original ~7.8 s stall remains a separate investigation.
3. **Verification:** native Windows C++ build and Node tests exercise integration and static contracts; they do **not** simulate GPU shader/pipeline compilation or provide a matched-frame A/B runtime benchmark. User's prior MEMORY_MANAGEMENT BSOD means no automatically initiated game runs or shader precompiles.
4. **Safe A/B after future user-authorized runtime:** leave OFF for control run, then ON in identical saved scene, wait for stable area, inspect `PIPELINE_READY_REUSE` log lines and compare `SLOW Frame compile=...`, visible output and crash behavior. Do not delete shader cache, saves or precompile seeds; the two sessions should share the same warm cache to reduce unrelated compilation variation.
5. If no hit log appears in the ON run, **turn it back OFF**, keep default, and focus on profiling shader translation/SPIR-V generation/pipeline creation wait to identify actual hot paths. No claim of FPS gains without a controlled performance test.

## Acceptance evidence

- 3 new ready-pipeline-reuse CJS integration tests PASS.
- Full Electron tests 69 total, **63 PASS, 0 FAIL, 6 SKIP** (six existing integration tests require a real game in the isolated worktree).
- Windows C++ native incremental build **PASS**, linked `kyty_emulator.exe` (existing compiler warnings remain).
- `git diff --check` PASS.
- Electron packaging **PASS** into the existing `_Build/latest/launcher/DemonsSoulsLauncher-win32-x64` directory; latest native executable linked into `_Build/latest/native-build`.
- Independent *read-only* Codex source audit of the implementation: **no serious blockers** found. Explicitly verified acquire/release publication, background-job lifetime after ownership transfer, full-key/native-index mapping, busy-job non-wait fallback and default-Off launcher behavior. Review did not run gameplay or build itself.

## Source and safety

Isolated source worktree: `C:\\Users\\hoang\\.devspace\\worktrees\\KytyPS5-93e7e50d`. Main checkout `C:\\Users\\hoang\\Desktop\\dev\\KytyPS5` is deliberately not edited (already dirty). Existing `_Build/latest/native-build/` and `_Build/latest/launcher/` are the only produced executable targets. No git commit/push, shader cache cleanup, GPU runtime or game save edit.
