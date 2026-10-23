# Stage 6C — RAM Census v3 + static pipeline binary index audit (2026-10-23)

## Results of latest user gameplay collection

Log: `_Build/run-logs/ram-census-v3.txt` (12/12 samples, 2026-10-23 15:33:35–15:39:08), with native gameplay log `_Build/run-logs/20261023-153207-216.out.log` from the same session.

**Windows host**: 24,499 MiB physical RAM, RTX 5070, NVIDIA driver 32.0.16.1742 (617.42), Windows 11 Pro build 26300. No new gameplay launched by the assistant.

| Counter | First sample | Last sample | Change |
|---|---:|---:|---:|
| Physical memory available | 5093 MiB | 3392 MiB | -1701 MiB |
| Kyty working set | 11023 MiB | 12520 MiB | +1497 MiB |
| Kyty private bytes | 9244 MiB | 9103 MiB | -141 MiB |
| Committed MEM_PRIVATE virtual ranges | 8790 MiB | 8646 MiB | -144 MiB |
| Committed MEM_MAPPED virtual ranges | 25308 MiB | 26871 MiB | +1563 MiB |

**The central diagnosis is long-lived medium-sized private allocations, not a monotonic private-memory leak during this interval.** From the second half onward private bytes stayed roughly flat at ~9462 MiB for seven samples, then fell to 9103 MiB. The physical available memory remained above ~2.9 GiB throughout samples 3–12, not the same as earlier sessions nearing 1 GiB. Scenes, activity and config can differ; do not assume a reproducible net optimization.

### Crucial new size-frequency data

Last sample:
- **116 allocation bases approximately 32 MiB each: 3712.55 MiB committed virtual memory.**
- **84 allocation bases approximately 16 MiB each: 1328.76 MiB.**
- Combined **5041.31 MiB** (about 5 GiB, ~58% of process committed private virtual ranges).
- Stable allocation counts since sample 4 (116 and 84, respectively) while guest mapped memory, host physical memory availability and pipeline retirement changed.
- A separate **512 MiB** private allocation base and a larger varying base (644–999 MiB late in run).
- Windows `VirtualQueryEx` cannot identify ownership (NVIDIA user-mode driver vs emulator allocator vs imported library) by size alone. `MEM_PRIVATE` commitment does not prove all bytes are resident in physical RAM.

### Static pipeline binaries hypothesis tested and rejected

The real game static binary cache `_PipelineCache/static/PPSA01341_01.007.000.binaries` is 5,949,767,132 bytes, and `PipelineBinaries::Open` only loads the ~9 MiB *index*, reading payload binaries on demand.

A **read-only** standalone parser `tools/local/kyty-binary-index-audit.cpp` was built and run (Windows clang++ `-std=c++20 -Wall -Wextra -Werror`, PASS), reading only the final indexed tables, not the 5.7 GiB of binary data:
- 102,710 binaries, 66,729 pipeline keys, 102,789 references.
- 5,665.07 MiB binary payload, ~9.07 MiB index.
- `PipelineBinaries::SharedUsers` is 16. **Zero binary objects** are referenced 16 times; therefore the persistent `m_shared` pipeline-binary handle cache does **not** account for the ~5 GiB host private allocation cohorts.
- Shared-handle count above threshold: zero. Do **not** cap or evict `m_shared` based on the similarity of sizes, and do not delete the binary file or disable static shader cache in the name of RAM savings.

The **drivers' Vulkan shader/compiler allocations** remain a hypothesis, not a proven origin. The user's driver version 617.42 is also present in an external October 2026 NVIDIA forum report that describes 112 *32 MiB GPU local-memory allocation* blocks in a different RTX 5090 compute pipeline workload. It supports only the plausibility of 32 MiB driver-granularity pools, **not** equivalence with the Kyty `MEM_PRIVATE` allocations, nor common crash mechanisms.

### Existing engine source and relevant limits

- `BufferCache::m_staging_buffer` contains a fixed 512 MiB GPU upload ring; private 512 MiB is NOT verified to be the same allocation.
- `m_table_upload` / `m_download_buffer` are 32 MiB each, **not** a match for 116 stable host-private 32 MiB allocations without process tracing.
- `PipelineBinaries` lazily reads payload and creates per-pipeline owned `VkPipelineBinaryKHR` handles, destroyed after pipeline creation; the >16-shared handle cache has no eligible entries in this exact binary store.
- Both v11 and v12 keep GPU device VRAM well under budget; lowering GPU Cache Budget is not evidence-based.
- Texture Residency Probe was **On** in the v3 session (log: `Texture offload probe: on`, 443 MiB probed at late snapshots), though it does not discard pages or reduce memory. For a clean performance baseline, turn Probe **Off**.

### Next engineering gate

Use a **low-overhead process allocation provenance trace** (or Windows Performance Recorder/Analyzer with appropriate allocation stack tracing) to associate the ~32/16 MiB private allocation bases with the code module/stacks that allocated them. WPR, xperf and WPA executables are installed on this Windows host. Avoid enabling full in-process `heapstats` during low-memory gameplay or guessing from allocation sizes. The next implementation strategy depends on the actual owner:

- If NVIDIA Vulkan driver: investigate host pipeline/shader resource creation and lifetime, and use driver-aware accounting. Vulkan driver internals cannot safely be freed by calling Windows VirtualFree on their pages.
- If an emulator scratch/cache allocator: implement genuinely reversible pool growth, trimming or reuse only after tracking busy vs cached allocations.
- If backing/residency dominates: focus on lossless page writeback and Windows standby/mapped residency accounting.

**Do not** reactivate mapped `DiscardVirtualMemory`: prior file-backed smoke returned 1224 and failed byte-preservation safety gate. Avoid claimed multi-GB RAM savings until Windows *available physical memory* and frame times are measured in matched gameplay.

## Source / reproducibility

`tools/local/kyty-binary-index-audit.cpp` performs read-only parsing and is independent of the game build. Existing native emulators, launchers, saves, shader caches, and unrelated dirty source files remain unchanged. The new parser validates index structure but does not hash-check table contents or assume measured driver handle sizes.

The next owner-attribution stage can operate separately from the emulator; no need for an immediately recompiled native game binary. BSOD upstream fix is intentionally deferred at user request.
