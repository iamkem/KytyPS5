# RAM Root Cause — Stage 6 Virtual-Memory Census (2026-10-23)

## Decision / scope

Prioritize **actual Windows physical RAM use** in KytyPS5. The user reports v11 Stutter Guard noticeably smoother, but still almost 100% physical RAM utilization. Defer the chenxiao upstream BSOD fix integration to a separate later change. Do not regress current v11 or enable the unsafe texture page-discard path.

### Existing gameplay baseline — v11 2026-10-23 14:07 session

Log: `_Build/run-logs/20261023-140733-513.out.log`.
- **13,811 MiB** process working set when sampled late in game
- **10,232 MiB** process private bytes in the same line
- **1,036 MiB** minimum available RAM at shader-prefetch wait (other intervals: 1,143 MiB, 1,423 MiB, etc.)
- **13,824 MiB** sparse guest backing file mapping size (NOT a physical-RAM measurement)
- **820 MiB** GPU system memory reported by Vulkan near peak
- **6,348 MiB** GPU video-memory usage out of **11,175 MiB** reported budget
- Stutter Guard reduced pipeline remakes to **507**, cumulative 687 ms (v10 had 1,431, 38.8 ms worst per remake; v11 worst 16.2 ms).
- RAM Diet freed ~229 MiB driver pipelines by exit, nowhere near enough to reduce system usage by multiple GiB.

These metrics **cannot be added together**. The sparse file mapping can have multiple virtual aliases referring to the same physical pages; process private bytes and working set are distinct Windows accounting dimensions. The large private allocation figure indicates a need to investigate private allocation ownership, not a proven memory leak.

## Stage 6 tool (read-only, out-of-process)

`tools/local/kyty-ram-census.cpp` compiles to `_Build/kyty-ram-census.exe`.

The tool uses only Windows process-query APIs:
- Find the already-running `kyty_emulator.exe` process or accept `--pid N`.
- Read `PROCESS_MEMORY_COUNTERS_EX` for working set/private bytes and `GlobalMemoryStatusEx` for system memory.
- Scan the target's address-space descriptors with `VirtualQueryEx` without reading game bytes or modifying memory.
- Bucket committed virtual regions as **MEM_PRIVATE**, **MEM_MAPPED**, **MEM_IMAGE**, other, along with reserved virtual space.
- Group regions by allocation base and report the largest 20 owners >=8 MiB.
- `--watch SECONDS COUNT` (bounded: 5–300 seconds, 1–60 snapshots) collects time-stamped snapshots externally and stops if the target process exits; never starts/restarts/suspends the game.
- `--self` and `--synthetic` are isolated local correctness tests.

### Validation

Windows clang++ `-std=c++20 -Wall -Wextra -Werror`: **PASS**.

`--synthetic` allocates and touches **64 MiB committed MEM_PRIVATE** and **64 MiB MEM_MAPPED** in the census tool itself and verifies:
- Process working set 131 MiB, private bytes 64 MiB (the Windows counters)
- VirtualQueryEx private committed 64 MiB, mapped committed 65 MiB (additional small system mappings)
- Largest entries: private 64 MiB, mapped 64 MiB
- `RAM_CENSUS_SYNTHETIC_PASS`.

Invalid PID and invalid watch interval exit with code 2. No emulator was started or modified.

### Next matched gameplay measurement

With **Launcher v11** and your existing settings, *after you start playing* (no game start by the tool), from the KytyPS5 directory:

```powershell
.\_Build\kyty-ram-census.exe --watch 30 12 > .\_Build\run-logs\ram-census-v11.txt
```

This records 12 snapshots over about 5.5 minutes; do not run unattended given prior low-memory incidents. If memory is critically low or Windows becomes unstable, close the game. Send `ram-census-v11.txt` and the corresponding `_Build/run-logs\*.out.log` for analysis.

**Interpretation gate:** look for a private allocation group whose committed size increases substantially between snapshots. If there is one, identify the allocation owner (Vulkan/host heap/shader/etc.) and optimize lifetime/duplication there. If private groups stay stable while mapped bytes and working set grow, focus on guest mapped page residency and avoid unsafe mapped discard. A future fix must measurably improve host available RAM in the same gameplay scene without increasing stutter or triggering corrupt data.

### Important limitations

- `VirtualQueryEx` measures **committed virtual address ranges, not physical residency**. Large MEM_MAPPED sections may alias the same underlying pages: summing them can double-count. Not a heap allocation stack tracer or an exact physical RAM profiler.
- This stage adds **diagnostics**, not an unverified claim of memory savings. It cannot identify the owner of every allocation without follow-up instrumented measurements.
- The file-backed `DiscardVirtualMemory` path previously failed with 1224 and cleared test bytes; the destructive texture-offload path remains blocked with RAM16.
- No source or settings of the v9/v10/v11 game builds, user saves, launcher.cmd or shader caches were touched in Stage 6.

Git: Only the tool and this document should be committed. Other pre-existing uncommitted renderer/VMA/local modifications remain outside the commit.
