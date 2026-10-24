# Demon’s Souls PC — Stage 2B: graphics submission census (2026-10-24)

## Reason for this direction

The 09:11–09:13 gameplay log (`_Build/run-logs/20261024-091110-700.out.log`) has `OCCLUSION_AUDIT active=1` but no `0x39 PIXEL_PIPE_STAT_DUMP` or a subsequent `OCCLUSION_AUDIT mode=...` line. Therefore we have no measured game-specific GPU visibility-result consumer that would allow safe translation to Vulkan occlusion queries. Do not implement speculative zero-visible results, draw suppression, unverified depth culling or graphics-pipeline skips.

Existing source (`src/loader/gameArgs.cpp`) sets `doIndexBufferCulling=false` in the game. Its comment reports an existing test at Boletaria 1-1: disabling the guest's per-object index-buffer triangle culling avoided roughly 2,800 compute dispatches/frame and improved 34.30 to 36.48 fps. This is a historic benchmark in a different context, NOT a new verified result on the current RTX 5070 session and NOT proof that all culling is counterproductive. Reenabling it is intentionally not performed.

The recent log's `SLOW Frame` reports include ~6,000 `table_draws` in some frames and prolonged shader/pipeline preparation (`compile=` dominates some long frames, up to multiple seconds). Those are **table-path draws** and compiler stalls, not counts of hidden objects; suppressing them by camera-distance heuristics could corrupt scene output or shader-visible side effects. In particular, `renderDraw.cpp` already declines zero-sized draws, while depth-only, blend and shader-write draws cannot generally be discarded just because a viewport appears empty.

## Stage 2B changes

All changes live exclusively in isolated DevSpace integration worktree, with `_Build/latest` build artifacts only. They extend the existing launcher Advanced-tab **Occlusion Query Audit**, preserving default `Off`, `KYTY_OCCLUSION_AUDIT=0` suppression of a stale inherited setting, and leaving the user's current saved preferences unchanged.

- `src/local/draw-submission-census.h`: constexpr, allocation-free CPU counters for **original encountered guest graphics-queue PM4 packets**, classified by direct indexed/auto (`0x27/0x2D/0x35`), indirect (`0x24/0x25`), multi (`0x2C/0x38`), `DISPATCH_DRAW_PREAMBLE` (`0x3A`, separate field), dispatch (`0x15/0x16`), predicate-skipped draw/dispatch and extra contiguous indirect packets consumed by native fast paths. Does not touch actual Vulkan commands or predicate state.
- `src/graphics/guest_gpu/command_processor/commandProcessor.h`: per-graphics-processor counters persist through `Reset()`, because Reset is a register/packet-state reset and does not imply a presentation-frame boundary.
- `src/graphics/guest_gpu/graphicsRun.cpp`: observe packet opcode and existing skip Boolean just ahead of predicate rejection and native accelerators. Successful grouped indirect fast paths account for additional consumed guest PM4 packets (`consumed / 5 - 1`). Delimit a **submission-frame window** at `SubmissionType::FrameBoundary` inside the guest GPU parser thread; do not consume potentially racing state from `PrepareCpuFlip` on the CPU presentation thread. Sample the first, 2nd, 4th, 8th, ..., 128th boundary, then every 120 boundaries, printing one `DRAW_SUBMISSION_CENSUS` line per sampled interval (not per packet).
- `launcher-electron/options.html`, `launcher-electron/README.md`: visible UI and documentation call out **Log events + draw counts (no culling)**, with no new setting or non-default side effect.
- `tools/local/draw-submission-census-policy-test.cpp`: compile-only `static_assert` classification, predication, grouped-indirect accounting, frame-window counts, and bounded cadence.
- `launcher-electron/tests/draw-submission-census.test.cjs`: source-linked regression guards and unchanged audit/engine fallback semantics.

### New native log fields

`DRAW_SUBMISSION_CENSUS mode=observe_only queue=graphics frame_boundary=N window_frames=M draw_packets=D direct=... indirect=... multi=... preamble=... dispatch_packets=... predicated_skip_draw=... predicated_skip_dispatch=... grouped_indirect_extra=... gpu_occlusion_grants=0`

The values are **counts of PM4 packets encountered on graphics queue 0 within M consecutive submitted frame epochs**, NOT distinct visible scene objects, actual Vulkan draws, fragment samples or hidden-mesh candidates. Some draw packets execute zero indexed/vertex work. One multi packet can request many draws. `COND_EXEC` can skip a *region* without visiting its packet headers; the scan does not peek into skipped guest memory to derive hypothetical draws. Compute jobs on asynchronous guest GPU queues are not included. Frame boundaries of submitted guest work do not equal exact presentation times. **Frame-pipeline limitation:** with `KYTY_FRAME_PIPELINE=0`, the code can bypass `SubmissionType::FrameBoundary`, so the counters collect but no `DRAW_SUBMISSION_CENSUS` summary is emitted; the current default is frame pipeline enabled. Do not treat absent logs in this nondefault mode as zero draw traffic.

### Important gates STILL closed

- No 3D frustum/occlusion culling added; no geometry skips, no culling grants, no guest counter writeback modifications.
- No Vulkan occlusion query pool, depth hierarchy (Hi-Z), stencil or shader translation change. `OcclusionQueryAudit::CanPublishHostVisibility()` stays false.
- No changes to `doIndexBufferCulling=false`, Distance Detail convars or texture/render settings.
- No shader cache deletion/rebuild, no guest save touch, no automatic game execution after previous BSOD.
- The higher-level research gate is to compare **guest packet counts** against existing `table_draws`, shader compile time, CPU/GPU frame time and busy/idle counters in a controlled scene, then decide whether optimizing game traversal, draw preparation or shaders has any verifiable value. More culling is NOT presumed correct or faster.

## Verification

- `clang-cl /std:c++20 /Zs /Isrc /I<existing-native-build-dir> tools/local/draw-submission-census-policy-test.cpp` passed.
- `node --test launcher-electron/tests/draw-submission-census.test.cjs` passed (3/3).
- Independent read-only adversarial review completed with **no blocking findings** for the default asynchronous frame-pipeline path. It verified direct/indirect/MULTI classification, predicated skips, grouped runs, PM4 suspension requeues, and parser-thread ownership; it identified the `KYTY_FRAME_PIPELINE=0` reporting limitation above.
- `cmake --build _Build/latest/native-build --target kyty_emulator --parallel 2` passed; native EXE linked, warnings from preexisting third-party/source code only.
- Full Electron/launcher Node suite: **66 total, 60 PASS, 0 FAIL, 6 SKIP**. The skips rely on real game/emulator integration and were not forced.
- Electron launcher package: **PASS**, at `C:\\Users\\hoang\\Desktop\\dev\\KytyPS5\\_Build\\latest\\launcher\\DemonsSoulsLauncher-win32-x64\\DemonsSoulsLauncher.exe`. Packaged ASAR verified to contain `Log events + draw counts`.
- Native EXE: `C:\\Users\\hoang\\Desktop\\dev\\KytyPS5\\_Build\\latest\\native-build\\kyty_emulator.exe` successfully linked. No game or shader precompile run for Stage 2B. `git diff --check` PASS.
- Existing saved settings (`distance_detail=aggressive`, `ram_safety=true`, `occlusion_audit=true`) remained as the user set them. No main checkout source modifications and no changes to `run-windows.ps1` or precompile scripts in integration worktree.
