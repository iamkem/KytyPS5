# G2-E — TableEvaluate Subphase CPU Census (2026-10-26)

## Scope and decision

**Implemented**: native TableEvaluate-only detailed CPU census + Electron Scene Benchmark report display + synthetic guards + resource-bounded native build. **NO-GO to renderer algorithm changes** until real on-scene data identifies a dominant subphase. No gameplay, pipeline precompile, shader cache, save, Vulkan barrier or guest memory modification was performed during this implementation.

Baseline observed on RTX 5070 (`docs/G2C_CENSUS_RESULTS_G2D_ADMISSION_2026-10-26.md`, `docs/G2D_AB_READONLY_PASS_RESULTS_2026-10-26.md`):

- G2-C graphics `TableEvaluate` ~2.2056 ms/flip Standard, ~2.3172 ms/flip Trial; ~6.3–6.4k calls/flip.
- G2-D CPU trial did not improve FPS (45.00 Off vs 44.90 On-window mean), despite ~20.8k no-op write checks/flip skipped. Do **not** promote G2-D `Table Read-only Pass` to default.
- Inside `TableEvaluate`, map/prefetch, dependent reads, descriptor/LOD and indirect-image enumerations previously shared the same inclusive timer. Only newly measured subphases can identify the next candidate.

## New native census probes

All probes are **only recorded during the existing manual `Profile CPU (5s)`**, through `src/local/live-census.h`; normal gameplay and separate 15s FPS benchmark do not enable census. Existing `kind=12 a=0x7ab20 b=1` **inclusive TableEvaluate** retained unchanged.

| Hex key `a` | Phase `b` (low byte) | Definition | Measurement grain |
|---|---:|---|---|
| `0x7ab25` | 1 | setup / MappingEpoch, clearing table mapping cache & previous word state, NativeXprReader init | once per TableEvaluate invocation |
| `0x7ab25` | 2 | locate bounds, 16-KiB mapping-page proof, prefetch issuance (and operand address extraction) | one scope per dependency level, not per run/page |
| `0x7ab25` | 3 | dependent `NativeXprReader::Read` calls | one scope per dependency level, not per word |
| `0x7ab25` | 4 | descriptor image/sampler word construction, masking and LOD stats | once per stage/descriptor group |
| `0x7ab25` | 5 | nonempty indirect-image enumeration, validation, sorting, output word construction | once per stage with nonempty indirect plan |
| `0x7ab26` | 1 | packed stage selected (count only) | one per stage |
| `0x7ab26` | 2 | operand fallback selected (count only) | one per stage |

**Queue differentiation:** full 64-bit `b` includes async `0x8000000000000000` and outside-queue `0x4000000000000000` tags. Parser/UI preserve raw 64-bit strings and show separate G2-E labels. `0x7ab26` is **count-only; 0 ms is by design**. The `LiveCensus` 32,768-entry table is reused, no new shared header or event schema introduced.

**Accounting limitations:** The `TableEvaluate` total `0x7ab20/1` encloses all new probes. New level scopes are disjoint from each other, but outer and child intervals **overlap**. Do not add the inclusive parent or PM4 QueueRun to phase values. TSC timing includes its own overhead and host stalls/preemption. Phase 2 includes the location/prefetch instructions but later phase 3 may incur residual memory latency. Failed mapping reads return early from a scoped location interval. Fallback `by_operands` retains its original stage, level, image and sampler work. Indirect enumeration returns early when the plan is empty and is only timed for nonempty work.

All original `IsFullyMapped`, `locate`, `reader.Read`, `EnumerateAddressProbe`, pair/user-data validity checks, short-circuit fallback, line prefetches, descriptor masking and output ordering are **retained**. No new reads, cache reuse, guest-protection shortcuts or Vulkan state transformations.

### Why no new optimization switch?

G2-E modifies **instrumentation only**; it is already opt-in through `Scene Benchmark = On` and `Profile CPU (5s)`. Adding another process-wide switch would not improve safety or comparability and would complicate the launcher. G2-D `Table Read-only Pass (Experimental)` remains separate and default-off by design.

## Tests/build (Windows checkout)

- `node --test launcher-electron/tests/g2e-table-evaluate-census.test.cjs`: **5/5 PASS**, source-equivalence and raw key parser guards.
- `cd launcher-electron && npm test`: **111/111 PASS**.
- Native `renderDraw.cpp.obj`: **PASS exit 0** (two existing warnings at `imageView.h` and unused TableBlocks type alias).
- Native `kyty_emulator.exe`: **PASS exit 0**, after `CMake --build _Build/latest/native-build --target kyty_emulator --parallel 1`; existing cache `KYTY_LLD_THINLTO_JOBS:STRING=2`. Exe timestamp local 2026-10-26 14:17.
- Native `--shader-feature-trial-capabilities`: **PASS exit 0** and cache inspector reports Experimental `0x3` ready with 6,729,442,428 bytes (cache unchanged).
- `launcher-electron/scripts/package-latest.ps1`: **PASS**; packaged `DemonsSoulsLauncher.exe --smoke-ui`: **ELECTRON_UI_SMOKE_PASS, exit 0** (including existing Scene Benchmark and G2-D option).
- **Not done:** actual G2-E in-game census and visual/FPS acceptance. None of these tests proves an FPS improvement.

## Minimal real sample to decide G2-F

1. Launch `C:\Users\hoang\Desktop\dev\KytyPS5\launcher.cmd`.
2. In **Options → Graphics**: select **Shader Translation Mode = Standard (0x0)**, **Table Read-only Pass (Experimental) = Off**, **Scene Benchmark = On**. The most recent UI smoke observed the saved G2-D selector as `true`; **explicitly change it to Off**, do not presume it is already Off.
3. Player manually presses Play. In `m04_00_00_00` (same camera/position if practical), wait for shader warmup to settle. Press **Profile CPU (5s)**, return focus to gameplay within 5 seconds. **One CPU Census sample is sufficient** to select the next subphase; optional `Measure FPS (15s)` if a comparable baseline is desired. No second boot or shader `0x3` run required for this diagnostic.
4. Results live under `_Build/scene-benchmark/session-*/census-<id>.json` (all entries) and `census-results.jsonl` (focusEntries include `0x7ab25`, `0x7ab26`). Send simply **xong**; assistant can read the artifacts from DevSpace Windows.
5. If `0x7ab25` entries are missing, report as an admission failure (old binary/not in TableEvaluate path), not as zero cost. If large costs appear, the next stage should be an opt-in **narrow, reversible** G2-F optimization with current/optimized exact same-scene comparisons, image correctness, and default Off; do not assume the highest counter time is automatically removable.

**GO next**: inspect the real G2-E census and pick exactly one TableEvaluate subphase; **NO-GO** for speculative watched-memory bypass, cache invalidation removal, guest pointer reordering, direct GPU readback, shader 0x3 default or broad Vulkan changes.

Reviews: three independent read-only Codex subagents `agt_ce35e27c`, `agt_05b4e8ef`, `agt_59fc09ca`. They proposed grouped timing and cautioned against watcher/mapping changes without evidence.
