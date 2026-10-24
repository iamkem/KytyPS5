# Demon's Souls Remake PC / KytyPS5 — integrated-features vs compile-classified stutter, offline review

Date: 2026-10-24. Scope: **only static source inspection and previously captured user gameplay logs**. No game run, shader precompile, shader-cache purge, settings mutations, source-code changes, build, push, or main checkout edits. The isolated report remains inside the research integration worktree.

## Question and evidence quality

Do the project's user-integrated features cause severe `SLOW Frame` log episodes with `compile=`? **We can identify a direct existing cause for new on-demand compilation (warmup disabled by RAM threshold) and a plausible amplifier (RAM Safety single-worker prefetch), but cannot prove a particular integration introduced the stutters without an equal-condition A/B baseline.** Never equate logging correlation or 4 occlusion-mode runs with controlled tests of RAM Safety, DLSS, Table XPR, and static-cache coverage.

### What `compile` means in this code

`src/local/live-census.h`: `WaitCompile` is a render-thread elapsed-time wait scope, distinct from `WaitRecord` (`record_wait`). `src/graphics/host_gpu/renderer/pipeline/pipelineCache.cpp`: `WaitCompile` wraps **on-demand shader `ShaderRecompiler::TranslateProgram`** in ProgramCache::Get (around line 1713), **synchronous graphics pipeline `CreatePipelineInternal`** (around line 4098) and **compute pipeline creation** (around line 4189). Therefore `compile=` in slow frame log cannot be attributed solely to the GPU driver, nor does it quantify all background compile work. The `Made where first needed` counter is session-total on-demand program translations and pipeline creations, not number of *new driver-cache keys*. `m_render_pipelines++` occurs even when `LastPipelineFromStore()` was true. **Do not infer 1,602 actual driver shader recompilations from that number.**

### Four user runs (09:50–09:58 local)

| Run | Programs translated on demand | On-demand pipelines | Aggregate on-demand shader translation | Aggregate pipeline creation | Startup pipeline warmup | Idle pipelines evicted / remade |
|---|---:|---:|---:|---:|---|---|
| Original `095032-417` | 541 | 1,602 | 3,545ms | 2,051ms | skipped | 0 / 0 |
| Virtual `095223-561` | 552 | 1,602 | 3,695ms | 1,986ms | skipped | 0 / 0 |
| Light `095431-850` | 537 | 1,692 | 3,539ms | 1,677ms | skipped | 0 / 0 |
| Combined `095632-374` | 462 | 1,602 | 2,918ms | 1,663ms | skipped | 0 / 0 |

`SLOW Frame` episodes >=100ms across runs: 111 logged, 87 have a `compile` time component. Those 87 are selection-biased; aggregate overlapping counters (`compile` about 17,062.7ms, `record_wait` about 512.0ms) must **NOT** be interpreted as whole-game CPU utilization or FPS share. Earlier 09:35 and 09:37 gameplay sessions, before the user-controlled Stage2D experiment, also show 514 and 595 on-demand shader translations and 1,600 and 1,602 pipeline creations, respectively. This provides no evidence Stage2D newly caused compilation.

## Independent counterexample: severe stutter predates the four Stage2D experiment runs

Read-only review also inspected older Oct 24 gameplay logs, which are **different sessions/cache histories, not feature A/B tests**:

- `20261024-012441-887.out.log`: older, both Vulkan cache files were invalidated/reinitialized (undifferentiated driver/emulator/data identity mismatch). Worst reported slow frame about **5,476ms**, `compile=5,388ms`; **1,005 idle pipeline handles evicted, 238 remade (418ms aggregate)**. Cache identity mismatch **could** force first-use work; log cannot assign to a specific integrated feature.
- `20261024-021155-770.out.log`: severe frame **3,836ms**, `compile=3,755ms`, but only **64 evicted, 0 remade**; thus eviction/remakes are **not necessary** for severe compile-classified stutter.
- `20261024-083902-329.out.log`: severe frame about **49,386ms**, `compile=49,329ms`; multiple `SLOW CreateComputePipeline` calls were independently logged in the same portion of execution. This is strong direct evidence that the **synchronous pipeline creation call path** sometimes blocks for multiple seconds. It does not isolate whether driver compilation, cache lookup, paging, internal driver serialization or another activity within that API caused the prolonged wall time. The session did have 544 remakes (1,427ms over the entire session), far less than that one 49-second event; do not equate RAM Diet with the frame.
- `20261024-090315-546.out.log`: severe frame **8,433ms**, `compile=7,926ms` with only **one** pipeline remake (1.4ms). This further separates expensive first-use pipeline creation from pipeline-remake policy.

These older runs include different RAM Safety worker counts, active cache identity, and runtime implementations. Comparing raw stutters across them cannot yield a percentage penalty for DLSS, RAM Safety, Table XPR or another feature.

## Determinate cause: platform RAM gating disables shader/pipeline startup warmup

`pipelineCache.cpp` around lines 2665–2711: `PipelineWarmupMinRam = uint64_t{24} << 30u` i.e. **24 GiB = 24,576 MiB**. `PhysicalMemory()` reported **24,499 MiB**, just **77 MiB below** this boundary. Thus `low_ram=true`, `compile_shaders=false` and `warm_pipelines=false` unless externally forced. All four logs explicitly say **`Shader warmup: recording only (RAM 24499 MiB)`** and **`Pipeline warmup: skipped (video memory budget 10151 MiB, RAM 24499 MiB)`**. This is **source-proven deterministic causation** for *not pre-creating* shader modules/pipelines at startup, so resources not already warmed/built must be prepared when game first needs them. It is **not proof** every stutter was caused by this; it is a deliberate low-RAM safety policy, and bypassing it could consume gigabytes of RAM on a host that already fell below 1GiB available. **Do not lower threshold or force warmup.**

Caches are not empty. Logs report static pipeline binary store **67,097 pipelines / 103,087 binaries / 5,690 MiB**; Vulkan cache load **about 40.9 MB** main and **107.2 MB** table; shader warmup recorded **8,164 inputs and 8,114 pipeline recipes**. Those caches accelerate creation but do **not** imply all Vulkan handles are pre-instantiated. The matched runs still explicitly report between **1,602 and 1,692** on-demand pipeline creations, and **462–552** on-demand shader translations. The `Translation features 0x3 off` line documents intentional compatibility with existing static store; do not treat that alone as cache corruption. The `Static pipeline binaries: 1524 pipelines made of them, 1732 not among them` session summary shows **incomplete static-store coverage** (not that those 1,732 were all Vulkan driver compile cache misses), so first-use work is expected even with a multi-gigabyte store. Do not delete/rebuild static cache on this evidence.

## Possible contributing integrated features — graded

| Feature currently or historically integrated | Evidence | Classification |
|---|---|---|
| **RAM Safety** ON in currently saved config | Launcher explicitly requests `KYTY_SHADER_PREFETCH_THREADS=1`, `KYTY_SHADER_FOLLOW_THREADS=1`, `KYTY_PREFETCH_MIN_AVAIL_MB=4096`, `KYTY_ADAPTIVE_RAM=1`. Logs match `Shader prefetch: ... on 1 threads` and workers print `waits` when physical memory <4096MiB (as low as 1.1–3.4GiB in examples). Only ~813/895/847/947 of 20,137 candidate program groups completed before session end and ~400–479 were claimed/render-translated. Slower background catch-up may prolong on-demand shader translation. But fewer workers are a deliberate stability tradeoff, and RAM threshold causes warmup skip **independently of RAM Safety**. | **Plausible amplifier; not proven regression. Keep ON for safety.** |
| **RAM Diet** ON | Pipeline cache source implements idle eviction + stale unoptimized release. Every experiment's `Pipelines out of video memory while idle` summary says **0 evicted, 0 made again**. The 09:50–09:58 stutters cannot be attributed to on-demand **remaking previously evicted** pipelines. | **Excluded as *pipeline remake* cause in these four runs**; other overhead unmeasured. |
| **DLSS Super Resolution** ON, internal 2560x1440 -> 3840x2160 output in actual logs | NVIDIA Streamline binaries verified and SR works. It changes pixel processing and game output path, but no controlled non-DLSS comparison or pipeline-cause attribution. | **Unproven**, do not disable or blame. |
| **DLSS Frame Generation** | User's latest saved `framegen=0`; startup log mentions a Streamline bypass message, which is **not** proof FG is enabled. | **Not an active explanatory toggle**, by settings. |
| **Distance Detail Aggressive + Graphics Detail Lowest** | Both send LOD 480/shadow limit 60; shadows switched off via Lowest. Same config across four sessions; engine occlusion candidates added for three but draw packet census showed no sustained difference. | **No evidence they cause excessive compilation**; preserve. |
| **Texture Reduce 2** | Lowers texture resolution/VRAM but does not itself directly invoke `WaitCompile` in examined call paths. May indirectly change resource layout/specializations, but no variation/trace ties to stutter. | **Unproven**; preserve. |
| **GPU-driven Table XPR / table shader pipeline** | Source `docs/GPU-DRIVEN-XPR.md` documents real historical steady-state +10–19% boosts, first-area pipeline warmup regressions, fixes. Table driver cache loads (~107MB). Actual logs contain some `SLOW AsyncGraphicsPipeline ... table` lines, but not sufficient to attribute the thousands of on-demand creations to Table only. | **Legitimate complexity and possible cold-scene contributor**, not a demonstrated new regression. |
| **Occlusion Query Audit / Engine Occlusion Culling / Ready Pipeline Reuse** | User's four older sessions had audit on; 0 actual GPU culling grants, benchmark changes <0.3% PM4 draw packets; experimental Ready Pipeline Reuse was Off. All three branches have since been retired from launcher/native runtime. | **No supported attribution of compile stutter**. |
| **GPU Cache Budget** | Latest saved `vram_budget_mb=0` means no forced lower memory budget. | **Not actively constraining through launcher**. |
| **Stutter Guard** | Experimental driver-eviction tiering removed prior to latest integrated runtime; logs show 0 eviction/remakes. | **No evidence it causes this capture**. |

## Recommendation / safe next work

1. **Keep** RAM Safety, RAM16, RAM Diet, DLSS and working shader caches as-is; no uncontrolled toggling or forcing 24GiB warmup on memory-constrained PC. RAM is physically dangerously tight during a session. Avoid any automatic game launch or shader precompile.
2. **Investigate source-only** whether first-use translations and pipeline keys can adopt **existing verified static binaries** sooner, without creating/retaining a 3GiB startup warmup; exploit explicit already-existing pipeline binaries / portable shader-input coverage while preserving correctness and streaming budget. Do not resurrect experimental `ReadyPipelineReuse`; it did not establish benefit and is a different mechanism.
3. For *attribution* between RAM Safety ON/OFF, Table XPR, DLSS, or texture modes, the four runs are inadequate A/B because these controls stayed essentially unchanged. Unless a specific source bug is proven, do **not** demand further user testing; report the limits and stop.

Sources are the read-only inspected Windows project and 4 exact user logs under `_Build/run-logs`. No external research required. This audit does not assert FPS improvement or that source bugs have been fixed.
