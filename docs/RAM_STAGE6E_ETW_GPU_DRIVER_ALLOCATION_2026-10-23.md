# Stage 6E — ETW allocation provenance, GPU driver ownership (2026-10-23)

## Verified trace (read-only)

Captured by user: `_Build/run-logs/kyty-valloc-20261023-155803.etl` (201,326,592 bytes / 192 MiB). `xperf -a tracestats` reports start 2026-10-23 **15:58:04.394** and end **16:05:23.229** local, **0 lost events** and **0 lost buffers**. The collection ran longer than the script's 150 s default according to ETL metadata; don't infer cause without seeing script output.

Correct process: **`kyty_emulator.exe(15312)`**; contemporaneous gameplay log `_Build/run-logs/20261023-155806-023.out.log`. This is distinct from the Electron launcher and other background processes. No game or ETW capture was started by the assistant.

Analysis using built-in Windows Performance Toolkit:

```powershell
$x = "C:\Program Files (x86)\Windows Kits\10\Windows Performance Toolkit\xperf.exe"
$env:_NT_SYMBOL_PATH="C:\Windows\System32;C:\Windows\SysWOW64;C:\Users\hoang\Desktop\dev\KytyPS5\_Build\windows-ram-offload"
& $x -i _Build\run-logs\kyty-valloc-20261023-155803.etl -a tracestats
& $x -i _Build\run-logs\kyty-valloc-20261023-155803.etl -a virtualalloc -totals
& $x -i _Build\run-logs\kyty-valloc-20261023-155803.etl -symbols -a virtualalloc -pid 15312 -images soc -top 32
& $x -i _Build\run-logs\kyty-valloc-20261023-155803.etl -symbols -a virtualalloc -pid 15312 -stacks soc -top 24
```

These commands **only read the existing ETL**. `soc` sorts by outstanding commit. Driver module frames with `!?` have no private debugging symbols, but the module names and Windows kernel/VMA functions are visible.

## Process ETW memory accounting

`virtualalloc -pid 15312` totals:

- 25,108 commit operations; 13,702,080 KiB cumulatively committed
- 20,544 outstanding commit operations; **9,588,040 KiB (9,363.32 MiB)** outstanding at capture end
- Outgoing virtual memory reserves, including very large address reservations, are *not* physical RAM
- Windows ETW commit measurements are **not** proof of physical memory resident; not directly interchangeable with process working set, VMA device-local VRAM usage, or guest sparse mapped pages

Outstanding commit classified by **topmost stack frame / module**:

| Symbol origin | Outstanding commit KiB | Approx MiB |
|---|---:|---:|
| `dxgmms2.sys!VIDMM_RECYCLE_RANGE::Commit` | **6,848,896** | **6,688.38** |
| `ucrtbase.dll!_malloc_base` | 1,380,152 | 1,347.80 |
| `KernelBase.dll!VirtualAlloc` | 891,304 | 870.41 |
| `nvapi64_impl.dll!?` | 126,708 | 123.74 |
| Others (including CUDA / compiler / injection runtime) | smaller | varies |

The GPU memory manager accounts for roughly **71.4%** of all ETW outstanding commit for this Kyty session.

Key deepest resolved stacks from `-stacks soc`:

- `dxgmms2.sys!VIDMM_RECYCLE_RANGE::Commit → VIDMM_GLOBAL::CommitLocalBackingStore → ... → dxgkrnl.sys!DxgkCreateAllocation → win32u.dll!ZwGdiDdDDICreateAllocation → DXCore.dll → nvoglv64.dll → kyty_emulator.exe!VmaAllocator_T::CreateBuffer → Libs::Graphics::BufferCache::BufferCache` (aggregated outstanding commit roughly 5,643,348 KiB for the top stack).
- Another GPU path proceeds through `VmaAllocator_T::CreateBuffer → GraphicContext::CreateImage → Image::Image → TextureCache::FindImage → RenderExecutor::ResolveTexture` (917,504 KiB outstanding for one stack; another 525,824 KiB through the same general image-creation chain).

**Interpretation:** The huge group of GPU memory-manager commits has an actual Vulkan/VMA resource origin. It is a strong match for the direction suggested by the 116 ~32 MiB + 84 ~16 MiB Windows `MEM_PRIVATE` allocation-base cohorts, but the ETW summary does **not** directly join individual 16/32 MiB allocation addresses to their original stack; that exact association remains unproven.

Do **not** claim the 6.5 GiB GPU-manager commitment is 6.5 GiB *physically resident system RAM*. WDDM GPU local backing can be accounted differently from RAM and VRAM resident budgets; Windows counters require their own distinction. Do **not** attempt to release `dxgmms2` or driver-owned memory using `VirtualFree`.

## Source audit and next safe optimization gate

Existing Kyty code already:
- Performs stale image retirement every flip through `TextureCache::RetireStaleImages` with a policy influenced by available **system RAM**. Only registered, non-depth/non-GPU-modified images can be deleted without downloading GPU-only bytes. (User already saw how overly eager cache recycling can worsen frame times.)
- Performs the main texture garbage collection above a **GPU video-memory budget**, which in the measured run was **~5.5 GiB used out of 10.9 GiB reported**. Thus the budget-triggered collector is not activated by the host RAM reaching 2 GiB free.
- Retires stale buffers based on age and GPU-safe ownership, but its *critical* condition is tied to video-memory pressure, not host-memory pressure.
- Keeps a fixed 512-MiB staging upload ring and small 32/64-MiB rings. Reducing those immediately cannot explain all GPU-driver commitment.
- Already executes Stage 4 pipeline idle evictions; another arbitrary reduction would risk remakes and stutter.
- Keeps the Stage 5 Windows file-backed `DiscardVirtualMemory` offload **blocked** due to explicit invalidation of test bytes/error 1224.

**Next targeted investigation/engineering**: attribute the driver GPU commit by Vulkan resource category and *live vs cached* byte budget. A reversible, opt-in GPU resource residency policy must only retire eligible idle images/buffers and release Vulkan handles through their proper ownership path, never Windows APIs; must preserve guest byte correctness, GPU completion, and keep a grace period after reload to limit stutter. Verify host physical *available* memory and 1% low FPS versus unchanged v11 gameplay in the same route. It is possible that genuinely live GPU resources account for most commitment; if so, no safe multi-GB free exists solely through garbage collection.

**Current status:** root allocation *subsystem* largely identified; exact contribution to *physical host RAM* and reclaimable resource quantity not measured, and **no new claimed RAM saving**. The user explicitly deferred integration of the chenxiao BSOD fix; do not mix in during this memory investigation.

## Process safety and source state

This analysis used only existing ETL and logs. Did not run gameplay, create a trace, delete caches, overwrite executables or alter local dirty source (e.g. `staticPrecompile.inc`, `vma.cpp`, `local-platform.{h,cpp}`). This report itself is the only tracked artifact change of Stage 6E.
