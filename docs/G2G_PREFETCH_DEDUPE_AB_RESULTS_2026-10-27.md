# G2-G Adjacent Prefetch Dedupe — two-boot A/B acceptance, 2026-10-27

**Decision: Functional PASS / Performance NO-GO.** Keep `KYTY_TABLE_PREFETCH_DEDUPE=0` and Launcher Table Prefetch Dedupe **Off** by default. The native switch correctly removed ~19% of sampled graphics and ~28% of sampled async advisory prefetch candidates but did not produce a measured FPS gain. Do **not** promote on this evidence. The user explicitly prefers just two game launches (Off → On), so do not request extra 4-boot testing.

Analysis of **user-performed gameplay** only. During this audit, the assistant did not run game, build shader caches, alter saves or change renderer behavior.

## Verified sources

| Artifact | Baseline Off | Experimental On |
|---|---|---|
| Session | `_Build/scene-benchmark/session-ediqd5` | `_Build/scene-benchmark/session-XJ3YeT` |
| FPS windows | `results.jsonl`: 2×15 s | `results.jsonl`: 2×15 s |
| Native CPU Census | `census-1793067337490.json`: 234 flips, 761 scopes | `census-1793067502481.json`: 235 flips, 759 scopes |
| Native stdout | `_Build/run-logs/20261027-091352-333.out.log` | `_Build/run-logs/20261027-091634-139.out.log` |
| Native switch | `KYTY_TABLE_PREFETCH_DEDUPE=0` | `KYTY_TABLE_PREFETCH_DEDUPE=1` |
| Shader / G2-D | `0x3 off`, `KYTY_TABLE_READONLY_PASS_SKIP=0` | `0x3 off`, `KYTY_TABLE_READONLY_PASS_SKIP=0` |
| Scene / output | `m04_00_00_00`, 60-Hz cap | `m04_00_00_00`, 60-Hz cap |

Every measurement/census ID matches native `LIVE_MEASURE`/`LIVE_CENSUS` and `LIVE_DONE` in the exact respective log. Stderr logs are zero bytes. The **experimental distance tessellation early-fade start 10.0 was enabled in both boots**, so the matching graphics setup was consistent but not completely stock. Both runs also had the same wave64 warning and shader binding-layout startup warnings; they are not G2-G-On-only failures. One restart per mode, Standard Off then On. Same map is **not** evidence of matched player/camera/visible object count. No screenshot/pixel match was collected. Broad pipeline warmup count differs between boots, so first-use/cache/workload are potential confounders.

## Native FPS windows — Census OFF

| Metric | Off #1 | Off #2 | On #1 | On #2 |
|---|---:|---:|---:|---:|
| FPS | 50.27 | 50.33 | 50.00 | 49.80 |
| 1% low FPS | 42.06 | 43.31 | 44.04 | 42.42 |
| P99 flip interval ms | 22.9 | 22.8 | 22.6 | 22.8 |
| Render CPU ms/native flip | 18.53 | 18.40 | 18.96 | 19.14 |
| Record CPU ms/native flip | 14.67 | 14.01 | 14.62 | 14.81 |
| Logical table draws/native flip | 10,354.3 | 10,360.7 | 10,187.6 | 10,200.8 |
| Over-50ms frames | 0 | 0 | 0 | 0 |

Mean of *two windows per boot*, NOT independent replicate boots:

| Metric | Off | On | Change |
|---|---:|---:|---:|
| FPS | **50.30** | **49.90** | **−0.40 (−0.80%)** |
| 1% low FPS | 42.685 | 43.230 | +0.545 (+1.28%) |
| P99 interval ms | 22.85 | 22.70 | −0.15 (−0.66%) |
| Render CPU ms/flip | **18.465** | **19.050** | +0.585 (+3.17%) |
| Record CPU ms/flip | 14.340 | 14.715 | +0.375 (+2.62%) |
| Render busy | 92.85% | 95.05% | +2.20 percentage points |
| Table draws/flip | **10,357.5** | **10,194.2** | **−1.58%** |
| Table continued/flip | 6,458.65 | 6,303.15 | −2.41% |
| Indirect tables/flip | 8,489.70 | 8,505.55 | +0.19% |
| Table dispatches/flip | 1,348.25 | 1,364.50 | +1.21% |
| Table ring bytes/flip | 2,686,505 | 2,431,678 | −9.49% |
| Render passes/flip | 85.55 | 86.80 | +1.46% |
| Upload wait us/flip | 932.15 | 731.35 | −21.54% |

The On boot processes **different** work (fewer logical table draws/ring bytes, more render passes/async dispatches), so the tiny FPS/tail differences cannot be causally attributed to G2-G. Nevertheless there is no positive evidence to promote On; render CPU was *higher* despite less draw work. 1% lows are per-window statistics and their mean is not a pooled percentile.

## G2-F/G2-G CPU Census — diagnostic ON, sampled 1/32 evaluations

| Native count-only per-flip events, sampled | Off graphics | On graphics | Off async | On async |
|---|---:|---:|---:|---:|
| Evaluations sampled | 154.53 | 154.54 | 35.77 | 36.11 |
| Prefetches emitted | 2931.21 | 2383.83 | 701.88 | 502.00 |
| Adjacent repeated *emitted* lines | 553.12 | 0 | 196.08 | 0 |
| **Prefetches actually suppressed** | **0** | **556.97** | **0** | **193.10** |
| Suppressed / candidate attempts | 0% | **18.94%** | 0% | **27.78%** |
| Mapping cache hit rate | 98.59% | 98.39% | 99.01% | 98.94% |

The count-only G2-G key `kind=12, a=0x7ab28, phase 12, b|queueFlags` appears only On and proves **the path activated**; Off emits full candidate stream. On prefetch emitted+suppressed ~2,940.80 graphics and ~695.10 async, very close to Off emitted 2,931.21 graphics and 701.88 async. This is good evidence equivalent **prefetch opportunity count**, not proof of equivalent visible rendering or frame rate.

Sampled counts do **not** represent all prefetches in a frame; `ms_per_frame=0` for these counter entries is by design. Exact native reader accounting identities pass within rounding. No evidence of errors/exceptions in these windows. GPU correctness is not pixel-certified.

Graphics census CPU inclusive scopes:

| Scope | Off ms/flip | On ms/flip |
|---|---:|---:|
| `TableEvaluate` inclusive `0x7ab20/1` | 2.7888 | 2.8573 |
| `Locate+mapping+prefetch` `0x7ab25/2` | 0.8229 | 0.9021 |
| Dependent `NativeXprReader` `0x7ab25/3` | 0.8806 | 0.8745 |
| Descriptor/LOD `0x7ab25/4` | 0.2725 | 0.2723 |

The ~0.0792ms higher On locate interval is **observed, not attributable to the branch without matched-workload controls**. In addition, G2-E timed dependency-level scopes incur substantial instrumentation overhead (~30k per graphics native flip). These are **inclusive TSC estimates**, never sum parent/child scopes or infer directly removable time.

## Admission / next engineering direction

**PASS:** switch/Launcher was correctly enabled/disabled, redundant advisory prefetches really omitted, runtime logs and census match, two user-performed game boots measured with no >50ms windows or stderr exceptions.

**NO-GO:** measurable frame-rate improvement, setting G2-G On by default, claiming pixel-identical graphics, skipping mapping/watcher checks, assuming more than observed local candidate stream, attributing CPU regression solely to G2-G.

**Recommended user baseline:** Shader Translation Standard `0x0`, G2-D Table Read-only Pass **Off**, G2-G Table Prefetch Dedupe **Off**. These independent experimental switches remain in Launcher for research/instant rollback; no need to remove user cache or recompile shaders.

**G2-H next:** stop accumulating micro-optimizations of already-small per-event checks. First examine **packed-path per-run instruction/metadata work and direct-small read length distribution**, because over 98% of sampled reader calls already use the direct ≤16-word path (averaging ~4.17 words for graphics and ~3.10 words async). The existing reader already caches last-page watcher decisions and inlines short reads; do not propose them again. Also review the large graphics PM4 QueueRun / Table XPR total and look for safe *batched* operations or aggregated hoistable non-guest validation that reduces hot-path invocation frequency. Instrument narrowly **only if** an identifiable repeated operation is unsupported by existing counters. A proposed optimization requires a correctness proof, default-off rollback, render-image match, and separate Census-off FPS acceptance. Other acceptable decision is to stop CPU micro-tuning and move to GPU-side profiling only if hardware evidence warrants it. Avoid speculative watcher, memory-protection, Vulkan barrier or draw-count semantic changes.

Sources are all local user-generated native measurements and KytyPS5 code, not external/online FPS claims.
