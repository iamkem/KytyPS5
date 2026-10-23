# Chenxiao07 v20261023b — isolated PAGE_GUARD BSOD mitigation (2026-10-23)

## Scope / why this update

User explicitly authorized checking chenxiao07 upstream and updating Kyty after earlier deferral. Upstream release **v20261023b**, published 2026-10-23, includes a new mitigation for Windows MEMORY_MANAGEMENT bug check **0x1A / subcode 0x41202**, which also occurred on this Windows host.

Upstream source commits, reviewed on 2026-10-23:
- https://github.com/chenxiao07/KytyPS5/commit/f53b4497a1ee4a5c9dd3c107739e9e5b65d9e9d9 — Windows guard-page read-protection fault handling
- https://github.com/chenxiao07/KytyPS5/commit/91a15d6c99b6d5d134ad70ecb0679bf030cbc83a — enables the mitigation by default
- https://github.com/chenxiao07/KytyPS5/releases/tag/v20261023b

Upstream reports its no-access repro BSOD'd in 15, 529, 656 seconds, while guard-based tests completed 1,800 seconds; 2 x 22-minute emulator runs succeeded under extreme RAM pressure. This is **upstream's test evidence**, not validation on this user's 24 GiB / RTX 5070 host. The upstream issue #50 was still open when checked. Neither the release announcement nor this local patch guarantees the OS can never BSOD.

A fetch from the official upstream fetched the exact commit history (HEAD da791c84), although fetching one nested LibAtrac9 submodule failed on the remote; this did **not** prevent reading the commits. The user's branch remains based on their own KytyPS5 fork and is **not globally merged** with upstream.

## Isolated implementation

The integration manually ports the *core logic* of the above two commits, not the full upstream repo. It preserves local Stutter Guard and GPU/guest backing changes and does not overwrite existing v11/v12/v13 builds.

Updated source:
- `src/common/hostException.cpp/.h`: recognize mapped guest PAGE_GUARD violations, re-arm the page safely, dispatch to existing access-violation/texture/GPU handlers, settle protection after successful handling.
- `src/kernel/memory.cpp/.h`: Windows `kyty_local_read_guard` enabled by default in the new native, `KYTY_READ_GUARD=0` disables; registers exception callbacks and restores guest read/write/execute protection under the mapping's existing checks.
- `src/kernel/memoryAddressSpace.inc`: maps file-backed guest NOACCESS regions as PAGE_GUARD|PAGE_READONLY when enabled; applies same policy to subsequent protections, locks/busy-range synchronization for guard re-arm; **private-memory stacks remain unchanged**.
- `src/graphics/host_gpu/pageManager.cpp/.h` and `renderer/cache/gpuResourceManager.h`: reconcile watcher state once the fault is handled.
- `src/local/live-counters.h`: adds `read_guard_faults` and `read_guard_settles`.

The integration does **not** re-enable Windows file-backed DiscardVirtualMemory, touch GPU-only texture swap, increase pipeline eviction, or change guest mapping data. It does not lower physical RAM usage. The upstream feature was ported with localized adaptations to this fork; not a byte-for-byte cherry-pick and thus gameplay acceptance is still needed.

## Separate builds / toggle

Native build: `_Build/windows-chenxiao-guard/kyty_emulator.exe` (Release) — **BUILD/LINK PASS**.
Electron launcher v14: `_Build/demons-souls-launcher-v14/DemonsSoulsLauncher-win32-x64/DemonsSoulsLauncher.exe` — **PACKAGE PASS**, `--smoke-ui` exited 0.

In Launcher **Options > Advanced**:
- `RAM Safety Mode = On` to retain Stutter Guard and shader prefetch pressure control.
- `Extended Memory Mode (RAM16) = On` for existing sparse file backing.
- **`Chenxiao BSOD Guard (v14) = On`** to select isolated native executable and pass `KYTY_READ_GUARD=1`.
- `Stage 7 RAM Residency = Off` (NO-GO).
- `Texture Residency Probe = Off` (diagnostic only / may affect faults).
- `GPU Cache Budget = Auto`.

The new toggle defaults **Off** for this fork's launcher, to avoid surprising users whose saved config predates v14. The isolated native itself enables guard by default (matching upstream), unless `KYTY_READ_GUARD=0`.

**Disabling `Chenxiao BSOD Guard` in v14 restores the previous existing Stage5 native selection when RAM Safety is on**, not the v11 binary. For a pure v11 baseline use the separately preserved `_Build/demons-souls-launcher-v11` package.

## Verification

- Standalone Win11 **CMake Release** native C++ compile + link: **PASS** (some unrelated longstanding warnings).
- Electron Node.js tests **50/50 PASS**, including Stage7 incompatibility guards, `run-windows.ps1 -DryRun` selecting the exact new native, passing correct flags, and preserving baseline behavior when disabled.
- Electron packaged GUI `--smoke-ui`: completed exit 0 without opening game.
- `git diff --check` for integrated files: PASS.
- **Real gameplay, long-session memory pressure, BSOD prevention and frame-time validation: NOT RUN by assistant**, due to repeated prior physical Windows BSOD risk. A successful build does not prove the Windows driver/kernel can never crash.

No shader cache, game installation, save data, Steam shortcut, launcher-settings.json or previous binaries were deleted or overwritten. The native build necessarily used the current checkout including preexisting dirty `staticPrecompile.inc`, `vma.cpp`, `local-platform.cpp/.h` changes, but none of those user-owned source files are staged or included in this update commit.

## Gameplay guidance for the user

Test on one normal session; **do not intentionally stress RAM to reproduce the BSOD** and do not run a RAM hog simultaneously. Keep the game's usual shader caches, rendering and framegen settings. Look for native startup line:

`Memory: guest pages kept from reads by guard pages (KYTY_READ_GUARD)`

If any texture corruption, crash, new stalls, or regression occurs, return to the known-good v11 launcher and preserve the latest `_Build/run-logs` outputs. Avoid continuing the test when available physical RAM is under ~1 GiB.

Other upstream v20261023b updates — Bluetooth DualSense audio/haptics, CPU spin gate, large texture pool zero-tile uploads, FSR/DLSS behavior, audio stretch and precompile — were **reviewed but not bulk-merged into this BSOD candidate**. They can be assessed in separate controlled follow-ups once guard stability is known.
