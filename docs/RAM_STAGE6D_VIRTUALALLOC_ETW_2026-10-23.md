# Stage 6D — Opt-in Windows ETW allocation-origin capture (2026-10-23)

**Status:** Prepared, PowerShell syntax PASS and `-WhatIf` dry-run PASS. **No ETW trace or game session has been started by the assistant.**

## Why

Stage 6C proved the existing 5.7 GiB static binary file is *not* being held through the persistent `PipelineBinaries::m_shared` Vulkan handle cache (zero binaries meet the 16-users threshold).

Census v3 identified roughly 3,712.55 MiB committed in 116 ~32-MiB `MEM_PRIVATE` allocation groups, plus 1,328.76 MiB in 84 ~16-MiB groups. Those were nearly stable across the 12-sample gameplay window even as guest mapped memory and Windows physical available memory varied. This does **not** establish where they were allocated or how many pages are resident.

The Windows host has Windows Performance Toolkit `xperf.exe`, `wpa.exe` and `wpaexporter.exe` installed (verified). Windows is build 26300, NVIDIA driver 617.42 on RTX 5070. A contemporary external NVIDIA developer forum report on an entirely different RTX 5090 compute workload also describes **112 x 32 MiB GPU-local** allocations from a driver thread with driver 617.42. The similarity motivates stack attribution but does *not* mean Kyty's 32-MiB host-private allocations come from that mechanism.

Microsoft documents `xperf -on PROC_THREAD+LOADER+VIRT_ALLOC -stackwalk VirtualAlloc+VirtualFree ...` and WPA's `Memory > VirtualAlloc Commit LifeTimes` for identifying allocation stacks.

## Opt-in trace

Script: `tools/local/record-kyty-valloc.ps1`

In **Administrator PowerShell** from the KytyPS5 repository root, while Kyty is **not yet running**:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\local\record-kyty-valloc.ps1 -Seconds 150
```

After the script prints `STAGE6D_CAPTURE_START`, immediately open the **known-good Launcher v11** (RAM Safety Mode ON) or Launcher v12 with **Texture Residency Probe OFF**, and enter the game. The script automatically stops capturing and writes the capped ETL under `_Build/run-logs/kyty-valloc-YYYYMMDD-HHMMSS.etl`. Starting the trace before gameplay matters because the allocations likely happen during early shader/pipeline creation, not only at the end of the session.

**Tests without capture:**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\local\record-kyty-valloc.ps1 -WhatIf
```

- Uses kernel ETW VirtualAlloc/VirtualFree stack sampling, no heap hooks, no registry changes, no emulator modifications.
- Defaults to **150 seconds** (user configurable 30–240 seconds).
- Circular trace **256 MiB max** and 16–64 x 1024-KiB buffers; oldest events may roll over if the file fills. If critical startup stacks were lost, repeat only with an adjusted limited capture.
- Requires administrator privilege for ETW. Refuses to start if RAM currently available is below 4 GiB, output drive has less than 2 GiB free, target output exists, output directory is missing, xperf unavailable, or the NT Kernel Logger is already running.
- The PowerShell `try/finally` closes and exports the trace if startup succeeded, including normal interruption. This does not guarantee cleanup against forcible termination or a Windows crash.
- ETL contains **system-wide process/module/path and potentially sensitive stack information**; keep the file on the PC. Do not upload it to public services unreviewed.
- Extra capture overhead and trace size can affect game smoothness. For ordinary gameplay, do not run ETW.

In Windows Performance Analyzer (`wpa.exe`), open the new ETL; select **Memory > VirtualAlloc Commit LifeTimes**, filter by `kyty_emulator.exe`, group by allocation size around 16 and 32 MiB, then examine **Commit Stack** and module names. Attribute to user-mode driver (`nvoglv64.dll`/NVIDIA) vs emulator (`kyty_emulator.exe`) vs another dependency; symbols may be missing from proprietary NVIDIA drivers but module name should still be available. The effect of driver-internal GPU-local allocations on host committed RAM still needs independent validation.

A trace captured after the allocations already occurred cannot recover their original stacks. Do not guess or free driver-owned host memory with Windows APIs.

## Acceptance gate before RAM optimization

1. Confirm 16/32-MiB allocator ownership from stack evidence, **not allocation size**.
2. Develop a low-stutter, opt-in fix only for the verified owner (driver pipelines vs emulator caches/arenas).
3. Build + unit smoke; do not run game unattended.
4. User plays matched scene and compares Windows available physical RAM, 1%-low FPS, stutter and driver private allocations against v11.
5. Reject any candidate that returns zeros in guest memory, corrupts textures, increases significant stutter, or assumes that `VirtualQueryEx` committed virtual memory equals physical resident RAM.

The chenxiao BSOD fix remains deferred per user preference. Stage 5 unsafe mapped discard remains blocked.
