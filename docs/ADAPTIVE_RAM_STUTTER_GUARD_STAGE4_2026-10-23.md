# Adaptive RAM Stage 4 — Stutter Guard candidate (2026-10-23)

## Trigger: user gameplay feedback, same day

User reported **noticeable stutter** in the previous v10 Adaptive RAM gameplay run (13:14–13:22).

Read-only evidence from `_Build/run-logs/20261023-131445-640.out.log`:
- `3449 evicted of 4820` remake-capable pipelines, `1431 made again`
- `1904 ms` total synchronous remakes, **38.8 ms maximum** (possible frame-time spike).
- Original RAM Diet + Stage 2 (v10) was aggressively evicting at 180/120/90 seconds and 256/128/192 per scan respectively. Revisited areas paid the remake cost.
- System physical RAM available reached **853 MiB** at a shader wait (864 MiB in the last periodic PC memory sample), so protecting *all* pipelines unconditionally is not safe either.
- Concurrent new shader compilation, DLSS missing-input warnings, and guest-backing disk read/write could also contribute; no single root cause is proven.

## Changes in candidate

- New isolated native build: `_Build/windows-ram-stutter-guard/kyty_emulator.exe`
- New isolated Electron launcher: `_Build/demons-souls-launcher-v11/DemonsSoulsLauncher-win32-x64/DemonsSoulsLauncher.exe`. v11 RAM Safety Mode **On** selects the new candidate.
- v10 launcher and `_Build/windows-ram-adaptive/kyty_emulator.exe` remain unchanged for A/B comparison.
- `_Build/integrated/kyty_emulator.exe`, launcher.cmd and saved graphics config were not overwritten.

The new pipeline policy (only when `KYTY_ADAPTIVE_RAM=1`):
| RAM level on 24 GiB machine | Idle before pipeline eviction | Maximum evictions / scan | Remake grace |
|---|---:|---:|---:|
| Normal | 300 sec | 32 | 600 sec |
| Elevated (below 4 GiB) | 240 sec | 32 | 600 sec |
| Critical (below 2 GiB) | 180 sec | 64 | 600 sec |
| Emergency (below 1 GiB) | 90 sec | 128 | Disabled to protect system memory |

- Removes fast **scene-only eviction** from Adaptive RAM mode. Normal pipeline retirement still uses its idle-age and graphics remake eligibility tests.
- Tracks timestamp of a pipeline that was *synchronously remade* by the renderer, and prevents eviction for 10 minutes (except physical RAM emergency).
- Reuses the existing Vulkan checks: known remake recipe, no unoptimized or pending-optimized pipeline, last GPU binding sufficiently old. Does not delete shader binaries, change game assets or touch Vulkan synchronization.
- All existing Stage 1/3 texture GC, sparse file backing and shader prefetch controls remain in place.
- When RAM Safety Mode is Off, the native pipeline eviction logic still follows the original Ram Diet/VRAM-budget code path.

## Validation (no gameplay)

- Native C++ policy unit test: `MEMORY_PRESSURE_POLICY_PASS`
- New clean Windows native CMake build and link: PASS.
- Launcher Node.js test suite: **47/47 PASS**.
- Packaged launcher v11 smoke mode (Mods, cache, Steam, UI): **PASS**.
- Launcher to `run-windows.ps1 -DryRun`: selected expected isolated executable and propagated `KYTY_ADAPTIVE_RAM=1`, `KYTY_PREFETCH_MIN_AVAIL_MB=4096`, one shader prefetch and follow worker; 1080p DLSS and 2x frame generation switches preserved.
- Real gameplay, FPS, 1% low, physical RAM savings, reduction of stutter/BSOD: **not validated**.

## Suggested short A/B acceptance run

Use exact same gameplay area and settings in separate sessions:
1. v10 Stage 1–3 (known baseline) versus v11 Stutter Guard, both **RAM Safety Mode On**.
2. Track Windows available RAM, process working set, disk active time, and subjective stutter. After exit, compare the final lines `Pipelines out of video memory while idle:`, `Made where first needed:`, `PC memory (flip`, and `Adaptive RAM:`.
3. Target: **materially fewer re-makes and frame-time spikes**, without more severe physical memory starvation. This is a *goal*, not a result.
4. If available RAM again falls below **1 GiB** or any Windows restart/BSOD occurs, stop and revert to the known-good v9 or v10; do not do unattended stress testing.
5. Do **not** delete shader cache or saves. Existing v10 remains the easy rollback.

## Reproducibility note

The independent Windows build still includes several existing uncommitted changes in `staticPrecompile.inc`, `vma.cpp`, and `local-platform.{cpp,h}`; they are not part of this Stutter Guard commit and were preserved unchanged. The branch commit contains only the Stage 4 code, launcher wiring and tests. Thus the locally built EXE is not a completely clean-checkout reproducible artifact without those prior changes.
