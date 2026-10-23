# Stage 5 — Texture Residency / Discard Gate (2026-10-23, safety correction)

## Evidence and outcome

Stage 4 v11 lowered synchronous pipeline remakes from v10's 1,431 to 507, but the 24 GiB Windows system continued to approach 100% physical RAM utilization. Recent gameplay had >13 GiB Kyty working set, guest RAM backing size 13,824 MiB, GPU VRAM around 6.3 GiB of ~10.9 GiB available budget.

The codebase includes GPU-verified sampled-texture offload, disabled by default above 20 GiB RAM. It can in principle reclaim duplicate texture pages, but **do not enable its destructive path with RAM16 file backing**.

### Critical Windows isolated smoke result

The standalone `tools/local/memory-pressure-mapped-discard-smoke.cpp` created a sparse 64 KiB file-backed mapping on the user's Windows host and tested DiscardVirtualMemory:
- File-backed map: `STAGE5_FILE_MAPPING_DISCARD_STATUS=1224` (error), bytes read `00,00` after a prior pattern was written.
- Private VirtualAlloc mapping: `STAGE5_PRIVATE_ALLOCATION_DISCARD_STATUS=0` (success).

A failure code together with zeroed data is **not a safe or supported discard-and-recover guarantee**. It may be influenced by the specific mapping, filesystem, and platform; it is nevertheless sufficient to **FAIL the safety gate**. Microsoft's DiscardVirtualMemory docs state memory contents become undefined upon successful discard and that a failed operation is not supposed to alter the contents; this empirical mismatch makes the operation unsuitable for live guest memory pending deeper analysis. This test is isolated and did not touch game data.

The existing `TextureOffload::OnFault` implementation also explicitly records `MISSED` accesses returning zeros to threads which cannot wait for GPU restoration and `LOST` events when a source image cannot be downloaded. Thus we do not claim its destruction/restore path is lossless.

## v12 safety-corrected diagnostic candidate

Native: `_Build/windows-ram-offload/kyty_emulator.exe`.
Launcher: `_Build/demons-souls-launcher-v12/DemonsSoulsLauncher-win32-x64/DemonsSoulsLauncher.exe`.

The Advanced UI now offers **Texture Residency Probe** rather than destructive offload. Default **Off**. When explicitly enabled with RAM Safety and RAM16, launcher sends:
- `KYTY_TEXTURE_OFFLOAD=0`
- `KYTY_TEXTURE_OFFLOAD_PROBE=1`
- `KYTY_TEXTURE_OFFLOAD_ADAPTIVE=1`

Probe only marks candidate clean sampled-texture pages and counts subsequent accesses; it does not discard data or save physical RAM. It begins scans below about one third of physical RAM available (about 8 GiB on a 24 GiB machine), pauses new probes after recovery beyond ~10 GiB. Existing instrumented pages get normal read-watch cleanup. The mode may cause additional page faults and render stalls, so do not enable for normal gameplay.

Additionally the Win32 `TextureOffload::GetMode` now blocks **destructive offload whenever `KYTY_BACKING_FILE` is active**. Explicit direct `KYTY_TEXTURE_OFFLOAD=1` no longer bypasses this protection in a file-backed launch. If `KYTY_TEXTURE_OFFLOAD_PROBE=1` is also present, it is downgraded to non-discarding Probe; otherwise mode Off. The existing <20 GiB default is similarly blocked for file-backed launch.

The existing Stutter Guard, Adaptive RAM Stage 1-4, guest file writeback, DLSS and FG are not changed. v11 native binary/launcher and existing configuration, saved data, shader caches, Steam setup and `launcher.cmd` remain intact.

## Verification gates

1. Isolated mapping discard smoke: demonstrates the failure (status 1224) and blocks destructive path.
2. `memory-pressure-policy-test.cpp`: validates 8 GiB entry/10 GiB release and no transition with unknown RAM.
3. Native Windows build and 49/49-ish launcher tests, packaged UI smoke and DryRun: final validation.
4. No gameplay launched; **no proven physical RAM savings**. Probe is diagnostic only.
5. Next engineering requirement for a true leap: implement a lossless page residency/writeback mechanism compatible with aliased file-backed sections; address nonwaiting GPU-restore reads and source-image lifetime, and validate data coherency under concurrent CPU/GPU accesses before enabling destructive offload.

Recommendation: continue using v11 for play. v12 is a protected instrumentation candidate to research duplicate texture residency, **not** a faster/leaner release.
