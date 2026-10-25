# KytyPS5 — Isolated Shader Feature Trial 0x3 (2026-10-25)

## Status: infrastructure BUILT, shader generation NOT compiled or promoted

Target: NVIDIA RTX 5070 / Demon's Souls 1.07 / branch `integration/chenxiao-v20261023b-20261023`. No gameplay or shader precompile was run as part of this rollout. No FPS, visual-equivalence, BSOD-safety, shader-coverage or VRAM benefit is proven.

The production cache remains at `_PipelineCache/`, with existing feature stamp `0 3 e83d291c179fb692` and existing ~5.6 GB `.binaries` unchanged.

**Trial opt-in**: `KYTY_SHADER_FEATURE_TRIAL=1` via the two explicit PowerShell switches below. Isolated C++ cache root `_Build/shader-feature-trial/_PipelineCache` for static, local, table, played, warmup, and game-file recordings. Separate trial precompile staging, logs, generated hints/seeds, and NVIDIA per-shard scratch under `_Build/shader-feature-trial/`.

The build has an early **read-only CLI capability handshake** `--shader-feature-trial-capabilities`. Both scripts refuse an old executable incapable of confirming the new trial root. Trial runtime refuses to proceed without exactly effective NVIDIA translator features `0x3`, `0x3` static store stamp, `static/<game>.trial-ready` marker, `VK_KHR_pipeline_binary` support, valid matching pipeline binary store **with full stored-payload XXH3 integrity validation (streamed in bounded 256 KiB chunks)** and no explicit disabling of the static pipeline cache or external warmup override.

**No standard launcher controls** or saved settings changed. The regular launcher does not request trial mode. Rollback is a fresh normal launch; no changes to standard `.features`, no copy/rename/cleanup of production cache.

## What 0x3 enables

- `0x1`: CooperativeHalves for eligible wave64 compute shaders on 32-lane NVIDIA subgroups (exact eligibility remains proven per shader).
- `0x2`: TableSlotsAtUse for delayed shader table-slot loads. Must be evaluated with 0x1 to avoid potential severe register pressure/spills.
- `0x4`: NativeFloatMinMax is intentionally excluded for NVIDIA.

The source originally had these features but disabled them to match the legacy `0 3` static store. No metadata spoofing, global force variables, or on-the-fly mixture of old/new shaders is used.

## Preflight — safe to run, read-only

PowerShell in `C:\Users\hoang\Desktop\dev\KytyPS5`:

```powershell
$game = 'C:\Games\PS5\DMSR\PPSA01341-1.07\PPSA01341-app0'
$seeds = '.\_Build\static-precompile\seeds-PPSA01341_01.007.000.seeds'
$precompiler = '.\_Build\latest\native-build\kyty_shader_precompile.exe'
$emulator = '.\_Build\latest\native-build\kyty_emulator.exe'

.\precompile-windows.ps1 -ShaderFeatureTrial -TrialCheck -Full -Game $game -Seeds $seeds -Exe $precompiler
.\run-windows.ps1 -ShaderFeatureTrial -DryRun -Game $game -Exe $emulator
```

Both commands have been tested locally and did not launch shader compilation or the game. The isolated root must be `_Build\shader-feature-trial\_PipelineCache`. If the preflight rejects paths or inherited force variables, fix the environment; do not bypass the checks.

## OPTIONAL full trial precompile — **not run automatically**

**This is heavyweight and has a prior RAM/BSOD risk on this PC.** Only start manually after checking free physical RAM, free disk space, system stability and avoiding concurrent applications. A separate store can be several GiB, plus shard/scratch data. This may raise CPU/RAM use substantially.

```powershell
.\precompile-windows.ps1 -ShaderFeatureTrial -Full -Game $game -Seeds $seeds -Exe $precompiler -Jobs 2 -Threads 2
```

The script keeps all generated output in the trial namespace, uses existing seeds and released specialization hints only as inputs, and refuses quick, incremental, replacement, seed refresh and maintenance modes. An interrupted/failed run never publishes `static\PPSA01341_01.007.000.trial-ready`; trials with failed hint processing also fail closed.

**Do not** edit the old `.features`, force `KYTY_LANE_LOCAL_COOP=1` / `KYTY_TABLE_SLOTS_AT_USE=1`, select production `-ReplaceCache`, or copy trial binaries back to production.

## OPTIONAL later gameplay A/B — NOT YET PERFORMED

This may write game save data during gameplay; back up saves separately first. The trial namespace protects shader/cache outputs, **not game progression or all Windows/NVIDIA driver-managed stores**. Validate visual equivalence and RAM/VRAM pressure before promoting.

```powershell
.\run-windows.ps1 -ShaderFeatureTrial -Game $game -Exe $emulator
```

Compare against a fresh normal-launch process in a matched scene after warmup. Collect median/mean frametime, 1% low, record/render/GPU timings, cache misses and GPU memory; inspect particles, fog, water, lighting and scene changes. Keep `0x3` behind explicit opt-in until these pass. If no useful improvement, return to normal launcher without modifying either cache.

## Verification performed (CPU/build only)

- Independent Codex subagents performed read-only risk reviews, including post-patch findings and corrections.
- PowerShell syntax checks: `run-windows.ps1` and `precompile-windows.ps1`: **0 parse errors**.
- Trial preflight `-TrialCheck` / runner `-DryRun`: **PASS**, no game/shader process.
- New Node policy suite `node --test launcher-electron/tests/shader-feature-trial.test.cjs`: **3/3 PASS**, includes PowerShell preflight + joined `-Set` bypass refusal.
- Native compile `cmake --build _Build/latest/native-build --target kyty_emulator kyty_shader_precompile --parallel 2`: **PASS** with warnings pre-existing in unrelated source.
- Two CLI handshakes: **exit 0** in Release, no Vulkan/game. Non-Release executables explicitly refuse the trial handshake and runtime admission.
- Added a trial-only full scan of each binary payload against its stored XXH3 hash before loading any trial pipelines; this avoids accepting a corrupted store whose index/footer is otherwise valid. Startup can be slower because the whole trial store is read once for verification.
- Original production `.features` and `.binaries` metadata unmodified (2026-10-24 timestamps); trial-ready absent because precompile not run.

## Known limits and next gates

- The readiness marker is a fixed completion certificate rather than a cryptographically signed manifest; actual Vulkan driver/GPU signature is checked by opening the binary store. A future improved manifest could bind the exact seeds, source fingerprint, translator ABI and driver version.
- Cache namespace isolates Kyty's pipeline cache but does not control the NVIDIA driver's own unmanaged persistent cache, scratch allocations in the Windows temp directory, or game saves. Keep safety boundaries explicit.
- No single-shader dynamic selection: feature mask is global; promotion should be based on verified RTX5070 A/B and shader correctness, not a source-only claim.
- Full payload validation detects corruption at admission, but does not prove the driver will accept all stored binaries or that emitted SPIR-V renders correctly. Any driver rejection still needs measured coverage and stability gates.
- The trial runner uses an explicit separate switch; a non-trial `-Set` that attempts to inject the opt-in feature is refused.

## Paths changed

`src/local/shader-feature-trial.h`, `src/main.cpp`, `src/local/shader-precompile.cpp`, `src/graphics/host_gpu/renderer/pipeline/pipelineCache.cpp`, `src/graphics/host_gpu/renderer/pipeline/pipelineBinaries.h`, `src/graphics/host_gpu/renderer/pipeline/pipelineBinaries.cpp`, `src/libs/libAmpr.cpp`, `run-windows.ps1`, `precompile-windows.ps1`, `tools/local/shader-feature-trial-policy-test.cpp`, `launcher-electron/tests/shader-feature-trial.test.cjs`.

Research context: `docs/GRAPHICS_TECHNICAL_CEILING_RESEARCH_2026-10-25.md`.
