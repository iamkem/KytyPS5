# Stage 6A — v12 RAM Census interpretation and allocation cohorts (2026-10-23)

## Evidence

Completed `_Build/run-logs/ram-census-v12.txt` has **12/12 snapshots** from 2026-10-23 14:58:13 to 15:03:47. This is gameplay with launcher v12 and `_Build/windows-ram-offload/kyty_emulator.exe`. The game was not launched by any analysis tool. **No gameplay log was available from this run** (`20261023-145439-739.out.log` was 0 bytes at inspection), so diagnostics are from Windows process APIs only.

| Counter | Snapshot 1 | Snapshot 12 | Change |
|---|---:|---:|---:|
| System physical RAM available | 2093 MiB | 1024 MiB | -1069 MiB |
| Emulator working set | 13218 MiB | 13654 MiB | +436 MiB |
| Emulator private bytes | 9922 MiB | 10045 MiB | +123 MiB |
| VQE private committed ranges | 9463 MiB | 9585 MiB | +122 MiB |
| VQE mapped committed ranges | 27125 MiB | 28230 MiB | +1105 MiB |
| VQE image committed ranges | 821 MiB | 821 MiB | 0 |

Private bytes peaked at 10,249 MiB in snapshot 5, then fell below 10,000 MiB in snapshot 9. There is **no proof of a monotonic private leak** over the window. Total available physical RAM fell by more than the emulator working-set delta, implying other system activity/reclaim accounting also needs to be considered. A low available-memory value does not by itself prove a software leak.

Largest mapped allocation base `0x9000200000`: 13,824 MiB across all snapshots; matches the sparse guest backing section. It is not 13,824 MiB **resident** and maps may be aliased elsewhere in `MEM_MAPPED`; never sum mapped virtual sizes as consumed physical RAM.

Private memory at snapshot 12 includes:
- Allocation `0x936f870000`: 919 MiB, fragmented into 340 virtual regions (previous snapshots ~857–1,013 MiB).
- Allocation `0x823ff90000`: 512 MiB, exactly one virtual region and stable across snapshots.
- Remaining roughly 8 GiB private committed **is not explained by the global top-20 list**, because many smaller allocation groups individually rank below the large mapped aliases.

The source contains a fixed 512 MiB `BufferCache::m_staging_buffer` GPU-upload ring (`src/graphics/host_gpu/renderer/cache/bufferCache.cpp`), which is a candidate worth checking; the 512 MiB VQE `MEM_PRIVATE` group is **not positively identified** as this ring. Arbitrarily shrinking it risks extra uploads/flush stalls and is not a multi-GiB RAM fix.

V11 earlier recorded ~820 MiB Vulkan GPU system memory and ~6,348 MiB of GPU video-memory usage, but this was **a different session**. Do not assume those amounts apply exactly to v12.

## Stage 6A tool improvement

`tools/local/kyty-ram-census.cpp` version 2 adds:
- **RAM_CENSUS_COHORT** committed virtual allocation-base groups by bucket: <64KiB, 64–256KiB, 256KiB–1MiB, 1–4MiB, 4–16MiB, 16–64MiB, 64–256MiB, >=256MiB, for each of `MEM_PRIVATE` and `MEM_MAPPED`.
- **RAM_CENSUS_TOP_PRIVATE**: 12 biggest private allocation bases independent of the mapped allocation top-20.
- Keeps the original READ_ONLY operation, `--self`, `--pid`, and bounded `--watch`. No emulator source, game files, scheduler, GPU state or launcher preferences altered.

Validation: `clang++ -std=c++20 -Wall -Wextra -Werror` compiled successfully on Windows. `--synthetic` with 64 MiB private and 64 MiB mapped touched pages passed; cohorts correctly report both separately.

## Engineering decision

Treat RAM exhaustion seriously, but **don't patch guesses**. The key next discriminant is whether the ~8 GiB diffuse private commit is primarily many 16-256KiB heap chunks, many 1-16MiB shader/upload cache blocks, or a few larger arenas not visible in the global top list. All require different lifetime changes.

Next already-enabled session (v11 or v12 with Texture Residency Probe **Off**), run the existing bounded command:
```powershell
.\_Build\kyty-ram-census.exe --watch 30 12 > .\_Build\run-logs\ram-census-cohorts.txt
```
Do not start game automatically. Avoid gameplay if available RAM drops below 1 GiB or Windows becomes unstable. Analyze `RAM_CENSUS_COHORT type=PRIVATE` first, then trace owner(s) with narrow instrumentation or heap histogram only if necessary.

Known safety blocker remains: mapped `DiscardVirtualMemory` failed with 1224 in isolated test; do not reactivate destructive Texture Offload under RAM16.
