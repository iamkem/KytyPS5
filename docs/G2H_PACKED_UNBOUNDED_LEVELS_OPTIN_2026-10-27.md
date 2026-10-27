# G2-H — Packed TableEvaluate Unbounded-Level Specialization (2026-10-27)

**Status: IMPLEMENTED and native-linked, default OFF; unit/Launcher/capability/GUI smoke PASS. NO-GO for default enable until user-performed runtime and FPS A/B.** No game was launched, no save or shader cache modified, no shader precompile performed while implementing this branch.

## Evidence / target

- Prior G2-G two-boot A/B `docs/G2G_PREFETCH_DEDUPE_AB_RESULTS_2026-10-27.md`: 50.30 FPS Off vs 49.90 FPS On, no demonstrable benefit; renderer workloads differed. G2-D and G2-G remain default Off.
- Prior G2-E TableEvaluate graphics inclusive ~2.445 ms/native flip on one mid-40-FPS workload; later G2-G instrumented samples ~2.8ms with other workloads. Native scope values **include instrumentation overhead** and must not be read as removable latency.
- All captured `TableEvaluate` shader stages used packed plan, not operand fallback.
- G2-F direct-small (< = 16 words) reads made up 98.9% graphics and 99% async sampled reader calls; 16KiB mapping cache hits >98%, but the direct-read **length distribution** is unknown. Reader already caches last-page watcher decisions, inlines short reads, and has compiler-generated vectorization. **No speculative specializations to the read length have been made.**
- The packed evaluator still loads a bounded-run sentinel/optional records metadata and passes boundedness to `locate` **for every packed run**, even when all runs in one dependency level were created as unbounded. This is an immutable metadata opportunity, not an opportunity to skip actual guest validity checks.
- Independent read-only reviews `agt_ca7aade1`, `agt_54279266`, `agt_52f20411`. The first proposed hoisting known-unbounded metadata per level; the second found that `ReadImpl<false>` is already compiled out-of-line and cautioned against unmeasured small-length specialization; the third reviewed PM4 batching risks. **No subagents modified source.**

## G2-H implementation (default-Off)

**Native switch** `KYTY_TABLE_UNBOUNDED_LEVELS=0/1`, default `0` in `src/local/native-xpr.inc`, declared/registered with the 0/1 performance switch registry. **Launcher setting** `table_unbounded_trial=false` unless the user selects literal `true`, always emits exactly one `KYTY_TABLE_UNBOUNDED_LEVELS=0|1` and overrides inherited environment/JSON. It is independent of Shader Translation, `KYTY_TABLE_READONLY_PASS_SKIP` and `KYTY_TABLE_PREFETCH_DEDUPE`. No shader cache stamp or compilation mode changes.

`src/local/table-unbounded-levels.h` derives a `vector<uint8_t>` flag per packed *dependency level*. A level qualifies only if:
- the actual packed plan is **valid** and its run/end ranges form a nonempty, strictly increasing, fully covering level partition;
- **every** run's packed `records` is `TablePair::PackedRun::NotBounded`;
- the plan is recomputed at `TableRuns` after `TablePack`; flags reset before every run construction. `TableReset` reconstructs the pair, invalidates all packed plan data and metadata. Missing, invalid, mixed bounded/unbounded levels fail closed.

With G2-H **On**, packed `TableEvaluate` branches once per eligible level, uses the original `locate` lambda but with compile-time/default `bounded=false` and zero records argument **only for that entire proven-unbounded level**, then executes unchanged `NativeXprReader::Read` grouped per dependency level. Otherwise it runs the old per-run bounded/records selection unmodified. No stage with fallback plans is specialized. `PackedRun` layout is unchanged; adding a dynamic vector at plan construction may have a small memory cost. Potentially new branch/size-check overhead in the packed level loop remains unmeasured.

**Preserved:** signed immediate/address masking, page proof and mapping-epoch invalidation, `IsFullyMapped` for all pages on misses, 64-byte-line prefetches and G2-G option, acquire read granules, watcher-aware fallback, dependent-slot reads, late descriptor/LOD word packing, indirect enumeration, GPU submission. The source does not merge runs, hoist actual memory reads or bypass guest memory protections.

## G2-H census diagnostics

The existing **sampled one-in-32 TableEvaluate invocation** counter struct now includes six new optional packed metrics. Native scope `kind=12,a=0x7ab29`, phase `b=metric_id|queue_tag`, records **count-only events**, not milliseconds:
1. Packed levels observed.
2. Fully-unbounded eligible packed levels.
3. Packed runs observed.
4. Runs in fully-unbounded levels.
5. Levels actually specialized with switch On.
6. Runs actually specialized with switch On.

G2-H counters flush once per sampled evaluation through the existing G2-F RAII aggregation; no per-run timestamps or hash updates. Queue tags `0` graphics, bit63 async, bit62 outside. In the Launcher G2-H summary display percentages of eligible levels and runs and how many were used by the opt-in branch. **Eligibility rates are unknown until a real game census**; the G2-F/G2-G results do not measure bounded-level prevalence. Do not infer FPS from eligibility percentages, or treat sampled count-only 0ms records as time.

## Verification (Windows checkout)

- `tools/local/g2h-unbounded-levels-policy-test.cpp` compiled using Clang C++20 with `-O0` and assertions: **PASS**, verifies packed metadata flags, malformed/empty level partitions, all-unbounded vs mixed levels, rejection under bounded range limits, relative/dependent level addressing, 4KiB/16KiB boundary examples and mapping rejection **using a standalone fixture** (not an actual GPU/pixel equivalence test).
- New `launcher-electron/tests/g2h-unbounded-levels.test.cjs`: **5/5 PASS**, strict opt-in, G2-D/G independence, plan recomputation source guards, count-only report wiring and UI selector.
- Full `cd launcher-electron && npm test`: **125/125 PASS**.
- `renderDraw.cpp.obj` compiled **PASS exit 0**, two pre-existing compiler warnings.
- Native emulator `cmake --build _Build/latest/native-build --target kyty_emulator --parallel 1`: **PASS exit 0**; native Release link with `KYTY_LLD_THINLTO_JOBS:STRING=2`, successful executable timestamp 2026-10-27 09:38 local.
- `kyty_emulator.exe --shader-feature-trial-capabilities`: **PASS exit 0**, trial 0x3 pipeline cache still READY, 6,729,442,428 bytes; no rebuild or cache modifications.
- Actual `run-windows.ps1 -DryRun`, Standard shader, G2-H Off/On × G2-G Off/On (G2-D Off): **4/4 PASS**, explicit override of a stale inherited G2-H=1 with Launcher Off.
- Latest Electron Launcher packaged: **PASS**.
- Packaged `--smoke-ui`: `ELECTRON_G2H_UNBOUNDED_LEVELS_UI_PASS` + `ELECTRON_UI_SMOKE_PASS`, **exit 0**. Nonfatal screenshot capture reported `SCREENSHOT_UNAVAILABLE main: UnknownVizError`.
- **NOT DONE**: actual G2-H in-game measurements, image/camera matching, pixel output certification, or real frame performance acceptance. Offline fixture and native build do not prove pixel equivalence.

## User testing — maximum TWO boots

Use the updated latest Launcher with PowerShell:

```powershell
cd "C:\Users\hoang\Desktop\dev\KytyPS5"
.\launcher.cmd
```

**Options → Graphics**, keep across both boots:
- Shader Translation: **Standard `0x0`**.
- Table Read-only Pass (G2-D): **Off**.
- Table Prefetch Dedupe (G2-G): **Off** (**the earlier GUI smoke observed the saved G2-G selector as `true`, so explicitly turn it Off**).
- Scene Benchmark: **On**.
- Table Unbounded Levels (G2-H): **Off in first boot**, **On in second boot**.

Stand at the same position and camera in `m04_00_00_00`, after background shader/pipeline warmup. For each boot: **Measure FPS 15s → Profile CPU 5s → Measure FPS 15s**. Return focus to game promptly after pressing measure/census. Exit completely between boots. Prefer matching screenshots/visual check of geometry, lighting, and effects. Do not run external shader precompile.

Check `_Build/scene-benchmark/session-*/results.jsonl`, `census-*.json`, logs. Confirm native switch 0→1, sampled `0x7ab29` level eligibility and optimized count, compare Standard Off/On FPS, 1% low, P99, render/record CPU, `table_draws`, pipeline/warmup histories, ring bytes. FPS windows are census-Off. Two boots show a preliminary direction, not proof of a small causal benefit.

**Next GO/NO-GO rule:** If most packed levels are unbounded AND the game remains visually correct AND real matched-workload frame performance improves beyond natural variation, consider broader repeated validation **only if useful**. If eligible level count is low, source specialization does not reduce total frame CPU, or an image issue appears, **keep G2-H Off**, do not request four boots, and move to exclusive-cost PM4/queue or GPU-side profiling. This phase did not assert any expected FPS gain.

**Git/user files:** preserve pre-existing untracked `Steam_DemonsSouls_Launcher.bat`, `_SaveData.rar`, prior handoffs and local precompile backups. Never stage or alter these while committing G2-H.
