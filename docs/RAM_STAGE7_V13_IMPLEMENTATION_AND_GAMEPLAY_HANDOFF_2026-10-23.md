# Stage 7A–7E: Experimental Resource Residency v13 (2026-10-23)

## Status

Native emulator built successfully in _Build/windows-stage7-resource/kyty_emulator.exe.
Electron launcher built in _Build/demons-souls-launcher-v13/DemonsSoulsLauncher-win32-x64/DemonsSoulsLauncher.exe.
Stage 7 is OFF by default, selected under Options > Advanced > Stage 7 RAM Residency.

All 49 launcher unit/integration tests passed, including real run-windows.ps1 DryRun. Windows clang++ 20 policy test PASS, Windows 2 MiB file-backed integrity test PASS. Electron UI smoke returned exit 0. **No gameplay was launched by the assistant** because of previous MEMORY_MANAGEMENT BSOD risk.

## 7A - Architecture baseline

Reviewed Supermedo Bloodborne bbport's 16 MiB staging blocks and GPU-timeline-aware idle trimming, texture cache LRU by real time and protection of GPU-modified images. Compared with current Kyty VMA, GPU buffer, texture cache and earlier ETW.

ETW from the user's manual gameplay found approximately 6.5 GiB of outstanding commit attributed through the dxgmms2.sys GPU memory manager to NVIDIA Vulkan/VMA resource creation. This is virtual commit, NOT automatically 6.5 GiB of physically resident or safely freeable system RAM. Census v3 found 116 x ~32 MiB and 84 x ~16 MiB private allocation groups.

## 7B - Segmented buffer upload staging (implemented, opt-in)

- Ordinary BufferCache::WriteDataBuffer transfers use StreamBuffer-based 16 MiB chunks in an on-demand pool, maximum 12 blocks (192 MiB).
- Reuse depends on non-blocking StreamBuffer::Map and scheduler watches; fallback to original contiguous ring if no chunk is available.
- Trim only if the GPU has completed the last submitted tick and the block has been unused for >=30 seconds; warm pool targets 8 / 4 / 2 chunks according to Windows available RAM.
- For Stage 7 ONLY, the contiguous texture staging ring is 256 MiB instead of 512 MiB. Larger whole-image transfers retain the existing BufferCache::ObtainBuffer fallback; partial-image staging can fall back to whole-image logic.
- The original 512 MiB upload ring is unchanged with Stage 7 off. Logs Stage7 staging: blocks/created/trimmed/cached_mib.

## 7C - Host-aware safe Vulkan GC (implemented, opt-in)

- BufferCache::RetireStaleBuffers also uses host memory critical pressure (available < max(1 GiB, physical/12); approximately 2 GiB on this 24 GiB machine), in addition to GPU VRAM pressure.
- It still excludes GPU-modified and BDA-read buffers from the ordinary clean idle retirement path; no premature freeing of submitted GPU work.
- TextureCache trims the already idle image reuse pool no more than once every 120 flips under critical host pressure.
- Existing Stutter Guard, LRU safety and guest data coherency rules remain; no global device-idle stall is added. Effect on physical RAM and frame-time is not yet measured.

## 7D - Existing SSD-backed guest source (safe subset only)

- Valid clean image uploads already recover their source bytes from the existing sparse file-backed guest mappings. Stage 7 logs successful guest backing reads as Stage7 guest backing: replayed_mib / requests; it measures LOGICAL backing replay bytes, not actual physical SSD I/O.
- There is no duplicated SSD cache and no destructive guest-page discard. Do not enable DiscardVirtualMemory on file-backed guest sections after its prior Windows integrity smoke failed.
- tools/local/stage7-file-backing-smoke.cpp writes, unmaps and remaps 2 MiB of file-backed memory, then verifies every byte; PASS.
- **General GPU-written image/render-target SSD offload is NOT implemented.** It requires validated Vulkan readback, owner/coherency rules and reliable recreation. Stage 7D is a limited safe-use-of-existing-backing implementation, not a universal GPU swap system.

## 7E - Verification

- Native fresh separate build: PASS (Windows clang-cl Release, independent build path).
- Stage 7 policy compile and test: PASS (chunk size/budget, GPU completed gate, idle age, RAM pressure, guest reload guard).
- Windows file backing integrity test: PASS (2 MiB, no guest game files touched).
- Launcher tests: 49/49 PASS; Stage 7 automatically selects the isolated executable, requires RAM Safety and RAM16 On, and forbids Texture Residency Probe On. If Stage 7 is Off, no KYTY_STAGE7_RAM flag is passed.
- Launcher v13 packaged; GUI --smoke-ui returned exit code 0.
- Gameplay, comparative physical RAM savings, long-session FPS/1% low, and visual correctness: **PENDING USER TEST**.

## Test procedure for user

1. Close any running game; open _Build/demons-souls-launcher-v13/DemonsSoulsLauncher-win32-x64/DemonsSoulsLauncher.exe.
2. Options > Advanced: Extended Memory Mode On; RAM Safety Mode On; Stage 7 RAM Residency On; Texture Residency Probe Off; GPU Cache Budget Auto. Retain previous DLSS/FG/resolution.
3. Start Demon's Souls manually. Test a familiar scene and revisit it to reveal upload/reallocation stutter. Stop on corrupted texture/black screen, crash, or Windows available RAM under ~1 GiB.
4. While the game is running, in PowerShell at the repository root, capture this one trace (file is not created until command runs):
   .\_Build\kyty-ram-census.exe --watch 30 12 > .\_Build\run-logs\ram-census-stage7-v13.txt
5. Finish gameplay; report "Da test Stage 7". The assistant can read census + the newest .out.log directly through Windows DevSpace.
6. Compare with v11/v12 in the same location and similar playtime: Windows RAM available, Kyty working set/private bytes, GPU VRAM/shared usage, pipeline remakes and perceived stutter.

If the experiment is worse, disable Stage 7 and return to the separate v11 launcher. Do not delete guest disk backing, cache or shader binaries.

## Safety and source state

- Do not claim any multi-GiB RAM savings before matched gameplay. ETW GPU-local WDDM commits are NOT synonymous with physical RAM.
- No active game, saves, settings or caches were modified; chenxiao upstream BSOD integration stays deferred.
- Existing unrelated dirty files (staticPrecompile.inc, vma.cpp, local-platform.{h,cpp}, _SaveData.rar, mod-manager handoff, archive script) are preserved and must not be staged. NOTE: native binaries built from the working tree include locally modified source even when it is excluded from git commit.

Relevant files: src/local/stage7-resource-policy.h, BufferCache source/header, textureCache.cpp, Stage7 C++ tests, launcher-electron logic, options, launcher tests and package manifest.
