# Adaptive RAM — Stages 2 and 3 (2026-10-23)
## Scope

Candidate native emulator: `_Build/windows-ram-adaptive/kyty_emulator.exe`; launcher: `_Build/demons-souls-launcher-v10/DemonsSoulsLauncher-win32-x64/DemonsSoulsLauncher.exe`.

**Opt-in only.** Options > Advanced > RAM Safety Mode sets `KYTY_ADAPTIVE_RAM=1`, shader-prefetch threshold to 4096 MiB, and one background shader-prefetch/follow worker each. Off restores previous emulator selection and behavior. The launcher does not modify the Steam shortcut, `launcher.cmd`, game, save data or shader cache.

## Stage 2: memory-responsive driver pipelines

`src/local/memory-pressure.h` shares three RAM pressure tiers (24 GiB host: <4 GiB elevated, <2 GiB critical; recovery with 1 GiB hysteresis). Every 60 pipeline flips, `PipelineCache::EvictIdlePipelines` samples physical memory availability.

| Tier | Required inactivity | Maximum pipeline releases / scan |
| --- | ---: | ---: |
| Normal | 180 seconds (existing RAM Diet/VRAM policy) | 256 |
| Elevated | 120 seconds | 128 |
| Critical | 90 seconds | 192 |

Adaptive activity is conditional on `KYTY_ADAPTIVE_RAM=1`. The existing Vulkan guards remain: only already-idle pipelines that have a known remake from the static store, with no optimized replacement still pending, can be evicted. Recently bound, unknown-remake and unoptimized pipelines are never selected. Driver releases happen through the existing cache-managed path, *not* via global shader-cache deletion or blanket `vkDeviceWaitIdle`.

`KYTY_PIPELINE_EVICT=0` continues to disable policy-based pipeline eviction. Pipeline eviction may result in a transient compilation/remake stall in a revisited area; no 1% low or memory delta is claimed.

## Stage 3: recoverable file-backed guest memory

The existing Win32 guest backing architecture uses a sparse 13.5 GiB mapping backed by a file created with `FILE_ATTRIBUTE_TEMPORARY | FILE_ATTRIBUTE_NOT_CONTENT_INDEXED | FILE_FLAG_DELETE_ON_CLOSE`. Microsoft's `CreateFile` documentation states that the TEMPORARY attribute encourages holding file data in system cache rather than writing it back to disk.

**Opt-in behavioral change only:** adaptive mode omits `FILE_ATTRIBUTE_TEMPORARY` and retains `FILE_ATTRIBUTE_NOT_CONTENT_INDEXED | FILE_FLAG_DELETE_ON_CLOSE`. This allows *normal* Windows file-cache writeback of cold guest data and thus possible physical RAM reclamation under pressure. All alias views, guest writes, page protections, sparse allocation, shared section, and delete-on-close behavior are unchanged. The game still sees the same bytes. The file remains sparse and can write gigabytes to the drive; the existing free-space check requires guest size + 4 GiB free. No discard, `MEM_RESET`, `VirtualUnlock` of live data, forced process trim or page-table manipulation was added.

Stage 3 is not a proof that the OS has reclaimed pages: Windows owns the decision; disk I/O and re-fault pauses may increase. The mode requires working file backing (`KYTY_BACKING_FILE=1`). A fallback to pagefile-based section should be visible in the log and invalidates the Stage 3 benefit.

## Build and no-game verification

- Standalone policy static asserts: `MEMORY_PRESSURE_POLICY_PASS`
- Isolated 16 MiB Win32 sparse, delete-on-close mapping with two independently mapped aliases, patterns in both directions, flush, cleanup: `GUEST_BACKING_ALIAS_SMOKE_PASS`
- Windows CMake incremental build and link of `kyty_emulator.exe`: PASS
- Launcher 47 tests, packaged UI smoke: verify once after native build
- No Demon's Souls gameplay performed due to previously observed MEMORY_MANAGEMENT BSOD; *cannot claim* crash prevention, RAM savings, FPS or stutter effect

## User acceptance / rollback

1. Use v10 package directly (not the existing v9 Steam target or `launcher.cmd`). In Advanced choose RAM Safety Mode **On**, save settings.
2. On startup expect `Guest memory: adaptive backing allows regular sparse-file writeback (delete-on-close)` and, during a low-RAM transition, `Adaptive pipelines: normal -> elevated` or `-> critical`.
3. Compare RAM available, emulator working set and private bytes, pipeline eviction/remakes, GPU/driver RAM and 1% low frame time. Use an identical short area for comparisons. Do not clear shader cache.
4. If another system fault occurs, or available RAM drops under 1 GiB, or storage paging becomes excessive, stop the game and disable RAM Safety Mode (or switch to v9). No auto game launch, stress test or forced reproduction.
5. Provide the resulting `_Build/run-logs` log files for analysis. Keep save and minidumps.

### Git/reproducibility note
Before these stages, the active working tree had uncommitted RAM Diet pipeline and sparse guest-backing implementations. They are prerequisites of these changes. Other unrelated uncommitted modifications (e.g. GPU VMA, static precompile, platform commit diagnostics) are not included in the Stage 2/3 change and remain untouched.
