# Adaptive RAM Management — Stage 1 (2026-10-23)

## Problem and evidence

The Windows host has 24 GiB of RAM. Demon's Souls gameplay logs on 2026-10-23 reported 334-385 MiB available physical memory. System event logs recorded MEMORY_MANAGEMENT (0x1A, first parameter 0x41202) on October 15 and twice on October 23. That bugcheck is NOT proof of a KytyPS5 root cause and this patch is NOT claimed to fix it.

Shader prefetch originally waited only below 1024 MiB available. The opt-in launcher v10 RAM Safety Mode already raised this to 4096 MiB and limited shader workers to one. This stage adds native, opt-in texture retirement under measured physical RAM pressure.

## Native candidate

Build: `_Build/windows-ram-adaptive/kyty_emulator.exe` (isolated from `_Build/integrated` and `_Build/windows-chenxiao`). Existing gameplay binaries are untouched.

Enable: launcher v10 → Options → Advanced → RAM Safety Mode → On. The launcher passes:

- `KYTY_ADAPTIVE_RAM=1` (native texture-pressure policy)
- `KYTY_PREFETCH_MIN_AVAIL_MB=4096`
- `KYTY_SHADER_PREFETCH_THREADS=1`
- `KYTY_SHADER_FOLLOW_THREADS=1`

The native policy in `src/local/memory-pressure.h` samples available physical RAM once every 60 texture GC flips. On a 24 GiB PC it enters elevated pressure below 4 GiB and critical below 2 GiB, with 1 GiB hysteresis on recovery. It changes the unused-image lifetime and per-flip retirement limit:

| Level | Unused GC flips | Max retirements per GC flip |
| --- | ---: | ---: |
| Normal/off | 1200 | 16 |
| Elevated | 900 | 20 |
| Critical | 720 | 24 |

The existing texture eligibility checks remain intact (registered, not depth-associated, not GPU-modified); live resources are never deliberately evicted. It doesn't change guest memory mappings, Vulkan synchronization, working-set limits, save files, mods or shader caches. Shader translations needed immediately by gameplay still run.

This is **not a strict RAM cap**, is not guaranteed to keep 4 GiB available, and may increase texture reuploads, frame-time spikes or shader compilation hitches when revisiting content. Memory freed may be GPU VRAM, system RAM, or driver-managed memory; net Windows physical RAM savings are unmeasured.

## Validation

- Native compile/link: PASS (separate Windows CMake build).
- Standalone header policy test: PASS (static assertions, Windows clang++, warnings as errors).
- Electron launcher tests: 47/47 PASS.
- Packaged v10 UI smoke mode: PASS (including Steam setup, cache protection and Mods Manager).
- Real gameplay, sustained memory trend, 1% low, frame-time and BSOD regression: **NOT VERIFIED**; no automatic launch due to previous system crashes.

## Backout / next gate

RAM Safety Mode is Off by default; unchecking restores prior launcher arguments and emulator binary choice. `launcher.cmd` and existing Steam shortcuts keep the known-good v9. Do not alter saved settings, game files, active shader caches, pagefile or previously uncommitted kernel/GPU work.

If/when the machine has passed its stability checks, validate a short, controlled gameplay session and monitor `Adaptive RAM:` log lines, `PC memory (flip ...)`, texture GC counters, and frame-time percentile compared with the same scene in v9. Stop if RAM falls below 1 GiB, frame-time spikes become sustained, or there are any system errors. No unattended stress/gameplay test.
