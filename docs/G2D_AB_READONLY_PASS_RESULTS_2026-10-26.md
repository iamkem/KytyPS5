# G2-D Read-only Table Pass — Two-boot A/B result, 2026-10-26

**Status: IMPLEMENTATION PASS / PERFORMANCE NO-GO (do not promote default).** User explicitly chose **two boots only** (Off then On), not an A/B/B/A series. No gameplay or precompile was started by the assistant in the results-analysis turn. The existing emulator, save, shader caches and visual settings were not changed during analysis.

## Inputs and provenance

- Checkout: `C:\Users\hoang\Desktop\dev\KytyPS5`, branch `integration/chenxiao-v20261023b-20261023`, initial HEAD `70aea26f`.
- **Off (baseline):** `_Build/scene-benchmark/session-nL0tnB/results.jsonl`, `census-1792997645623.json`; native log `_Build/run-logs/20261026-135229-080.out.log`.
- **On (CPU trial):** `_Build/scene-benchmark/session-jLxnoT/results.jsonl`, `census-1792997809309.json`; native log `_Build/run-logs/20261026-135450-665.out.log`.
- Off native log explicitly prints `Performance switches: KYTY_TABLE_READONLY_PASS_SKIP=0`; On prints `=1`. **Both** log Standard shader translation `0x3 off` and standard pipeline store; not an experimental shader comparison.
- Both use scene ID `m04_00_00_00`, game standard settings and present capped at 60Hz, with FPS observed in the mid-40s. Same scene ID does **not prove** matching camera, player position, draw workload or background driver state. Warmup input count in both was 10,316 and recipes 10,407; Shader warmup completed ahead of FPS measurement, but background prefetch/driver histories remain uncontrolled.
- Census matches `LIVE_CENSUS` + `LIVE_DONE` from the exact corresponding active game log and includes the new `0x7ab24` count-only key.

## Actual native frame metrics

| Measure | Off: std1 | On: std1 | On: std2 | On window mean |
|---|---:|---:|---:|---:|
| Avg FPS | 45.00 | 44.07 | 45.73 | **44.90** |
| 1% Low FPS | 36.64 | 36.91 | 35.96 | **36.435** |
| P99 frame interval (ms) | 26.6 | 26.8 | 26.2 | **26.50** |
| Render CPU (ms/flip) | 20.53 | 21.51 | 20.36 | **20.935** |
| Record CPU (ms/flip) | 16.06 | 16.64 | 16.10 | **16.370** |
| >50ms / >100ms frames | 0 / 0 | 0 / 0 | 0 / 0 | **0 / 0** |
| Logical Table draws / flip | 16,087.8 | 15,736.5 | 15,738.9 | **15,737.7** |
| Ring bytes / flip | 3,559,184.4 | 3,023,888.6 | 3,332,120.7 | **3,178,004.65** |
| Render passes / flip | 102.6 | 104.2 | 102.6 | **103.4** |

The observed Off→On window mean differences are:
- FPS **−0.10 / −0.22%**: no positive evidence of gain.
- 1% Low **−0.205 / −0.56%**: effectively flat.
- Render CPU **+0.405ms/flip / +1.97%**, record CPU **+0.31ms/flip / +1.93%**. There is no evidence the patch caused this; the tests are not equivalent workloads.
- Logical `table_draws` **−2.18%** and `table_ring_bytes` **−10.71%**. These confound any simple wall-time comparison.
- Within **the same On boot**, FPS rose 44.07→45.73 (+3.77% vs first sample). That intra-run variation far exceeds the 0.22% Off/On difference, making a small win/loss impossible to assign to the switch.

Off only had **one valid FPS window**, On had two; those are not two independent On boots. The user intentionally capped the runtime effort at two game launches. Means of 1% Low and p99 are means of window statistics, not pooled percentiles.

## G2-D functionality: definitely activated

Native `LIVE_CENSUS_ENTRY kind=12 a=000000000007ab24` is count-only, with `b=(buffers << 8)|skipFlag|queueFlag`. No duration is tracked by this counter; `ms_per_frame=0` is by design, not free work.

| Derived from two CPU Census windows | Off | On |
|---|---:|---:|
| Census duration / native flips | 5s / 217 | 5s / 222 |
| Eligible TableBlocks stage calls / flip | **7,218.19** | **7,125.17** |
| Eligible first-pass buffer checks / flip | **21,084.77** | **20,805.91** |
| Actually omitted first-pass checks / flip | **0** | **20,805.91** |

The optimized path **executed** and skipped approximately 20.8k *no-op write-scan iterations per frame*, while preserving all second-pass reads. Eligibility and buffer-count distribution vary slightly between boots.

### Native phase timings (one inclusive CPU Census per mode)

| Scope | Off (ms/flip) | On (ms/flip) | Notes |
|---|---:|---:|---|
| Graphics TableBlocks inclusive (`0x7ab21/2`) | **2.3128** | **2.1847** | **−0.1281ms / −5.54%** observed; different call counts |
| Graphics TableBlocks calls/flip | **6,409.64** | **6,326.75** | **−1.29%** |
| Graphics TableEvaluate (`0x7ab20/1`) | 2.2005 | 2.1699 | Still a larger and structurally more complicated candidate |
| Graphics TableGather (`0x7ab20/2`) | 0.3321 | 0.3355 | Flat |
| Graphics CPU-dirty ring candidate (`0x7ab22/1`) | 0.5670 | 0.4831 | Different traffic |
| Async compute TableBlocks inclusive | 1.0184 | 1.0600 | Different work; do not conflate graphics and async |

Normalized graphics TableBlocks cost is approximately **0.361 μs/call** Off vs **0.345 μs/call** On (~−4.3%). This hints the empty scan is measurable **inside that inclusive scope**, but it does **not** establish causality or yield an overall FPS gain. `LiveCensus` timings are inclusive and may overlap child scopes; do not sum across them. The visual image equivalence was not formally checked with matched screenshots/pixels, and successful gameplay runs alone do not establish it.

## Decision and recommendation

- **G2-D functional gate: PASS.** Native switch 0/1 applied, correct branch reached, skipped iterations demonstrably nonzero, and both sessions recorded gameplay/frame data.
- **G2-D FPS promotion: NO-GO.** Trial On does not improve average FPS/1% Low in the two-run observation; no need to request the originally proposed four-run protocol from the user. The switch stays available for research **but DEFAULT OFF**. Recommended daily setting: Shader Mode Standard `0x0`, Table Read-only Pass **Off**.
- **G2-D visual correctness certification: NOT TESTED** (no paired pixel/screenshot comparison); no claim of pixel-identical graphics.
- **G2-E next opportunity:** investigate `TableEvaluate` (~2.2 ms/flip on graphics + ~0.38 ms async, 6.4k calls/flip) with a narrow **opt-in** timing breakdown of guest-memory mapping and epoch checks, dependent `NativeXprReader` reads, packed vs slow operand path, image/sampler descriptor work, and indirect-image handling. First identify a dominant subphase; no broad changes to guest reads, caching, Vulkan barriers, shader pipeline cache or save. User should not need to re-run unchanged G2-D.
- Keep the project's earlier **Shader Translation 0x3 experimental** and CPU-readonly trial **separate**; don't interpret the two runs as a shader-mode benchmark.

This report is from actual native `LIVE_MEASURE`/Census data and source definitions, not from an invented FPS estimate or GPU utilization inference.
