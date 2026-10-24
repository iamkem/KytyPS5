# Demon's Souls Remake PC / KytyPS5 — Hướng 2, Stage 2D: Game-engine occlusion controls

Date: 2026-10-24. Stage 2D follows the user-confirmed Stage 2A/2B observations and explicitly **does not continue Stage 2C pipeline-CPU work**.

## Source-grounded discovery

Offline, read-only extraction of original user-owned `C:\Games\PS5\DMSR\PPSA01341-1.07\PPSA01341-app0\eboot.bin` (45,719,851 bytes; SHA-256 `fba2d6341abf74f032cde774df9bfee2f3afcf32402b20938add42d352914295`) found genuine native engine symbol/option strings (file byte offsets):

| Exact string | Offset in original `eboot.bin` | Interpretation **not yet proven** |
|---|---|---|
| `r_enableVirtualGeometryOcclusion` | `0x02450D9E` | Candidate engine virtual-geometry occlusion toggle |
| `r_enableLightOcclusionCulling` | `0x02463079` | Candidate engine *light* occlusion toggle; may not remove meshes |
| `r_EnableOptimizedFrustumCulling` | `0x024928F2` | Separate candidate optimization switch, NOT activated by Stage 2D |
| `doIndexBufferCulling` | `0x024B04BD` | Existing game XPR per-triangle culling, currently disabled by measured performance policy |
| `cullZeroIndexIndirectCalls` | `0x024CC3F6` | A different possible engine flag, NOT activated |
| `CRenderer::FrustumCullObjectsJob` | `0x023DFDF5` | A renderer job name, NOT a console variable |

**Critical limitations:** presence in eboot's string table does NOT establish command-line registration, the engine's default values, conditions for its activation, whether the option is read at startup, visual equivalence, GPU triangle reduction, performance gain or crash freedom. The game's own original `PackageCmdLineArgs.txt` has `+cp11_callHomeLockDownEnabled=false` and does not list either candidate. Options are experimental until actual image/FPS and guest packet census A/B.

## Implementation: controlled experimental engine-level culling (default Original)

Only in isolated integration source worktree `C:\Users\hoang\.devspace\worktrees\KytyPS5-93e7e50d`:

1. `src/loader/engineCulling.h` maps the exact user-selected mode to the literal game-console flags. `original` and unknown values map to an empty overlay. Build admission is **exact title `PPSA01341` and APP_VER `01.007.000`**, the only installed eboot inspected; all other games/releases are refused. This is a scope check, not proof of runtime engine semantics. `virtual` → `r_enableVirtualGeometryOcclusion=true`; `light` → `r_enableLightOcclusionCulling=true`; `combined` → both. No shader/SPIR-V/Vulkan draw mutations.
2. `src/loader/gameArgs.cpp` integrates the optional `KYTY_ENGINE_CULLING` flag into its existing supported-Demon's-Souls-only `PackageCmdLineArgs.txt` virtual-read hook, **after** generic `KYTY_GAME_CONVARS` and `KYTY_DISTANCE_DETAIL`, retaining normal per-name precedence. An explicit experimental selection on another build reports `ENGINE_CULLING unsupported_build` and leaves the flags unapplied. Note Original does **not** clear prior externally specified `KYTY_GAME_CONVARS`, which keep their own semantics. It never edits the installed game file. The `KYTY_GAME_CONVARS=0` escape hatch still disables all add-on game flags as historically designed.
3. `launcher-electron/logic.cjs` adds `engine_culling:'original'` default, rejects unknown selections, and explicitly sets `KYTY_ENGINE_CULLING=<enum>` on each run so inherited env cannot surreptitiously force an engine culling profile. All other existing graphics, memory, shader and cache settings persist unchanged.
4. `launcher-electron/options.html` + `options.js` expose **Options → Advanced → Engine Occlusion Culling** with four options: Original (default), Virtual geometry only, Light culling only, Virtual + light. Each experimental option includes a caveat about unverified render correctness and need for comparison; existing Occlusion Query Audit remains independent.
5. `tools/local/engine-culling-policy-test.cpp` `static_assert`s mapping and default semantics. `launcher-electron/tests/engine-culling.test.cjs` protects native path selection, isolation from settings, defaults, preset preservation and the fact that no emulator/Vulkan guest command path is bypassed.

## Stage gates

| Gate | Result |
|---|---|
| Original opt-out adds no *new* engine-culling console args | Static PASS |
| 1.07 strings match exact game `eboot.bin` | Read-only PASS |
| Only exact PPSA01341 APP_VER 01.007.000 admits experimental flags | Static PASS |
| C++ `clang-cl` compile-only policy test | PASS |
| Three new launcher integration tests | PASS |
| Full launcher unit suite | 72 tests: 66 PASS, 0 FAIL, 6 SKIP |
| Native `kyty_emulator.exe` incremental build | PASS |
| Electron standalone launcher packaging | PASS |
| GPU geometry or fragment reduction in actual play | **NOT VERIFIED** |
| Scene visual correctness and performance A/B | **NOT VERIFIED** |
| Native visibility/culling admission beyond game convars | **NOT ENABLED** |

## Controlled gameplay validation (requires user's own deliberate launch)

- **Test A (control):** Advanced → Engine Occlusion Culling **Original**, Occlusion Query Audit **Log events + draw counts**; start from a fixed safe position, rotate camera or stand for a few seconds, exit normally. Collect latest `*.out.log`/`*.err.log`.
- **Test B:** Advanced → Engine Occlusion Culling **Virtual geometry only**, keep everything else identical and game scene at same point. Exit normally; inspect log `Game args: ... +r_enableVirtualGeometryOcclusion=true`; compare `DRAW_SUBMISSION_CENSUS` direct/indirect packet and `SLOW Frame` statistics over corresponding 120-frame windows. Inspect real scene images (missing terrain/buildings/objects, reflection, shadow artifacts). **A command-line flag applied is not proof the game honors it.**
- Only if Virtual alone is stable/visually correct, test Light alone and eventually Combined in the same way; controls may already be enabled in the original game and yield **no speedup**. Results are not exact GPU draw counts; comparing graphics queue packet census is one directional signal only, with camera and game workload variation.
- Switch back to Original if any missing geometry, incorrect shadows/light, rendering faults, exceptions or unstable frame pacing occur. Keep shader cache, saved games, static-pipeline binaries and user memory settings untouched.
- **Do not run game automatically** or trigger shader precompile: machine previously suffered a `MEMORY_MANAGEMENT` BSOD and recent logs show physical RAM dropping under 1 GiB. The user decides if/when to test interactively.

## Four actual user-initiated A/B runs — 2026-10-24 09:50–09:58 (Stage 2D runtime evidence)

**Verified by reading the original logs in the user workspace** (`C:\Users\hoang\Desktop\dev\KytyPS5\_Build\run-logs`), with no assistant-initiated gameplay or shader precompile:

| Native `.out.log` | Game convar echo / selection | Audit | `stderr` |
|---|---|---|---|
| `20261024-095032-417.out.log` | Original (no experimental engine culling convar) | on | empty |
| `20261024-095223-561.out.log` | `+r_enableVirtualGeometryOcclusion=true` | on | empty |
| `20261024-095431-850.out.log` | `+r_enableLightOcclusionCulling=true` | on | empty |
| `20261024-095632-374.out.log` | Both candidate convars | on | empty |

Every log contains `OCCLUSION_AUDIT active=1 mode=observe_only real_gpu_queries=0 culling_grants=0`, valid `DRAW_SUBMISSION_CENSUS`, and zero synthetic 0x39 dump observations. The `Game args: ... read with` echo establishes native injection, NOT actual acceptance by the closed-source game's convar parser. No native occlusion GPU queries/grants.

**Matched steady high-complexity submission windows:** For all four sessions, take the same five `frame_boundary` endings `2768, 2888, 3008, 3128, 3248`, each representing 120 guest submission-frame boundaries. Divide total PM4 counts by 600. Using later converged windows avoids treating each game's asynchronous scene-loading time as a new culling gain. Numbers are *PM4 packets/frame, not Vulkan draws, culled objects, pixel work or GPU FPS*:

| Mode | Draw packets/frame | Direct | Indirect | Multi | Compute dispatch/frame | Draw difference vs Original |
|---|---:|---:|---:|---:|---:|---:|
| Original | 6,376.80 | 2,207.22 | 4,155.58 | 14 | 1,564.40 | reference |
| Virtual Geometry | 6,388.86 | 2,215.39 | 4,159.47 | 14 | 1,568.16 | +0.19% |
| Light Culling | 6,383.78 | 2,210.70 | 4,159.08 | 14 | 1,567.54 | +0.11% |
| Combined | 6,394.92 | 2,223.89 | 4,157.03 | 14 | 1,564.67 | +0.28% |

**Verdict for this capture:** No reduction in *encountered guest graphics draw/dispatch packets* was demonstrated for Virtual, Light, or Combined. The tiny signed changes are consistent with run-to-run/game-state variation. This does **not** demonstrate that all engine culling is disabled: an engine option may change *indirect index counts, per-draw geometry, light-processing samples, shader work or visibility internals* without changing PM4 packet counts, and it may already be enabled by game defaults. A/B differences in earlier frame windows are dominated by **different scene-load progress**: the high-load plateau begins at different frame boundaries (Original ~2408, Virtual ~2648, Light ~2528, Combined ~2768). Therefore naively averaging all 120-frame windows gives false apparent savings or regressions.

**Secondary diagnostics:** The biggest logged `SLOW Frame` durations were Original 1,997.2 ms, Virtual 2,719.8 ms, Light 1,757.9 ms and Combined 2,483.1 ms, with 32/28/25/26 `SLOW Frame` entries respectively. These are *threshold-filtered events, not measured mean frame time or FPS*. Session length and shader/scene compilation differ, so do not use these to rank modes. Lowest reported **system available RAM**: Original **746 MiB**; Virtual 1,907 MiB; Light 2,047 MiB; Combined 1,931 MiB. With prior MEMORY_MANAGEMENT BSOD, this remains a safety concern; avoid automatic repeated gameplay and additional shader-precompile experiments.

**Acceptance result:** Stage 2D configuration wiring/runtime-log gate **PASS**; Stage 2D *actual occlusion culling benefit* **NOT VERIFIED**, with **no PM4 draw-reduction signal** in the matched high-load windows. There is no sufficient evidence for a new FPS/performance gain. Recommended normal setting remains **Original** (no experimental changes); preserve previous Memory/RAM settings and caches. Further code work should prove whether these engine toggles influence true primitive/index counts or visibility, or use an independent conservative semantics-proof before host-side skipping. Do not expand generic Vulkan occlusion without verified guest visibility semantics.

## Related, deliberately not enabled

- Stage 2A's `0x39` occlusion event never occurred in two observed game sessions. It cannot safely feed Vulkan occlusion query results; `real_gpu_queries=0` and `culling_grants=0` remain.
- Stage 2B `DRAW_SUBMISSION_CENSUS` recorded ~6,400 guest draw PM4 packets/frame in heavy scenes; it is a measurement tool, not a culling mechanism.
- `doIndexBufferCulling=false` deliberately remains active, following the historical measured +6.4% standing-FPS improvement from *removing* ~2,800 per-object culling dispatches/frame. Re-enabling it is not proven beneficial.
- Stage 2C Ready Pipeline Reuse is a separate CPU optimization, defaults Off, and is unchanged.
- No new special-case host draw suppression is admitted without a fully proven shader side-effect/geometry predicate and visual tests.
