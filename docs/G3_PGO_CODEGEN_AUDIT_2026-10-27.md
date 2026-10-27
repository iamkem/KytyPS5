# G3 — Bounded PGO repair gate (2026-10-27)

**Status: confirmed 18 stale profile hashes in the hot renderer TUs (12 reported by Clang as hash mismatches, 6 resolved as unknown functions), including TableEvaluate and TableBlocks; no performance patch or user-game FPS uplift yet.**

## Why this check

Native 60 FPS at Boletaria 1-1 on the user's Ryzen 5600 + RTX 5070 requires reducing the current measured mean frame interval from ~20.15ms (49.635 FPS) to 16.67ms, or ~3.48ms/frame. Source already has native Release -O3, -march=native, ThinLTO, and profile-guided optimization from `tools/pgo/kyty.profdata`. Simple enablement of PGO is not a fix. The profile was last committed in `5a081b9d` (2026-10-21); later modifications include diagnostics and guarded experiments in the hot render translation units.

## Reproducible read-only compiler result

New diagnostic `tools/local/windows/pgo-check-hot.py` reuses exact **emulator target** compile arguments extracted through the canonical `_Build/latest/native-build` Ninja build database, enables Clang `-Wprofile-instr-out-of-date`, and performs real frontend LLVM-IR code generation with IR written to **stdout then discarded**. It removes object / PDB / depfile outputs, does not invoke Ninja build targets, and does not touch build artifacts, shaders, saves, game, launcher, or .profdata.

Run from repo root:

```powershell
python -B tools/local/windows/pgo-check-hot.py
# Optional: return exit 1 (instead of 0) for stale profiles
python -B tools/local/windows/pgo-check-hot.py --strict
```

**Checked and PASS as a diagnostic (all Clang invocations returned exit 0):**

| Source | Clang mismatched function records | Total functions reported |
|---|---:|---:|
| `src/graphics/host_gpu/renderer/renderDraw.cpp` (includes `src/local/table-xpr.inc`) | **1** | 1,526 |
| `src/graphics/host_gpu/renderer/cache/bufferCache.cpp` | **4** | 1,315 |
| `src/graphics/guest_gpu/graphicsRun.cpp` | **7** | 1,067 |
| **Total** | **12** | 3,908 |

Clang reports mismatched function counter data **will be ignored**. A prior syntax-only audit passed because syntax-only compilation cannot compare codegen profile hash. The 12 warning counts are **not** the full stale-hash count: comparing current instrumented IR's named hashes against `llvm-profdata show --all-functions --counts` revealed **18 different function hashes**. LLVM 19 classifies the other six as `unknown_function` when hash bit 60 differs, rather than `hash_mismatch`, so they do not appear in the summary warnings. All LLVM IR and old profile records were processed in memory, no extra files emitted.

**Precisely identified affected functions (old PGO recorded entry count, not runtime cost):**

| Source | Function | Historical profile entries |
|---|---|---:|
| renderDraw | `NativeXprReader::Read` | **2,708,716,749** |
| renderDraw | `TableEvaluate::lambda_62` | **2,700,870,950** |
| renderDraw | `RenderExecutor::TableEvaluate` | **149,510,591** |
| renderDraw | `RenderExecutor::TableBlocks` | **148,715,697** |
| renderDraw | `TableEvaluate::lambda_61` | 0 |
| renderDraw | `RenderExecutor::TableRuns` | 6,758 |
| bufferCache | `BufferCache::UploadDirtyRanges` | 17,308,471 |
| bufferCache | `BufferCache::ObtainBufferForImage` | 15,801 |
| bufferCache | `BufferCache::CopyGuestMemory` | 9,966,386 |
| bufferCache | `BufferCache::Defragment` | 36,353 |
| graphicsRun | `CommandProcessor::TryNativeXprDraws` | **56,954,833** |
| graphicsRun | `CommandProcessor::TryNativeMultiDraw` | 358,323 |
| graphicsRun | `CommandProcessor::TryNativeAutoDraw` | 4,663,356 |
| graphicsRun | `CommandProcessor::TryNativeDirectDraw` | **52,920,442** |
| graphicsRun | `CommandProcessor::DrawIndex` | 960,030 |
| graphicsRun | `CommandProcessor::DrawIndexAuto` | 1,626,087 |
| graphicsRun | `LiveControl::Run` | 4 |
| other | `AsyncUpload::Worker::Run` | 4 |

**Conclusion: PGO refresh is ADMITTED as one bounded optimization attempt** because named hot work functions definitely lost PGO coverage, not merely because of timestamps. That does not prove any exact avoidable milliseconds; **no FPS increase can yet be claimed**. The existing read-only diagnostic script checks Clang's 12 reported mismatches but does not reproduce the 6 additional hash-bit unknown-function differences by itself.

## Implementation admission gate (finite)

1. **Hot-name identification COMPLETE:** an independent read-only DevSpace codegen audit recovered 18 altered named hashes, including repeat-used `NativeXprReader::Read`, `TableEvaluate`, `TableBlocks`, and native draw dispatch. No more hash profiling needed.
2. **NEXT: one controlled PGO refresh,** preserving the previously working binary. Existing `tools/local/windows/pgo-train.ps1` is **NOT usable unmodified** for this user's workflow: it builds into `_Build/windows-pgogen`, makes `_Build/ab/pgogen` copy and automatically launches/kills game. Current user constraints require canonical `_Build/latest/native-build` only and **user-initiated Launcher Play**, with no assistant-initiated game boot, process kill, full shader precompile, or unnecessary baseline. A compatible workflow must be designed before activating training; do not quietly run this existing trainer.
3. Only after a correctly collected representative game profile, create **one** optimized native build in `_Build/latest/native-build` using it and **one** user-initiated On-only acceptance session. Check native FPS mean, 1%-low/p99, image/geometry correctness, GPU timeline faults/device loss and retained gameplay progress.
4. If hot mismatch is absent or correcting it fails a meaningful improvement gate, **NO-GO**; stop rather than repeatedly training, guessing at Vulkan barriers, making default-on unvalidated cache shortcuts, or spawning generic profiling phases.

Other read-only reviews found **no** admitted source-level renderer macro patch: both read-only resource cache reuse (~94%) and current TableEval packing leave no demonstrably removable >=3.48ms serial work. A PGO patch is a plausible incremental improvement, **not** an evidence-backed 60 FPS guarantee.

**Git state prior to this report:** branch `integration/chenxiao-v20261023b-20261023`, HEAD `784eaa8b`. Existing user's untracked personal files must stay untouched.
