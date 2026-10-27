# G2-H Unbounded-Level Specialization — ON-only live acceptance (2026-10-27)

## Outcome

**G2-H execution gate: PASS** in one user-performed standard-shader game session: 100% of sampled packed dependency levels/runs were statically unbounded and G2-H specialized them. **FPS absolute measurement gate: PASS** (two 15-second windows within same On boot). **FPS uplift / pixel equivalence: NOT DETERMINED**, because the user expressly wants **no fresh Off baseline** and no pair of matching screenshots was supplied. The default-off policy remains appropriate pending stronger evidence.

Do not ask user to redo Off/On, claim a performance increase/regression, or conflate this with shader translation 0x3. No gameplay was launched by the assistant; no game save/cache, shaders or native renderer were changed during result audit.

## Provenance

- New run: `_Build/run-logs/20261027-095048-465.out.log`, stderr `20261027-095048-465.err.log` **0 bytes**.
- Scene Benchmark: `_Build/scene-benchmark/session-C4lk7U/results.jsonl` (two 15s FPS windows) and `census-1793069546855.json` (232 native flips) plus `census-results.jsonl`.
- Configuration logged: **Standard shader 0x0** (`Translation features 0x3 off`), `KYTY_TABLE_READONLY_PASS_SKIP=0`, `KYTY_TABLE_PREFETCH_DEDUPE=0`, `KYTY_TABLE_UNBOUNDED_LEVELS=1`, scene `m04_00_00_00`, internal render **1920×1080**, output **3840×2160**, display present capped at **60 Hz**. Experimental **tessellation fade start 10.0** was active. Shader warmup 10296/10316 compiled and marked done (~56s); the recipe warmup compiled 1519/10407 (not every possible recipe).
- Native log includes matching `LIVE_MEASURE` IDs `1793069523367`, `1793069563442`, `LIVE_CENSUS id=1793069546855` and exact corresponding `LIVE_DONE`. No scored >50ms frames.
- Previous 09:46 G2-H On-only run `session-y2yDfe` had merely handshake `commands.txt`; this **new 09:50 run fixes missing benchmark sample**. These sessions are not independent FPS baseline/experimental arms.

## FPS — Census OFF during 15s windows

| Metric | On std1 | On std2 | Mean |
|---|---:|---:|---:|
| Average FPS | 49.47 | 49.80 | **49.635** |
| 1% Low FPS | 42.54 | 43.32 | **42.930** |
| P99 frame interval (ms) | 22.9 | 22.9 | **22.9** |
| Render CPU (ms/native flip) | 19.04 | 18.80 | **18.92** |
| Record CPU (ms/native flip) | 14.76 | 15.04 | **14.90** |
| Render busy (%) | 94.2 | 93.6 | **93.9** |
| Logical table draws/flip | 10838.9 | 10828.7 | **10833.8** |
| Continued draws/flip | 6676.4 | 6669.6 | **6673.0** |
| Indirect tables/flip | 8776.5 | 8771.3 | **8773.9** |
| Ring bytes/flip | 2176817.2 | 2227998.5 | **2202407.85** |
| Frames >50ms / >100ms | 0/0 | 0/0 | 0/0 |

The second window was ~0.67% higher average FPS than the first within the same boot. The two FPS windows are **not two independent game boots**; mean 1% low is not pooled percentile.

### Historical *context* only — NOT a matched A/B

Earlier G2-G **Off** `session-ediqd5` averaged **50.30 FPS, 42.685 1% low, 18.465ms render CPU, 10357.5 table draws/flip**, but used a different earlier binary/workload and has not been repeated with the G2-H build. The new G2-H On session averaged **49.635 FPS (−1.32%)** and **18.92ms render CPU (+2.46%)** relative to that historical Off context. Crucially it also performed **4.60% more table draws/flip, 3.35% more indirect tables/flip and 18.02% fewer ring bytes/flip**. No matched camera/position or image comparison is established. **These numbers cannot attribute any FPS difference to G2-H**. Do not label performance GO or regression from them.

## G2-H admission — CPU Census only

Native census `kind=12,a=0x7ab29`, with graphics `b` low values 1–6 and async queue high bit 63, records sampled **1 in 32 TableEvaluate invocations**. Values are sampled events/native flip, **not milliseconds nor estimated full-population counts**.

| G2-H sampled event / native flip | Graphics | Async |
|---|---:|---:|
| All packed dependency levels, phase 1 | **481.99** | **71.81** |
| Eligible all-unbounded levels, phase 2 | **481.99 (100%)** | **71.81 (100%)** |
| All packed runs, phase 3 | **2792.33** | **669.25** |
| Runs within eligible levels, phase 4 | **2792.33 (100%)** | **669.25 (100%)** |
| Levels actually specialized, phase 5 | **481.99 (100%)** | **71.81 (100%)** |
| Runs actually specialized, phase 6 | **2792.33 (100%)** | **669.25 (100%)** |

- In observed samples, **all eligible = all specialized** for both graphics and async; this is an observed branch census functional PASS, **not a claim that every area/game has no bounded runs**.
- Packed stage census `0x7ab26`: graphics 9484.33 stages/native flip and async 1161.57 stages/native flip; no observed operand fallback entry.
- G2-F sampled evaluation count graphics 157.23/flip, async 36.29/flip; sampled completions match sampled starts, no observed bounds reject or mapping failure.
- Graphics G2-E parent TableEvaluate **2.8226ms/flip**, locate+prefetch **0.8112ms**, dependent reader **0.8824ms**, descriptor/LOD **0.2724ms** under instrumented Census; async parent **0.5699ms**, locate **0.1834ms**, reader **0.1953ms**. **Inclusive scopes/child scopes must not be summed or interpreted as uninstrumented gains**.
- Sampled graphics 16KiB mapping-cache hits **98.64%**, short-direct reader 99.02%, async mapping hits 98.90%, short-direct reader 99.18%. The previously noted hot reader shortcuts already exist; no viewer should interpret those ratios as additional FPS.

## Practical decision / next step

1. **Retain G2-H On only as an explicit research experiment**; existing Launcher default **Off**, alongside G2-D/G Off for stable daily play. The latest session shows startup, scene, performance and counters working without native stderr, but image/pixel correctness unverified and improvement undemonstrated.
2. Respect the user's **On-only preference**. No request for a new Off baseline or 4-boot ABBA. Additional analysis can be done offline using artifacts already present.
3. The 100%-eligible signal proves the specialized path has excellent *coverage in this scene*, not that removing one bounded-flag test per run saves meaningful CPU. Consider inspecting optimized machine code against generic path and boundedness flag placement before investing in another CPU micro-optimization. G2-G already skipped 18.94% of candidate prefetch hints with no FPS gain; avoid treating percentage of work skipped as percentage of performance.
4. If further optimization is worthwhile, route to **G2-I offline PM4/QueueRun exclusive-cost analysis or targeted packed-reader call-path disassembly**, not another unproven live optimization. Keep PM4 observer ordering, protections, fault callbacks, watch semantics intact. Future default-on promotion requires meaningful performance and visual correctness evidence, which the present no-baseline constraint deliberately does not supply.

Reference prior implementation commit `b3a04201` and prior no-results handoff `docs/G2H_ON_ONLY_RUNTIME_CHECK_2026-10-27.md`.
