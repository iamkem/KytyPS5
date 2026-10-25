# KytyPS5 / Demon's Souls PC — PROJECT STATUS

Updated: 2026-10-25. Canonical project status after cleanup; historical phase reports and experiment scripts are recoverable from Git history.

## Single active checkout and launch targets

- Repo and only writable checkout: `%USERPROFILE%\Desktop\dev\KytyPS5`. Branch: `integration/chenxiao-v20261023b-20261023`. Do not create parallel .devspace worktrees.
- Native game emulator: `_Build/latest/native-build/kyty_emulator.exe`.
- Electron UI: `_Build/latest/launcher/DemonsSoulsLauncher-win32-x64/DemonsSoulsLauncher.exe`.
- Start using `launcher.cmd`: latest Electron build first, `Launcher/DemonsSoulsLauncher.exe` in a portable release second. **Never select historical v5–v9 build directories.**
- Windows runner `run-windows.ps1`, `precompile-windows.ps1`, `run-windows.json`, native emulator, Electron launcher, `launcher-electron/scripts/package-latest.ps1` are all **required**. Keep portable build and Linux workflows/scripts.
- Supported title targeted for experimental engine changes: PPSA01341, version 01.007.000; 01.005.000 has other established runtime support but is not eligible for v1.07-only tessellation changes.

## Current gameplay/graphics functionality

| Feature | Status and notes |
| --- | --- |
| Graphics Detail | **ACTIVE** Standard / Low / Lowest. Lowest sets 480 LOD height, 60m sun-shadow max, disables ambient and spot shadows. |
| Distance Detail | **ACTIVE** Original / Balanced / Performance / Aggressive. Aggressive overlaps with Graphics Lowest LOD/shadow limits; no additive FPS gain expected if both are selected. |
| Distance Tessellation | **ACTIVE, experimental, opt-in.** Early Fade changes only the exact v1.07 PS5 Performance profile line `r_tessellationFadeOutStart=12.0` to `10.0`. Not proven to improve FPS. Original does nothing. |
| DLSS / FSR upscaling, output 1080p/1440p/4K | **ACTIVE.** Uses the game's super-resolution/output paths combined with host Vulkan/NVIDIA/FSR handling. |
| Render height, ultrawide, Frame Generation, HDR, FPS presentation | **ACTIVE** as supported by launcher/native runtime. |
| RAM Diet, RAM16 backing, RAM Safety, Texture Reduce, shader management | **ACTIVE.** Avoid automatically disabling safety protections. |
| Mods Manager, Steam integration, cache management | **ACTIVE**. Preserve all user data. |

`doIndexBufferCulling=false` is an existing game compatibility/performance default. Do not enable it merely to reproduce PS5's compute culling.

## Retired — do not reintroduce as default or experimental options

- **Combined SSR / Particle Ribbon / Contact Shadows**: user runtime test on 2026-10-25 did not meet acceptance. The full selector and runner injection were removed.
- **SSR 64 standalone**: removed together with the Combined test for a single predictable graphics UI. The old `ssr_test` JSON value (including `combined` or `iterations64`) is ignored on load and discarded on the next settings save. `KYTY_SSR_TEST` is no longer consumed or generated.
- **Model/Instance Distance Fading**: isolated modes gave no visible FPS benefit; Combined produced severe geometry corruption. Removed.
- **Geometry Density PS5 8 → PS4 7**: user saw no material FPS gain in matched gameplay. Removed.
- **Experimental virtual geometry / light occlusion toggles**: no reduction in counted draw packets. Removed.
- **Force Shadow LOD**: invalid geometry disappeared; do not reinstate.
- **Retired Occlusion Query Audit, draw-packet census, speculative Ready Pipeline Reuse**: no active hot-path instrumentation or optimization from those probes; preserve the original synthetic always-visible compatibility and completed pipeline adoption.
- Do not revive these on the strength of string matches or constructor defaults in `eboot_ps5rs.elf`. Numbers recovered from v1.07 ELF are *initial constructor values*, not guaranteed effective runtime settings or GPU time reductions.

## Remaining organization

- `src/`, `3rdparty/`, `CMakeLists.txt`, `tests/`, `.github/workflows/`: compiled program, dependencies, CI. **Keep.**
- `launcher-electron/`: only active PC launcher and test suite. **Keep.**
- `launcher.cmd`, `run-windows.ps1`, `run-windows.json`, `precompile-windows.ps1`: entrypoints. **Keep.**
- `tools/local/static-precompile/`, `tools/local/dlss-bridge/`, `tools/local/windows/`, `tools/local/README.md`: reusable tools; several are referenced by build workflows or manual diagnosis. **Keep.**
- `docs/PORTABLE-README.md`, `CURRENT-PLAYABLE.md`, `RELEASE-NOTES.md`, `GPU-DRIVEN-XPR.md`, `MODS_MANAGER_FORMAT.md`, `STEAM_INTEGRATION.md`, plus focused current graphics/shader/memory guides: **Keep**.
- One-off experimental headers, offline policy probes, targeted ELF investigation tools, duplicate/obsolete handoff and dated phase reports have been pruned from the tracked working tree. The **Git history**, rather than the working tree, preserves prior audit details.

## Protected private/generated data — never clean automatically

`_SaveData/`, `_SaveData.rar`, `_Mods/`, `_PipelineCache/`, `_Build/` caches/logs, `_DebugSnapshots/`, `_DevLog/`, `_TempData/`, `_DownloadData/`, `_Textures/`, `game-path.txt`, `launcher-settings.json`, `Steam_DemonsSouls_Launcher.bat`, personal handoff documents and **the original PS5 game folder**. These may be ignored/untracked; ignored does **not** mean safe to delete. User saves, shader hints, backups, mods, extracted games and Streamline SDK are particularly sensitive.

No automatic game launch or shader precompile: prior memory pressure/BSOD history. For actual gameplay validation let the user launch manually.

## Verification after cleanup

```powershell
# Run at repo root; never triggers game launch or shader precompile:
node --test launcher-electron/tests/*.test.cjs
cmake --build _Build/latest/native-build --target kyty_emulator --parallel 2
powershell.exe -NoProfile -ExecutionPolicy Bypass -File launcher-electron/scripts/package-latest.ps1
```

For a non-executing user configuration check, call `run-windows.ps1 -DryRun` with an explicit emulator path and valid installed game. Historical probes are **not** a part of the launch plan. Keeping the native cache and personal settings unchanged matters more than recovering disk space from an ignored output directory.
