# Native 60 FPS target — KytyPS5 / Demon's Souls Remake (2026-10-27)

**Status: TARGET ADOPTED, NOT ACHIEVED.** Replace open-ended profiling/phase proliferation with one finite, reproducible 60-native-FPS performance goal on the user's Ryzen 5 5600 + RTX 5070. No rendering patch is justified by current evidence; no user runtime, rebuild, pack, shader precompile or settings mutation took place in this decision.

## 1. Baseline and end condition

- Real same-boot two 15s **native** FPS windows, graphics `m04_00_00_00` Boletaria 1-1, standard shader, `G2-H On`, internal 1920x1080, output 3840x2160, 60Hz virtual vblank: `_Build/scene-benchmark/session-C4lk7U/results.jsonl`.
- Native FPS **49.47 / 49.80; mean 49.635**, 1%-low **42.54 / 43.32; mean 42.93**, CPU render producer **19.04 / 18.80 = 18.92 ms/Flip**, separate Vulkan recorder **14.76 / 15.04 = 14.90 ms/Flip**. Concurrent CPU times cannot be added.
- 60 native FPS needs **16.667 ms/Flip** compared with mean `1000/49.635 ≈ 20.147 ms`: **3.48 ms reduction / 17.3% frame-time reduction / 20.9% FPS gain** in this workload. The measured `p99_ms=22.9` implies roughly a 27.2% frame-time tail reduction would be needed for every p99 frame to fit within 16.67ms. Capped-60 display average alone is not sufficient evidence of stable 60.
- **Engineering acceptance**: mean native FPS >= 59.5 in a representative warmed standard benchmark with frame generation **disabled**; 1%-low significantly improved (initial floor >=55 before claiming good pacing), stable visual/playback and no crash/readback/protection correctness regression. A true near-locked 60 additionally requires p99 near 16.67ms. The benchmark uses the same scene/resolution/features where possible. Prior two On-only windows are the historical reference; user refuses unnecessary new Off/A/B multiboot.
- The high 60Hz display/output cap creates a measurement ceiling; a matched *uncapped* FPS reading may be necessary to quantify extra headroom once close to 60, but this is **not a requirement to collect another baseline now**.

## 2. What already exists, and what the evidence rejects

1. CPU-side serial graphics/compute command producer is occupied ~94% of frame processing; `G3-B2` RTX5070 GPU timeline showed 11.2ms timestamped command-buffer-span union over ~20.6-22.9ms Flip and many work-feed gaps. No full hardware GPU-busy/present measurement; do not label gaps 9-12ms free GPU time. The favored bottleneck is host producer/coordination (moderate confidence), not established saturated shader throughput.
2. Current source already provides native Table/XPR (**~10,834 logical table draws + ~1,358 table compute dispatches/Flip**), record worker, deferred submit, background shader compilation, guarded snapshot-at-translation-time SRT, callback/readback async handling, graphics-timeline-gated transfer queue and PM4 batching. `G3-B3` found no safe coarse recurring work unit with >=3.48ms exclusive recoverable wall time. Three further read-only independent reviews `agt_7338d48b`, `agt_5c4d16d8`, `agt_eeb0d865` corroborate source-level NO-GO for blind parallelism/batch/WAIT removal.
3. Lower resolution is not a demonstrated cure. This scene was already **1080p internal** to 4K output, and Launcher settings already select **Aggressive** distance detail (minimum 480/60m), Standard other quality, experimental early tessellation fade, no VSync, no frame generation. A bundled Performance/Ultra preset silently turns quality to Lowest, which changes graphics; don't call it a same-quality +10FPS fix. Presentation switches/120Hz virtual vblank cannot be presumed to eliminate host execution work.
4. **Compiler switches are already high-grade:** canonical `_Build/latest/native-build/CMakeCache.txt` records Release `KYTY_NATIVE_OPT=ON`, `KYTY_MARCH=native`, `KYTY_THIN_LTO=ON`, `KYTY_PGO_USE=C:/Users/hoang/Desktop/dev/KytyPS5/tools/pgo/kyty.profdata` (not disabled), `KYTY_PGO_GENERATE=OFF`. Merely enabling PGO/LTO is **not** a missing switch.

## 3. Exactly one bounded next engineering candidate: stale-PGO repair

**Why this, and only conditionally:** `tools/pgo/kyty.profdata` last changed in Git commit `5a081b9d` (2026-10-21). After that, the current branch changed hot `table-xpr.inc` seven times and `bufferCache.cpp` nine times, and modified `graphicsRun.cpp` once. The checked source diff from that profile commit contains **+353/-64 lines across those three files**, including new G2 census branches and timed/sampled diagnostics inside frequently called `RenderExecutor::TableEvaluate`. The top existing profile's internal-block list includes `RenderExecutor::TableEvaluate` with >10B aggregate recorded block counts. PGO's function hash becomes invalid when control flow changes. These facts justify a finite **profile-staleness test**, **not** an assertion that PGO is presently broken or that re-training will recover 3.48ms. `tools/local/PGO.md` reports historical refresh results of ~2.6%-5.3% render CPU improvements on *different* hardware/workloads: useful plausibility for small gains, insufficient to promise 60 FPS.

**Finite gating decision:**
1. First perform at most one **compiler/profile compatibility check** specifically for `TableEvaluate`, `TableBlocks`, `graphicsRun`, `bufferCache`, the actual hot render functions. Use existing Clang PGO warning facilities, preserving the current native binary and canonical output tree. No extra game profiling. If hot paths have no substantial PGO profile invalidation, **STOP this candidate**.
2. Only with confirmed material stale hot profiles, plan **one** training capture through user-controlled Launcher if the instrumentation mode can be safely integrated with canonical `_Build/latest` only; retain the previous known-good canonical binary during any training-to-release transition and don't use a staging or side-built game executable. Never write/rebuild shaders; user must initiate Play; never force-close live game. If these constraints cannot all be met, **STOP** rather than invent a workaround.
3. Rebuild optimized release with the new profile in `_Build/latest/native-build` and one user-controlled warmed 1-1 acceptance session, **On-only**. Compare to the previously recorded ~49.64 baseline with scene/camera/workload caveats. If insufficient improvement or any visual fault, revert and close. One bounded attempt; no indefinitely repeated retraining/measurement.
4. If successfully and safely faster but below 60, keep it only after correctness verification. The remaining ~3ms must come from a *new proven source-level recurring macro component*; do **not** resurrect TableRuns offload, general barrier removal, speculative parallel PM4, micro G2-J, arbitrary Vulkan batch size or premature readback retirement.

## 4. Honest feasibility and fallback

- Independent public demonstration (reports 2026-10-17/20) of **RTX 5070 + Ryzen 7 9800X3D exceeding 60 native FPS**, with substantially different CPU and build/workload settings: https://www.pcgamer.com/hardware/ps5-exclusive-demons-souls-remake-not-only-runs-on-pc-now-its-running-at-twice-the-fps-cap-on-an-rtx-5070-with-frame-gen/ and https://godisageek.com/2026/10/demons-souls-60fps-emulator-rtx-5070/. This shows the GPU SKU can participate in 60 FPS, **not** that a Ryzen 5 5600 build will reach it, nor an apples-to-apples result. 2x frame generation/120 *displayed* FPS are not native frames.
- Therefore there is **no responsible guarantee** that native 60 can be attained in this heavy scene with current Ryzen 5600 at same quality. If compiler refresh and one correctness-safe macro change fail or remain unadmitted, present the hardware/visual-quality tradeoff honestly rather than spawning endless `G3-*` measurements.
- Finite scope: **one named optimization, one measured acceptance or explicit NO-GO**. No extra generic GPU traces, startup profiling or repeated Off baseline without a specifically identified and actionable unknown.

## 5. Workspace and rules

Checkout `C:\Users\hoang\Desktop\dev\KytyPS5`, branch `integration/chenxiao-v20261023b-20261023`. Input HEAD `122a8d25`. Preserve all current untracked private assets. DevSpace Windows only; source editing via DevSpace edit/write, independent subagents read-only. All native builds *only* `_Build/latest/native-build`, Launcher packages *only* `_Build/latest/launcher`. Game must **only** be launched by user:

```powershell
cd "C:\Users\hoang\Desktop\dev\KytyPS5"
.\launcher.cmd
```

This research did **not** change shader precompile, settings, saves, caches, native binary, or bundled Launcher. A 60-FPS success claim must be supported by a real user-run benchmark.
