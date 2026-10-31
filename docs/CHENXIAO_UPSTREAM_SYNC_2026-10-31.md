# Chenxiao upstream review / selective merge — 2026-10-31

## Source identity and baseline

- Our integration checkout: `integration/chenxiao-v20261023b-20261023` (at the review start `c3ab41e3`; cleanup `c82c9506`).
- Actual upstream: `https://github.com/chenxiao07/KytyPS5.git` `experiment/perf-40fps-20260926` at `7de6fd9e7b9ea0399148577df7705d7a7e2870c9` (October 31).
- Common ancestor `39ed7c9a`. At the start, upstream was **220 commits ahead** of merge base, local **90 local-only commits**. Upstream changed 197 paths, including 56 also touched locally. Those counts do not establish correctness of direct merges.

## Full-merge rehearsal: BLOCKED, rolled back cleanly

A `git merge --no-commit --no-ff FETCH_HEAD` trial produced **33 conflicting paths**, including `CMakeLists.txt`, `run-windows.ps1`, `precompile-windows.ps1`, `src/kernel/memory.cpp`, `memoryAddressSpace.inc`, `src/graphics/host_gpu/renderer/cache/bufferCache.cpp`, `textureCache.cpp`, `pipelineCache.cpp`, `texture-offload.h`, `src/loader/demonsSoulsPageFree.cpp`, `src/local/performance-switches.h`, native Windows launcher files and docs. **No whole-file ours/theirs resolution was chosen** and `git merge --abort` restored a clean tracked checkout. Never use a blind `-X theirs` or wholesale file overwrite: it can undo sparse-file/guest memory protections, protected shader inputs, RAM Safety decoupling, Electron Launcher routes and latest-only output.

The full upstream merge is **not complete**; draft [PR #1](https://github.com/iamkem/KytyPS5/pull/1) tracks the remaining reconciliation. Keeping a draft PR is not evidence of accepted changes.

## Accepted isolated upstream bug fixes (cherry-picked and compiled)

1. chenxiao `63d680fd` → local `962f8ae6`: when `KYTY_FRAMEGEN` is enabled, AMD Anti-Lag request is suppressed to avoid double frame pacing. Preserves the non-framegen path. No native FPS gain claimed on the RTX5070 (AMD-specific extension).
2. chenxiao `c91f814d` → local `7d043778`: `KYTY_PRESENT_DIRECT` disabled when `KYTY_FRAMEGEN` is enabled, preventing direct presentation from blocking FSR/DLSS frame generation pacing. Preserves original direct setting without frame generation.

These two commits are isolated, retain chenxiao as the Git author and are *not* an ancestry merge of all 220 upstream commits.

## Verification

- `node --test launcher-electron/tests/*.test.cjs`: **118/118 PASS**, including `upstream-fg-guards.test.cjs` (new static regression assertions) and `retired-trials-cleanup.test.cjs`.
- `cmake --build _Build/latest/native-build --target kyty_emulator --parallel 1`: **PASS**, only known unrelated compiler warnings.
- `launcher-electron/scripts/package-latest.ps1`: **PASS** packaging into `_Build/latest/launcher/DemonsSoulsLauncher-win32-x64`, not staging.
- No shader precompile, game boot, save writes, mods change, user cache deletion, or measured FPS/pixel correctness claim.
- The previous `49.635` native FPS was on an **older G2-H-On build**, not the current cleaned and upstream-selective build.

## Other upstream changes reviewed but NOT merged yet

- `TableGather` memo in `7de6fd9e`: upstream RTX5090 claims about **0.31 ms/frame aggregate render-thread time** reduction, while its 60-FPS-capped benchmark and 1% lows were effectively unchanged. Not verified on Ryzen 5600/RTX5070, so not promoted as a material optimization.
- Texture allocation retry and GPU-written eviction in `def190dc`: potentially useful in VRAM exhaustion but coupled to memory owner/download/eviction and local RAM Safety. Requires a separate correctness group review.
- Upstream native Windows Launcher/Steam Big Picture helper: local Electron launcher is canonical; do not restore removed native launcher as default.
- Controller/haptics, Linux/Steam Deck, shader caches, pipeline retention: require dependency-sensitive integration and local tests. Many upstream fixes overlap local ports; duplicate application is unsafe.

## Generated output / deletion decision

Only tracked ineffective experiment source, switches, policy files and Launcher tests were removed in `c82c9506`. Existing ignored user/build assets under `_Build/` are preserved. Obsolete `_Build/g3b-staging` (~0.35 GiB) is not in any active launcher path but has previous instructions to avoid deleting without ownership/process review; don't delete by `git clean` or unbounded recursive shell cleanup. Game folders, `_SaveData`, shader cache, hints, private untracked scripts and mod data are absolutely protected.

## Next real-world acceptance

Only after the user chooses a game session: launch the **latest Launcher** from the repo root and compare native FPS, 1%-low, visual and input correctness in the same 1-1 scene. A static build+tests passing does not certify gameplay. No repeated Off/On profiling needed unless a measured material code change justifies it.

```powershell
cd "C:\Users\hoang\Desktop\dev\KytyPS5"
.\launcher.cmd
```
