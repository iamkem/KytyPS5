# Chenxiao07 v20261023b integration v15 — compatibility audit and handoff (2026-10-23)

## Goal and upstream

Ingest new Windows-native features from chenxiao07/KytyPS5 at upstream commit `da791c84` (release v20261023b), while retaining the local KytyPS5 fork's **Stage 4 / v11 Stutter Guard**, adaptive RAM/guest sparse backing, the previously ported chenxiao PAGE_GUARD v14 mitigation, Electron Launcher/Mod Manager and other local features.

User requested automatic integration plus conflict analysis. This is an **isolated worktree branch**, NOT an automatic overwrite of the user's main checkout:

- Branch: `integration/chenxiao-v20261023b-20261023`
- DevSpace workspace: `ws_c846daf883`; worktree `C:\Users\hoang\.devspace\worktrees\KytyPS5-93e7e50d`
- Main checkout (unchanged) remains `C:\Users\hoang\Desktop\dev\KytyPS5` at `experiment/perf-40fps-20260926`.
- The main checkout has dirty user-owned `staticPrecompile.inc`, `vma.cpp`, `local-platform.cpp`, `local-platform.h`, user archive and mod-manager handoff. **Do not overwrite/stage/delete these files.**
- Clean worktree source does **not** contain those four local uncommitted patches; gameplay effects may differ from existing binaries. The v15 artifact's source is this branch, not an unverified exact replay of the user's dirty checkout.

Upstream brought 52 commits since the merge base, with ~146 changed files. A direct integration into the user's main checkout would have conflicted with Electron-vs-Windows Launcher, PAGE_GUARD implementation, renderer/cache, memory and several dirty files; it was intentionally avoided.

## Implemented upstream runtime features

- **Windows FSR 3 upscaling** from built-in FidelityFX Vulkan source (`KYTY_UPSCALER=fsr`, without Streamline), includes shader blob generation, linking `kyty_fidelityfx` on Windows.
- **DLSS fixes**: Streamline out-of-VRAM error no longer immediately turns DLSS off; new DLSS model preference (`KYTY_DLSS_PRESET=K` transformer, `E` CNN; Auto is default). Streamline SDK headers located at the **pre-existing private local SDK path**, not committed or distributed.
- **FSR Frame Generation HUD identification fixes** and other related FSR/HDR/Linux changes included from upstream. AMD FidelityFX runtime FG may still require its separate runtime (not verified); built-in FSR *upscaler* was compiled.
- **DualSense Bluetooth** speaker/haptics with Opus 1.5.2 source dependency; includes upstream audio stretch (`KYTY_AUDIO_STRETCH=0` opts out) and device routing.
- **CPU spin gate** worker scheduling reduces spinning when host CPUs busy (`KYTY_SPIN_GATE=1` default upstream; can be disabled for comparison by native environment override). It may change latency versus v11 and requires gameplay validation.
- **GPU zero-tile upload**: tiles proven unmapped and not GPU-written are uploaded as GPU-filled zeros; reduces detile/staging of empty texture pool areas; still needs visual correctness test.
- **GPU selection** `KYTY_GPU` by adapter name/number; v15 Electron offers validated adapter text field, auto default.
- **1080p game output**, additional render heights including 360/540p in compatible mode, language availability, 30 FPS in-game view lock `KYTY_FLIP_RATE=1`; performance changes depend on settings.
- **Precompile improvements**: updated 1.07 shader hints, content hash stamp for new hints, fresh shader-precompile tool and stale shard logic; static source recovered from upstream and custom `StaticCacheFeaturesCurrent()` implementation added to satisfy this fork's precompile diagnostics. **Do not auto-run or delete existing shader caches.**
- **PAGE_GUARD** guest read-protection from v14 stays enabled (`KYTY_READ_GUARD=1` passed by launcher), with 4-KiB rearm, exception settle and guest mapping guards. Its effectiveness against Windows MEMORY_MANAGEMENT is **not verified by local gameplay**.

## Confirmed integration conflicts and remedies

| Issue | Actual finding | Resolution / gate |
|---|---|---|
| 52-commit direct merge | Many true Git conflicts, 8 Windows Launcher modify/delete conflicts, dirty source overlaps | Isolated worktree branch; upstream WPF launcher kept as separate source, Electron Launcher and Mod Manager retained; no main checkout merge |
| Local v14 PAGE_GUARD + upstream code | Duplicate `GuestAddressSpace::ArmReadGuard` caused C++ compile error | Removed duplicate in isolated worktree, preserved synchronized guard handler |
| LiveCounters | Upstream spin gate/zero-tile upload referenced `UploadSleeps`, `RecordSleeps`, `SpinGateShuts`, `UnmappedUploadBytes`, omitted by merge preference | Restored enum and label consistency; compile pass |
| DualSense Bluetooth | `opus.h` missing and target did not link Opus | Linked fetched Opus 1.5.2 in CMake on Windows; compile/link pass |
| Windows FSR3 | `fsr-native.cpp` couldn't find FidelityFX header | Linked `kyty_fidelityfx` on Windows; native compile/link pass |
| Shader tool source | Worktree base `staticPrecompile.inc` ended at line ~875 with literal truncation output marker; separate target failed | Restored full 1457-line upstream static precompile source **only in isolated branch**, implemented missing translator-feature compatibility method; shader tool build/link PASS |
| Streamline SDK | New worktree resolved to a nonexistent worktree-local `_Build/deps/streamline/sdk`: silent DLSS capability loss risk | CMake reconfigured with existing local `C:/Users/hoang/Desktop/dev/streamline-sdk-v2.14.16` (header verified); CMake reports NVIDIA Streamline **enabled**; rebuilt emulator + shader tool successfully |
| FSR 3 / new CLI vs Electron | Old launcher only allowed DLSS, no FSR setting, GPU selector or 30fps model | New v15 opt-in toggle, FSR3 SR via `-Set KYTY_UPSCALER=fsr` (old main script remains compatible), `-Set KYTY_GPU`, `KYTY_DLSS_PRESET`, 30fps; prevents FSR on older binary |
| Main shader updater | Could accidentally choose old `kyty_shader_precompile.exe` | If upstream_latest On, `buildPrecompileArgs` selects `_Build/windows-chenxiao-v15/kyty_shader_precompile.exe`, never auto-runs from UI smoke |
| Stutter Guard vs spin gate / shader prefetch | Both change scheduling/idle memory policy, but no direct compile conflict | Old Stutter Guard remains in `pipelineCache.cpp`; only real gameplay can rule out 1% low regression |
| v13 Stage7 / texture offload | Prior v13 NO-GO, file-backed discard integrity failure | Stage7 and Texture Residency Probe **blocked** by launcher for v15; `KYTY_TEXTURE_OFFLOAD=0`; no `DiscardVirtualMemory` enabled |
| GPU selection for precompile | The user's *main checkout* `precompile-windows.ps1` does not take `-Gpu`, though isolated-branch script and new native do | **Open limitation for multi-GPU PCs**: running new shader tool uses automatic GPU unless explicitly invoked in worktree with `-Gpu`. A mismatched GPU may compile unusable driver shaders; don't assume GPU selection is synchronized for precompile |
| Source parity | User local dirty `vma.cpp`, `local-platform` patches were not part of clean v15 worktree | Gameplay A/B is not perfectly comparable with existing locally built v11/v14; track as residual risk |

## Verification in this turn (no game launch)

- Windows native Release `kyty_emulator.exe` **COMPILE+LINK PASS**, built in `_Build/windows-chenxiao-v15`; most recent build correctly compiled against private Streamline SDK headers.
- Windows native Release `kyty_shader_precompile.exe` **COMPILE+LINK PASS** after repairing static source, linking Opus/FSR3, adding compatibility method and pointing CMake at Streamline SDK.
- Electron Node unit/integration tests **51/51 PASS**, including real `run-windows.ps1 -DryRun` and isolated feature selection; **re-run after final shader-tool dispatch edit**.
- Electron launcher packaged at `_Build/demons-souls-launcher-v15/DemonsSoulsLauncher-win32-x64/DemonsSoulsLauncher.exe`; GUI `--smoke-ui` exit 0 (re-run after final packaging).
- No regular gameplay, forced RAM pressure, cache rebuilding or BSOD reproduction was attempted.
- Compilation warnings remain from earlier source code (return type, MSVC deprecations); no known compile/link blockers remain.

## How to use safely (user-owned gameplay only)

1. Start `C:\Users\hoang\Desktop\dev\KytyPS5\_Build\demons-souls-launcher-v15\DemonsSoulsLauncher-win32-x64\DemonsSoulsLauncher.exe`.
2. Options > Advanced: set **Extended Memory (RAM16) On**, **RAM Safety Mode On**, **Chenxiao v20261023b Native Features (v15) On**; **Stage7 Off**, **Texture Residency Probe Off**, **GPU Cache Budget Auto**. Previous guard v14 may be Off; v15 already uses PAGE_GUARD.
3. Graphics: start with known working NVIDIA DLSS, DLSS Model Auto, same render/output/FG as v11. **Do not immediately switch to FSR3, lower resolution and new FG in one trial**; change only one option after v15's baseline is stable. Keep FPS30 Off unless specifically testing it.
4. Do not automatically run Update Missing Shaders or delete/rebuild the 5.7-GiB shader pipeline store just to start game. The new shader tool is available for subsequent deliberate precompile tests, not an automatic migration.
5. Close the game if Windows physical RAM available approaches ~1 GiB, if any texture is corrupt, audio abnormal or gameplay stutters/crashes. No stress/BSOD reproduction.
6. Keep v11 as known-better gameplay reference and v14 as isolated BSOD-guard-only reference; no proven FPS/RAM improvement or BSOD safety claim until actual user gameplay.

## Versioning and push policy

The integration stays on its own feature branch pending gameplay acceptance. The user main branch remains unchanged, and their dirty source/save/cache files are preserved. Do not force merge entire upstream into that checkout. Pushing a separate branch preserves reviewability without overwriting local edits.
