# Occlusion Culling direction 2: Stage 2A safe admission probe

## Goal and result

User requested adding direction 2 after Distance Detail: implement actual PS5 occlusion culling to reduce drawing of occluded objects. **The present stage cannot honestly be called working occlusion culling.** The audited guest PM4 path is incomplete and writes synthetic visibility; substituting a Vulkan aggregate or zero without preserving PS5 event timing risks invisible walls, missing enemies, and crashes. Implemented a strictly opt-in **non-culling occlusion-query evidence probe** as a conservative precursor. Default behavior is unchanged.

## Source findings

- `CpOpEventWrite` (`src/graphics/guest_gpu/command_processor/pm4Handlers.cpp`) extracts destination memory only for event `0x39 PIXEL_PIPE_STAT_DUMP`. Actual query begin/end are counter **snapshots**; two events at base and base+8 populate each DB's begin and end fields.
- `CommandProcessor::TriggerEvent` (`src/graphics/guest_gpu/graphicsRun.cpp`) leaves control `0x38` and reset `0x3a` ignored; dump `0x39` immediately writes a monotonically changing synthetic 64-bit word (ready bit 63) to **16 separate DB pairs**, all apparently visible. This remains unchanged.
- PM4 depth `DB_COUNT_CONTROL` is otherwise unimplemented in `HwCtxSetDepthMetadataRegister` for both direct and indirect register paths.
- VK query pool support elsewhere is timestamp-only. Vulkan `VK_QUERY_TYPE_OCCLUSION` is an **aggregate samples-passed count**, not a portable per-DB counter histogram. Readiness, interleaved begin/end layout, reset epoch, GPU memory/writeback timing, per-DB allocation, query scope across rendering boundaries and guest consumers have not been proven.
- `0x15 ZPASS_DONE` requires separate classification; it is **not** silently treated as a working query. Unsupported event paths remain unchanged.
- AMD publicly documents event index 1 for pixel-pipe-stat control/dump, and separates `0x38`, `0x39`, `0x3a`. References: GPUOpen-Drivers PAL `gfx9CmdUtil.cpp` and `gfx9OcclusionQueryPool.cpp`; Vulkan spec, Queries chapter.

## Stage 2A implemented in isolated worktree

- `src/local/occlusion-query-audit.h`: bounded, allocation-free **per-parser-thread event census**, raw latest `DB_COUNT_CONTROL`, control/reset/dump counts, unknown control/dump index flag and last reset index; powers-of-two dump logging. It is NOT queue- or per-DB interval tracking and cannot establish begin/end pairs. An explicit closed `CanPublishHostVisibility() == false` policy sentinel records that admission is not yet granted.
- `src/graphics/guest_gpu/command_processor/pm4Handlers.cpp`: when opted in, record raw `DB_COUNT_CONTROL` register writes; retain original compatibility handling and normal render state.
- `src/graphics/guest_gpu/graphicsRun.cpp`: observe ignored `0x38/0x3a` before their original no-op branch, observe `0x39` before the exact existing guest synthetic writes. Log `OCCLUSION_AUDIT mode=observe_only guest=always_visible`, thread-aggregate control/reset/dump counts, register count/latest raw value, last event indexes, and the count of dumps with no previously observed control. **No claim of invalid sequences** from these counts; a reset does not automatically mark the control configuration unknown. Log `real_gpu_queries=0 culling_grants=0`. Disabled path has a one-time environment check; no new synchronization, GPU work, allocation or shader modification.
- `launcher-electron/logic.cjs`, `options.html`, `options.js`, `style.css`, `README.md`: Advanced-tab **Occlusion Query Audit** switch, OFF by default, ON clearly labeled `Log query events (no culling)`; independent of RAM Safety, RAM Diet, Distance Detail, graphics settings and presets. The launcher explicitly passes `-Set KYTY_OCCLUSION_AUDIT=0` on Off or `1` on On, overriding stale inherited values.
- `tools/local/occlusion-query-audit-policy-test.cpp`, `launcher-electron/tests/occlusion-audit.test.cjs`: compile-only and test-fixture guards for event sequencing, output safety, fixed closed publication gate, new launcher flag and preserved old synthetic writes.

## Why actual GPU occlusion is NOT yet enabled

There is no safe mapping from Vulkan aggregate visibility to 16 per-DB PS5 begin/end counters. A query result cannot be published before the GPU has finished, and asynchronous host callbacks may be too late for guest GPU consumers. Improperly returning zero can cause entire objects to disappear. A naive synchronous `getQueryPoolResults(WAIT)` per dump could add huge stalls and worsen FPS. Treating `0x38` as begin and `0x39` as end would also be semantically wrong (they control and snapshot counters).

The guest game still receives exactly the old synthetic counters, all draws continue to execute, and the option alone has **zero FPS benefit**. Occlusion Culling is therefore **NOT ACCEPTED / NOT ENABLED**. This deliberate behavior is required for visual safety.

## Next admission gates to achieve real culling

1. With a supervised short session on a stable machine, collect bounded `OCCLUSION_AUDIT` **event census** logs for PM4 counter activity and register patterns; no automated gameplay, shader precompile or cache deletion. Add address/base+8 and reset/destination reuse probes in a later gate if log supports them, minimizing sensitive guest data logging.
2. Implement a **shadow-only** Vulkan query path that spans the same draw intervals as PS5 counter snapshots, across renderpass and submission boundaries, without writing any result to guest memory. Compare its sample counts to guest predication and software consumers in a controlled deterministic scene.
3. Prove completion ordering, overflow, precise/aggregate sample conversion, DB layout, unsupported modes and `0x15` legacy handling. Fail open for unknown cases (keep visible). Only allow real guest zero results after a matched-frame visual check and additional unit/runtime evidence.
4. Benchmark actual frame-time/1% low and GPU load in matched scenes. Revert fast using a feature flag if any geometry disappears or stalls grow.

### Limitations explicitly identified in independent review

The current probe does not capture control payloads, dump destinations and their base/+8 pairing, register epochs per guest command queue or frame-to-frame consumer ordering. Thread-local counts aggregate processors sharing one thread. Existing unrelated verbose debug `LOGF` lines may still be unbounded if graphics debug dump is separately enabled. Do not use these aggregate numbers to enable guest zero results. Event `0x15 ZPASS_DONE` remains unsupported; it is not secretly enabled.

## First user runtime evidence — 2026-10-24 09:03–09:07

Read-only inspection of actual `_Build/run-logs/20261024-090315-546.out.log` (~401 KiB; `.err.log` empty) found **zero** `OCCLUSION_AUDIT` lines and **zero** always-visible `0x39` warnings. Startup and gameplay draws occurred, and the process exited with routine pipeline/shader summaries. Review of other existing `.out.log` files did not find a previous `0x39` warning either. This is insufficient to establish that the game uses this query pathway in the observed area, or that the audit mode was enabled during the 09:03 launch: the saved `launcher-settings.json` with `occlusion_audit=true` had file modification time 09:07:39, **later than** the final log write at 09:07:32. No assertion of a functioning host occlusion-query path or FPS gain is warranted.

**Diagnostic correction after this evidence:** `GuestGpu` now prints `OCCLUSION_AUDIT active=1 mode=observe_only real_gpu_queries=0 culling_grants=0` at native startup whenever the opt-in flag is actually active, even when no dump events occur. A future log will distinguish missing initialization from missing game events without further guessing. This is display-only logging and changes no guest memory, shader or draw behavior.

## Completed verification

- **Native incremental Windows C++ build PASS**, `kyty_emulator.exe` linked successfully into existing `_Build/latest/native-build/` after the audit-index and default-Off corrections. Existing unrelated `-Wreturn-type` warnings remain.
- **Launcher Electron package PASS**, updated executable and `resources/app.asar` in existing `_Build/latest/launcher/DemonsSoulsLauncher-win32-x64/` only. No parallel build variants.
- **Launcher/cache test suite 63 total: 57 PASS, 0 FAIL, 6 SKIP**. The six skipped tests need a real game/emulator within integration worktree, which was intentionally not launched.
- **C++ compile-only occlusion policy test PASS** (some toolchain warnings about `std::getenv` deprecation), checks event census/reset index, bounded report sample and `CanPublishHostVisibility()==false`.
- **`git diff --check` PASS**. Neither game nor shader precompile/stress ran, so actual runtime sequence, FPS, 1% low and zero visual regressions **NOT validated**.
- Independent read-only review detected two issues, both addressed: explicit launch-time OFF (`KYTY_OCCLUSION_AUDIT=0`) and no inferred index=1 for event `0x3a`. The evidence is called a **census, not a fully reconstructed sequence**.

## Safety/worktree

Keep main checkout dirty files, `launcher-settings.json`, saves, game assets, shader hints/seeds and 5.95-GiB shader cache untouched. No culling of game objects, GPU query pools, depth state hacks, descriptor layout or Vulkan synchronization changes in this stage. Do not start Demon's Souls / shader precompile without user choosing to test after previous Windows MEMORY_MANAGEMENT BSOD. Build only existing `_Build/latest` (no variants).
