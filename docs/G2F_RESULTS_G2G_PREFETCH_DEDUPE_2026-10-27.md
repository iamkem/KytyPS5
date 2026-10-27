# G2-F acceptance / G2-G CPU-prefetch trial — 2026-10-27

**Decision:** G2-F sampled diagnostic **PASS** for one real 5-second runtime session. **GO** for a narrow **G2-G, default-OFF, opt-in** duplicate-prefetch suppression experiment, **NO-GO** for a causal FPS/speedup claim, any memory watcher/mapping proof removal, or default-on promotion. G2-G native code and Launcher are built; in-game A/B and image correctness have **not** been measured.

## Grounded runtime evidence

User-generated `_Build/scene-benchmark/session-4jnicY/census-1793065987872.json` and `census-results.jsonl`, **234 native flips**, count-only sampled 1-in-32 TableEvaluate evaluations, 740 census entries. Native stdout `_Build/run-logs/20261027-085145-588.out.log`: correct `LIVE_CENSUS id=1793065987872` / `LIVE_DONE`, native binary `_Build/latest/native-build/kyty_emulator.exe`, **Shader Translation Standard 0x0**, `KYTY_TABLE_READONLY_PASS_SKIP=0`, map `m04_00_00_00`, 60-Hz present cap. Stderr log 0 bytes. There was **no FPS benchmark** in this session (`results.jsonl` absent). Shader warmup completed 10312/10316 permutations; broader pipeline recipes incomplete (1768/10407). One process/camera view does not establish representative performance.

### G2-F rates (sampled counts per native flip; ratios within each sampled queue)

| Metric | Graphics | Async |
|---|---:|---:|
| Sampled evaluations/flip | 154.12 | 35.73 |
| Read calls/flip | 2713.97 | 661.49 |
| Direct-small read calls | **98.89%** | **99.14%** |
| Watched single-page fallback | 0.82% | 0 observed |
| Cross-4KiB fallback | 0.07% | 0.03% |
| 16KiB mapping cache hits | **98.62%** | **99.08%** |
| Prefetch issued/flip (sampled) | 2834.03 | 696.21 |
| **Adjacent identical 64-byte prefetch lines** | **524.38 / 18.50%** | **192.90 / 27.71%** |

Raw samples report `kind=12,a=0x7ab27/0x7ab28`, queue identity encoded by full 64-bit `b`, events in `calls_per_frame`, **zero `ms_per_frame` by design**. Accounting invariants: reader calls = page reuse + new page + cross-page; new page = clear-granule shortcut + watcher checks; watcher checks = present + absent; read calls = direct-small + direct-large + watched + cross-page; span attempts = success + failure; mapping probes = hits + misses. All pass within 0.01/flip rounding. The reported 18.5% / 27.7% are adjacent repeats in the **candidate issued-line stream** before optimization, not CPU-time or FPS gains.

## G2-G change (native)

**Switch:** `KYTY_TABLE_PREFETCH_DEDUPE`, **default 0** in `native-xpr.inc` and 0/1 registry in `performance-switches.h`. Launcher `table_prefetch_trial` is **strict literal-true opt-in**, with default false; Play always forces 0 or 1 explicitly through `-Set` independent of inherited environment/JSON, G2-D `table_readonly_trial` and shader `0x0/0x3`. No shader cache-version changes.

`src/local/table-prefetch-dedupe.h` provides a per-evaluation `State` that compares the **current advisory prefetch cache-line address** to the **immediately preceding attempted address**. Only with G2-G On can a repeated advisory `__builtin_prefetch` be skipped. `A,A,A` issues one; `A,B,A` issues all three. `BeginLevel()` resets at **both packed and fallback dependency-level locate loops**; does not reset per run. With Off, all prefetch hints execute in the original order.

**No other TableEvaluate behavior changes:** complete bounded-range validation, `MappingEpoch`, every required `IsFullyMapped`, mapping cache lookup, direct/slow watched guest reads, acquire-granule checks, fallback ordering, address output, shader descriptor bytes and Vulkan state remain identical. This is not a cache/memory-access-policy change. Prefetch only changes CPU performance hints (which may affect timing). Direct memory and shader-cache resources are not rewritten.

**G2-F telemetry change:** new `0x7ab28, b=12 | queue tag` is `SuppressedPrefetch`. In an opt-in CPU Census with G2-G On, metric 10 now counts **actually issued** prefetches, metric 12 counts **suppressed** advisory hints. Metric 11 counts adjacent duplicates among actual emitted lines, so On may show zero; the truthful omitted fraction is metric12/(metric10+metric12). With G2-G Off, metric12 is absent and previous G2-F 10/11 behavior is unchanged. This is a sampled diagnostics counter, not full population; **Census On perturbs timings**, never use it as a FPS A/B window.

## Tests and acceptance

- Standalone `tools/local/g2g-table-prefetch-policy-test.cpp` built and run via clang++ C++20 `-O0` with assertions: **PASS, exit 0**, covering `A,A,A`, `A,B,A`, line address 0, separate dependency-level reset, repeated runs, and Off preserving complete stream.
- `launcher-electron/tests/g2g-prefetch-dedupe.test.cjs`: **4/4 PASS** (strict opt-in, independent G2-D toggle, native scope guards, UI/census wiring).
- Complete Electron regression suite: **120/120 PASS**.
- C++ native `renderDraw.cpp.obj`: **PASS, exit 0**, 2 pre-existing warnings.
- Full native `kyty_emulator.exe`: **PASS, exit 0**, bounded Ninja `--parallel 1`, ThinLTO backends `KYTY_LLD_THINLTO_JOBS:STRING=2`, built 2026-10-27 09:06 local. No native gameplay launch.
- Binary `--shader-feature-trial-capabilities` **exit 0**; isolated Experimental 0x3 cache reports ready with 6,729,442,428 bytes. No shader precompile/copy/deletion.
- Actual Windows native runner `-DryRun` for four combinations of G2-G Off/On × G2-D Off/On with Standard shader mode **all exit 0**, correct `KYTY_TABLE_PREFETCH_DEDUPE=0/1` and `KYTY_TABLE_READONLY_PASS_SKIP=0/1` passed. Native startup correctness does not prove pixel/frame correctness.
- Electron packaged latest Launcher PASS, packaged `--smoke-ui` **ELECTRON_G2G_PREFETCH_DEDUPE_UI_PASS**, **ELECTRON_UI_SMOKE_PASS**, exit 0. Other cache/mod/settings smoke tests also pass.

## Next step: minimal two-boot user-performed A/B

```powershell
cd "C:\Users\hoang\Desktop\dev\KytyPS5"
.\launcher.cmd
```

**Options → Graphics**:
- Shader Translation **Standard `0x0`** both times.
- **Table Read-only Pass (G2-D): Off** both times.
- Scene Benchmark **On** both times.
- G2-G **Table Prefetch Dedupe (Experimental): Off first, On second**. Restart game between modes. No need to precompile shaders.

At the **same** Boletaria 1-1 position/camera, allow startup warmup and first-use pipeline creation to settle. For **each of the two boots** run **Measure FPS (15s) → Profile CPU (5s) → Measure FPS (15s)**. Return focus promptly after pressing the control. Take matching screenshots or visually compare architecture/fog/effects/shadows to catch correctness regressions. Off/On one boot each is a **preliminary** comparison; do not present small differences as causal.

After the user says **xong**, inspect fresh `_Build/scene-benchmark/session-*/results.jsonl`, `census-*.json`, `census-results.jsonl` and the native stdout. Confirm G2-G On actually suppresses lines, compare `table_draws`, render CPU, FPS, 1% low and frame tails, distinguish Census On vs FPS windows. **Default stays Off** until repeatable improvement beyond drift and image correctness are verified. If no gain, leave Off and redirect CPU work rather than accumulating unproven active optimizations.

Three independent read-only reviews: `agt_b323b7aa`, `agt_966f8f83`, `agt_9ca7ed73`. No subagent source modifications.
