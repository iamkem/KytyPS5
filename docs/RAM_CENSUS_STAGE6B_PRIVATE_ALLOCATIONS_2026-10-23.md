# RAM Stage 6B — v12 12/12 cohort snapshots and next owner gate (2026-10-23)

## User's second real gameplay sample

The existing file `_Build/run-logs/ram-census-v12.txt` was overwritten by the user's latest v2 collection and now contains **12/12** snapshots. Time window 2026-10-23 ~15:15–15:21; gameplay log `_Build/run-logs/20261023-151352-446.out.log` corresponds to the session (the final log reported a normal emulator end). All inspection was read-only. No gameplay was started or stress-tested by the assistant.

| Counter | First sample | Last sample | Delta |
|---|---:|---:|---:|
| Physical RAM available | 4,799 MiB | 1,349 MiB | -3,450 MiB |
| Emulator working set | 11,169 MiB | 13,501 MiB | +2,332 MiB |
| Emulator private bytes | 8,861 MiB | 9,969 MiB | +1,108 MiB |
| Committed MEM_PRIVATE virtual regions | 8,426 MiB | 9,508 MiB | +1,082 MiB |
| Committed MEM_MAPPED virtual regions | 25,602 MiB | 27,898 MiB | +2,296 MiB |

The first snapshot was already mid-game. Mapped virtual allocations are **not** physical RAM and can alias the same underlying guest page. No conclusion that all 3.45 GiB of system RAM decrease belongs exclusively to Kyty.

### Private cohorts — last snapshot

| Allocation-base size | Count | Virtual committed |
|---|---:|---:|
| Under 4 MiB (combined) | 1,170 | 263.49 MiB |
| 4–16 MiB | 154 | 1,845.45 MiB |
| **16–64 MiB** | **176** | **5,640.75 MiB** |
| 64–256 MiB | 5 | 467.75 MiB |
| 256 MiB and higher | 2 | 1,291.25 MiB |

The 176 x 16–64 MiB allocations average ~32 MiB each and account for almost **60% of private virtual commit**. This is the highest-priority owner-identification question. Their precise owner has **not** been established. A 512 MiB private allocation is visible; `BufferCache::m_staging_buffer` is a possible but unproven match. Changing its size cannot by itself eliminate a ~5.6 GiB cohort, and could increase upload stalls.

Two large private bases late in the run:
- `0x93707f0000`: 779.25 MiB in 539 regions (varies over time; not a monotonic leak).
- `0x82410d0000`: 512 MiB in 1 region (stable).

The previous census (2026-10-23 14:58–15:03) had 10,045 MiB private at finish and 13,654 MiB working set. The two samples are broadly consistent near the end, despite different gameplay duration and potential scene differences.

### Texture Residency Probe was ON

The corresponding latest v12 gameplay log expressly showed **`Texture offload: 489 MiB probed now`** (peak). That number is **candidate pages instrumented**, not physical RAM freed. It also recorded 128 emulator backing-view reads touching 46 MiB, host writes and unmaps. This mode adds page protections and can increase stalls. For a clean baseline and production play, **switch Texture Residency Probe Off**. The file-backed destructive offload remains blocked after its safety gate failure.

The log also showed many pipeline retirements with 493 remakes. This is an FPS/frame-time concern, but the `[ram-diet]` estimation of 635 MiB driver resource release does not account for a multi-GiB host private cohort. Avoid increasing pipeline eviction aggressively.

## Tool v3 — precise allocation-size frequency

Extends `tools/local/kyty-ram-census.cpp` with `RAM_CENSUS_PRIVATE_SIZE`, grouping all private allocations >=1 MiB by their committed size rounded to the nearest MiB. Reports the top 16 sizes by committed bytes, including count and actual bytes.

This answers whether ~176 medium allocations are dominantly one ~32-MiB bucket (e.g. a driver/allocator pool) or a mix of unrelated sizes. No source/runtime changes or host memory modification were made. Built with Windows clang++ `-std=c++20 -Wall -Wextra -Werror` and passed the isolated `--synthetic` 64 MiB PRIVATE + 64 MiB MAPPED test.

**Next safe acceptance:** with v11 or v12 and Texture Residency Probe **Off**, after *the user* starts gameplay, run the existing watch command with a unique output filename and send the resulting log. Do not delete shader caches, switch guest backing or enable mapped-page discard. Do not invoke `heapstats` during low-memory gameplay, as its in-process `HeapWalk` uses substantial temporary storage and may stall other threads.

No memory savings, BSOD prevention or safe multi-GiB release are claimed from diagnostics alone. The chenxiao BSOD fix remains deferred per user preference. Current v11, v12 native binaries and user's uncommitted GPU/kernel working-tree modifications are preserved.
