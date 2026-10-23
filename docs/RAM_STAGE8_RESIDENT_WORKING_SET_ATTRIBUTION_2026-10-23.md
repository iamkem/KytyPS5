# Stage 8 — Resident-RAM attribution after Stage7 NO-GO (2026-10-23)

## Decision: stop Stage 7 v13

The user-run v13 census had **625 MiB minimum free physical RAM** and 982 pipeline remakes (1932 ms cumulative, max 173.3 ms) over its test. Earlier v12 had 1198 MiB minimum free and 493 remakes, but scenes/background activity/Texture Probe configuration differed. This is **not proof Stage7 caused the difference**; it is firm evidence Stage7 **failed to demonstrate physical RAM saving and acceptable stutter**. Stage7 remains opt-in and OFF by default. Recommend v11 for normal play, not another risky v13 replay.

V13 chunked pool created only a single 16 MiB block and trimmed 0 blocks. Its reused file-backed guest bytes were logical replay and not physical SSD offload. No benefit to iterating staging parameters without new evidence.

## Alternative hypothesis

The ETW Vulkan/WDDM ~6.5 GiB outstanding commit and the older 116 x 32 MiB + 84 x 16 MiB Windows MEM_PRIVATE allocation cohorts describe **virtual commitment**, not unique host resident RAM. Windows process working set actually reached ~13.8 GiB, and the key unanswered question is **where that physically resident set lives**: NVIDIA/WDDM private pools, guest mapped aliases or CPU-side allocations.

Before implementing another eviction or SSD cache, classify resident versus nonresident mapped/private pages and correlate with real Windows process working set.

Existing emulator already uses sparse-file guest backing (13.5 GiB), Windows pageable writeback, FreshMemory untouched-page zero fills, asynchronously trims parked guest ranges (Kyty.Trim), and lazy shader/pipeline binaries; blindly duplicating those mechanisms is not promising.

## New read-only tool

Source: tools/local/kyty-working-set-sampler.cpp
Built binary: _Build/kyty-working-set-sampler.exe

- QueryWorkingSetEx samples one page per 256 KiB of committed virtual ranges after VirtualQueryEx enumeration, hard cap 300,000 pages. No memory reads/writes or working-set trimming.
- Reports PRIVATE_16MiB, PRIVATE_32MiB, PRIVATE_OTHER, MAPPED_LARGE, MAPPED_OTHER, IMAGE, OTHER. A process-owned working set page is tagged by address and allocation-base family; the residency estimate is statistical, not exact.
- Reads GetProcessMemoryInfo actual process working set/private bytes and Windows physical RAM availability.
- Mapped aliases can double-count virtual sampled residency. Estimated sampled sum need not equal actual process working set. Do NOT interpret it as unique physical bytes or commit.
- One shot only to minimize runtime perturbation. No game launch, memory locking, mprotect/VirtualProtect, VirtualFree, DiscardVirtualMemory, or process injection.
- Tested with Windows clang++ -std=c++20 -Wall -Wextra -Werror: PASS.
- Self test: _Build/kyty-working-set-sampler.exe --self PASS (3.96 MiB estimated versus 3.77 MiB actual working set). Small-test error illustrates need for caution.

## Optional next test, NOT during critical RAM pressure

When user is already playing **known-good v11**, and available physical RAM is **above 2 GiB**, run once from checkout root:

    .\_Build\kyty-working-set-sampler.exe > .\_Build\run-logs\ram-residency-v11.txt

Tool finds the live emulator process automatically. It never starts the game. No need to repeat ETW. If no emulator is open, it refuses and prints an error.

Decision tree:
1. Large resident PRIVATE_16MiB / PRIVATE_32MiB: research driver-backed memory lifetime, inspect exact owners of retained allocations; never free driver pages using Windows APIs.
2. Dominant MAPPED_LARGE / MAPPED_OTHER: focus Windows guest page residency, mapping lifetime and safe cold guest paging, not GPU caches. Never destructive mapped discard.
3. Dominant PRIVATE_OTHER: bounded CPU heap/shader allocator attribution instead.
4. Sampled estimate diverges widely from process working set: improve diagnostic precision, do not act on noisy values.

This phase is **diagnostic**, not a claimed optimization or multi-GiB saving. Existing v11/v12/v13 executables and all game/cache files and user-owned dirty source remain unchanged; upstream BSOD fix still deferred.

Official API references:
https://learn.microsoft.com/windows/win32/memory/working-set
https://learn.microsoft.com/en-us/windows/win32/api/psapi/nf-psapi-queryworkingsetex
https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-virtualqueryex
