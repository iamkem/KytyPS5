# Phase Graphics Optimization Audit — PPSA01341 v1.07 (2026-10-25)

## Scope and non-destructive constraints

- Target: **C:\\Users\\hoang\\Desktop\\dev\\KytyPS5** only; no .devspace worktrees, no game writes, no cached shader deletion, no game launch, no native shader precompile.
- Game inspected: `C:\\Games\\PS5\\DMSR\\PPSA01341-1.07\\PPSA01341-app0` source `eboot.bin` + `misc/renderconfig_*.txt` + `coredata/enginesupport/debugmenu/*.txt`. Checked engine variable presence, not their addresses/values at execution.
- Avoid repeating retired model/instance fading (Combined severe geometry corruption, isolated modes no FPS benefit), unsafe shadow LOD, and ineffective engine occlusion switches.

## P0 — Read-only analysis of actual existing logs

Audit command (read-only, no log writes): `node tools/local/graphics-audit-baseline.cjs --recent 12`. Run from repository root. The tool selects only timestamped run `.out.log` files (not shader-precompile logs), extracts **SLOW Frame threshold events only**, categorizes reported high idle/compile/gpu_wait, and intentionally returns `null` for unsupported FPS, 1% low and GPU busy metrics.

For the 12 logs from 2026-10-25 08:30:31–09:32:45, the tool counted **132** thresholded slow events, **77** events with idle >=80% of the recorded slow frame, **52** events with compile >=10 ms, and **8** events with gpu_wait >=10 ms. Most events did not report a gpu_wait field, so **absence is not zero GPU wait**. Selected logs include **retired Model/Instance experiments** and startup/scene loads. Counts can overlap; do not sum classes into a partition. Neither comparison of these counts nor their slow-frame median is a valid controlled FPS, 1% low, GPU-bound or GPU-ms benchmark.

For game-side A/B measurement on RTX 5070, keep DLSS internal render/output, area/save/camera, ambient and spot shadows, FOV, RAM Safety/Diet and Distance Tessellation fixed. Compare **Original → PS4 Base → Original** with a game restart between modes and allow shader warmup before collecting **60–120 seconds of frame times** from external capture (e.g. CapFrameX/PresentMon) and side-by-side screenshots. Additional emulator HUD Detailed (F8) shows GPU load and render-thread busy but not per-pass GPU time. Only a repeatable improvement with correct game geometry qualifies for promotion.

## P1 — Density: one specifically admissible opt-in research probe

The installed PS5 Performance profile ships `+r_tessellationDensity=8.0`; the installed PS4 Base profile ships `+r_tessellationDensity=7.0`. PS4 Neo is 5; PS5 Trinity 13 and PS5 High 18. These numbers are **profile values, not FPS or geometry equality guarantees**.

The new launcher setting **Geometry Density (Experimental)** is `Original (PS5 Perf 8.0)` by default and `PS4 Base Density 7.0 (probe only)` as explicit opt-in; launcher passes `KYTY_GRAPHICS_AUDIT_DENSITY=original|ps4base`. Native admits only title `PPSA01341`, `APP_VER=01.007.000`, `KYTY_GAME_CONVARS != 0`, and a unique exact `+r_tessellationDensity=8.0` line within a virtual read of **renderconfig_ps5_perf.txt**, without touching assets or unrelated profile values. Existing `r_Wants4K=WantsTrinity` and independent `Distance Tessellation Early Fade` remain intact; when the game doesn't read this profile, the probe has no effect. Logs report whether the density override was actually placed in the virtual-copy output. The log is NOT proof the game accepted the value internally or reduced GPU tessellation dispatches.

**Admission**: no visual geometry loss (walkable structures, models near camera, shadows, character/enemy shapes), no extra compile hitches or increased shader storage; run controlled A/B before claims of performance gain. Do not select this as a normal preset before tests.

## P2 — Particle effects: static evidence, runtime gate NOT GRANTED

`debugrendermenudynamic.txt` exposes `particleResolution`, `particleLowResBudgetFactor`, `particleDistortionResolution`, `particleDistortionBudgetFactor`, `particleRibbonTessDensity`, `particleEnableAsyncCompute`, `particleNumShadowCascades`. The eboot binary contains matching strings. **None of the target setting's default values, enum values for resolution, unit semantics or per-pass GPU costs have been validated for v1.07**. In particular, do not force `particleResolution=0` or guess budget multipliers. First obtain the convar registration metadata/defaults or a read-only game diagnostic before opening a launcher mode. No particle override is injected by this phase.

## P3 — SSR and contact shadows: static evidence, runtime gate NOT GRANTED

`debugrendermenuibl.txt` lists `r_ssrEnableOverrides`, `r_ssrMaxIterations`, `r_ssrMaxRayLength`, `r_ssrCutoffDistance` and `r_ssrMethod`. `debugrendermenulighting.txt` lists `r_contactShadowsEnabled`; the eboot contains those strings. **Neither the effective default SSR settings nor whether contact shadows are active under Graphics Lowest (which already disables ambient and spot shadows) is known**. Avoid guessing an iteration count, toggling reflection shaders in a baseline build, or falsely claiming shadow pass savings. A separate static disassembly or equivalent convar-default evidence plus a per-pass workload measurement is required before exposing an SSR/Contact probe. No SSR/Contact override is injected by this phase.

## Additional prior evidence and retirements

- The current Graphics Lowest and Distance Aggressive overlap at `r_forceViewportHeightForPixelSizeCalc=480` and `sunShadowMaxDistance=60`; the latter does not give extra benefit atop Lowest.
- `doIndexBufferCulling=false` is the existing upstream default on supported Demon's Souls because its GPU culling can cost ~2,800 dispatches/frame on PC; keep unchanged.
- 2026-10-24 engine Virtual/Light Occlusion A/B showed no reduction in counted guest draw packets (historical baseline 6376.8 vs 6388.9/6383.8/6394.9); retirement remains in effect.
- 2026-10-25 Combined Model/Instance probe caused **severe geometry corruption** with no stand-alone FPS benefit; **NO-GO** remains.
- Existing Early Fade `12.0 -> 10.0` had no reported visual faults but **has not shown a measured FPS improvement**.

## Validation contract

- `tools/local/graphics-audit-density-policy-test.cpp`: C++20 constexpr source-profile tests for exact 8.0 -> 7.0 conversion, composition with Early Fade, CRLF, unsupported/duplicate/mismatched inputs.
- `launcher-electron/tests/graphics-audit-density.test.cjs`: launcher persistence, strict enum, -Set propagation, independence from RAM/DLSS/Early Fade, no shader precompile, native audit gates.
- `launcher-electron/tests/graphics-audit-baseline.test.cjs`: log parser does not invent FPS/1% low; ignores shader-precompile files.
- Native build with configured NVIDIA Streamline, complete launcher test suite, Electron package inspection and verified origin branch required before handoff. Game and precompile deliberately NOT executed.
