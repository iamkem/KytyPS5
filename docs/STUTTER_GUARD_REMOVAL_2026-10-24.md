# Stutter Guard removal — 2026-10-24

## Decision

User requested safe removal of the experimental Stutter Guard after unsatisfactory gameplay. Remove the Stutter Guard **adaptive driver-pipeline policy only**; **do not** delete or disable RAM Safety, RAM16 sparse guest backing, Fresh Memory, RAM Diet, shader prefetch limits, texture GC, shaders, saves, or caches.

Integration branch: `integration/chenxiao-v20261023b-20261023`, starting commit `a6d20d08`, isolated DevSpace worktree `C:\Users\hoang\.devspace\worktrees\KytyPS5-93e7e50d`. Main checkout is dirty with unrelated user data/changes; none were edited. This task builds into only `C:\Users\hoang\Desktop\dev\KytyPS5\_Build\latest`.

## Removed

- From `src/local/memory-pressure.h`: `PipelinePolicy` and adaptive `Pipelines()` (normal/elevated/critical/emergency).
- From `PipelineCache::EvictIdlePipelines`: adaptive RAM-triggered driver-pipeline eviction, physical-RAM pipeline sampling, normal/elevated/critical/emergency override thresholds, alternative eviction batch size, and 600-second remake cooldown.
- From `PipelineCache::Pipeline` and `BindPipelineHandle`: timestamp tracking `last_remade_at`.
- From `PipelineEvictSettings`: adaptive RAM alone no longer forces driver-pipeline eviction when RAM Diet is disabled.
- Obsolete policy-unit-test assertions for removed adaptive pipeline thresholds; replaced with explicit launcher/native-source decoupling regression tests.
- UI text claiming RAM Safety includes Stutter Guard. The setting still controls independent adaptive RAM/prefetch policies.

## Kept intentionally

- `KYTY_ADAPTIVE_RAM=1` and shader-prefetch 4096-MiB guard / one worker when RAM Safety is ON. Current saved config remains OFF; it was not changed.
- Sparse file-backed guest mapping, writeback hint adjustment, page preservation; untouched Fresh Memory and adaptive texture retirement.
- RAM Diet/VRAM-based pipeline evictions: default ~180-second idle horizon / up to 256 releases per 60-flip scan, unless overridden by supported environment settings. `KYTY_PIPELINE_EVICT=0` still disables policy-based eviction. Remake recipe, GPU-safe idle checks, optimized-build exclusions, cache logging, replaced-unoptimized cleanup all remain.
- **Safety exception:** existing suppression of fast *scene-only* pipeline sweeps while RAM Safety is ON remains. Removing it would restore a known mass-eviction path and may cause renewed stutter. Therefore only the adaptive tiering/remake protection feature was removed, not every historic behavior difference between Safety ON/OFF.
- Previous locally modified quota early-stop optimization in both graphics/compute pipeline scans, already present before this request.
- Texture Offload and its probe explicitly OFF, no mapped-page discard; chenxiao guard and GPU/guest mapping code unchanged.
- Saved launcher-settings.json, game files, save, cache, precompile shards, seeds, hints, backups and fingerprints untouched.

## Checks performed

- Native Windows CMake incremental build of `kyty_emulator.exe`: **PASS** into existing `_Build/latest/native-build` (warnings in other existing source, no build failure).
- `node --test launcher-electron/tests/*.test.cjs`: **57 total, 51 PASS, 0 FAIL, 6 SKIP** (the six require an installed emulator/game under the integration worktree; game NOT launched).
- New test `ram-safety-decoupling.test.cjs`: fixture-only ON/OFF and RAM Diet independence, preserved backing/texture flags, removed native policy hooks and retained scene-sweep anti-regression gate: **2/2 PASS**.
- `git diff --check`: **PASS**.
- Repackaged **the existing** `_Build/latest/launcher/DemonsSoulsLauncher-win32-x64/` with Electron Packager, **PASS**. ASAR byte content verified to contain current RAM Safety label and updated text.
- Neither game nor shader precompile / heavy GPU stress was run; actual FPS/1% low, stable memory usage and BSOD prevention are **NOT VALIDATED**.
- A launcher `--smoke-ui` invocation was attempted; a fresh menu screenshot appeared but no fresh options screenshot was confirmed. Therefore **full GUI smoke PASS is not claimed**.

## Caveats and next acceptance gate

The previously active Stage 4 policy retained old pipelines longer in normal RAM conditions (300 seconds/32 releases per scan) and imposed remake grace of 600 seconds. Removing it returns pipeline idle management to the independent RAM Diet/VRAM policy (180 seconds/256 per scan by default), which can **increase** rebuild stutter in some scenes. It also removes the special sub-1-GiB emergency pipeline sweep; other RAM safeguards remain. No improvement in FPS, RAM or crash safety is claimed until a safe user-initiated A/B test. Do not reactivate failed Stage7 or texture destructive offload to compensate. Avoid gameplay when system free physical RAM is near/below 1 GiB or Windows is unstable.

User's saved `ram_safety=false`, `ram_diet=true`, `ram16_backing=true` remains unchanged. With that saved setting, the removal has little to no intentional effect on pipeline eligibility versus the previous RAM Safety OFF path (aside from the prior quota early-stop optimization). To test the remaining adaptive prefetch policy, the user can optionally toggle RAM Safety ON manually in a *supervised short* session; no automated game run is allowed.
