# G2-I live TableBlocks Census / G2-J admission — 2026-10-27

## Decision

**G2-I native telemetry: PASS. G2-J safe next target: investigate async compute writable `BufferCache::ObtainBuffer` path and existing write memo, then implement only if branch/failure evidence supports an actual redundant operation. No new default-on optimization admitted.** The user performed **a single On-only CPU Census** and explicitly does not want a new Off baseline. Do not ask for another baseline. No game was launched and no cache, saves, shader files or renderer logic were changed during this analysis.

The current experiment flags remain Shader Standard 0x0, G2-D Off, G2-G Off, **G2-H On** for this research run (not for general default performance). G2-I is solely a profiler; it does not itself improve FPS.

## Provenance / admission

- Current branch `integration/chenxiao-v20261023b-20261023`, previous source checkpoint `53fe4b94`.
- User-generated native log `_Build/run-logs/20261027-101336-755.out.log`, zero-byte paired stderr.
- `_Build/scene-benchmark/session-0kGGe2/census-1793070890967.json`, 230 native flips, 797 census entries, `census-results.jsonl` and `commands.txt`. Command file contains only `id 1793070890967\nsleep 5\ncensus 5`, corresponding `LIVE_CENSUS id=1793070890967` and `LIVE_DONE` in stdout. **No `results.jsonl` (FPS measurement not requested).**
- Native exe path `_Build/latest/native-build/kyty_emulator.exe`, GPU RTX 5070, `m04_00_00_00`; log `KYTY_TABLE_READONLY_PASS_SKIP=0 KYTY_TABLE_PREFETCH_DEDUPE=0 KYTY_TABLE_UNBOUNDED_LEVELS=1`, shader trial 0x3 off. Shader warmup 10291/10316 permutations, 1529/10407 pipeline recipes; initial warmup done beside game. No native stderr, not proof of pixel correctness.

## Counts: sampled **1 in 64 TableBlocks calls**

These are **sampled events per native flip** from `kind=12,a=0x7ab2a` and are NOT the complete full-population totals. Two queues measured independently, queue high bit 63 differentiates async.

| Sampled event/native flip | Graphics | Async |
|---|---:|---:|
| Sampled invocations | 76.86 | 17.87 |
| Completed invocations | 76.86 | 17.87 |
| Stages | 145.70 | 17.87 |
| Descriptors | 271.60 | 110.06 |
| Writable/atomic descriptors | 3.63 (1.34%) | **45.31 (41.17%)** |
| Read-only descriptors | 267.97 | 64.75 |
| Read-only reused | 251.24 (**93.76%**) | 60.94 (**94.12%**) |
| Read-only resolved | 16.73 | 3.81 |
| Writable `ObtainBuffer` calls | 3.63 | **45.31** |
| Final `upload.Copy` calls | 123.84 | 17.87 |
| Block bytes copied | 29192.03 | 6598.87 |
| Empty stages | 21.86 | 0 |

**Derived sampled ratios**:
- Writable obtains per sampled `TableBlocks`: graphics **0.0472**, async **2.5355**.
- Final uploads per sampled `TableBlocks`: graphics **1.6112**, async **1.0000**.
- Average bytes per upload: graphics **235.72 bytes**, async **369.27 bytes**. The copy path uses `StreamBuffer::Copy` → Map, `memcpy`, Commit.
- Invariants hold within export rounding: descriptors = writable + readonly; readonly = reused + resolved; writable obtains = phase1 timer calls; final uploads = phase2 timer calls; uploads + empty stages = stages; completed = sampled. In particular **both counters/timer pairs agree**, no missing G2-I fields.

## Sample-only time (NOT all TableBlocks CPU time)

`kind=12,a=0x7ab2b` aggregates native TSC intervals **only for the 1/64 selected invocations**; the exporter normalizes these sampled cycles per **all** 230 native flips. Directly comparing with an inclusive full-population scope is invalid; raw values must not be multiplied blindly by 64 as if unbiased causal improvement.

| Timer / sampled events per native flip | Graphics | Async |
|---|---:|---:|
| Writable `ObtainBuffer` timing | **0.0032 ms** across 3.63 sampled obtains | **0.0086 ms** across 45.31 sampled obtains |
| Final block upload timing | **0.0055 ms** across 123.84 uploads | **0.0010 ms** across 17.87 uploads |
| Approx sampled time per call | **~880 ns obtain, ~44 ns upload** | **~190 ns obtain, ~56 ns upload** |

Numbers are TSC-derived, rounded and instrumented; each call may differ by branch, bytes, lock waits, cache state, and address. The async writable acquisitions produce the larger **sampled cumulative elapsed contribution** of the two measured async operations despite low per-call average. Graphics upload is more frequent, but its individual measured cost is tiny and a blanket block upload batching rewrite risks changing order/ring timeline.

Existing inclusive `0x7ab21/2` TableBlocks under this Census: **1.9481 ms/flip graphics, 0.9874 async**. Nested `0x7ab1e/5` read-only resolve: **0.6723 / 0.0985**, nested `0x7ab1e/6` reproof: **0.0337 / 0.0166**. The parent minus those two *measured children* leaves **~1.2421 ms graphics, ~0.8723 ms async**, still contains many other callees and profiling overhead. Nested ring and fallback path inside resolve must not be subtracted again; sibling `TablePrepareBda` must not be subtracted. The prior user's G2-H sample had 1.8013/0.9784 ms TableBlocks and a different scene workload; no reliable FPS effect can be inferred.

## Source-informed G2-J research boundary

Actual source:

- `src/local/table-xpr.inc` `TableBlocks`: writable nonempty descriptor evaluates `buffer_cache.ObtainBuffer(address, size, true, formatted)`, **then** resets region epoch memo, validates owner with `GetBufferIfLive(FindBuffer(...))`, invalidates texture memory for formatted writes and constructs the five-word output. The writer executes before read-only handles in order to preserve GPU-write-before-read aliases.
- `src/graphics/host_gpu/renderer/cache/bufferCache.cpp` `BufferCache::ObtainBuffer` **already has a write memo** `m_write_memo` keyed by address/size/texel and registration/coverage epochs, with live owner/coverage bounds validation. On memo hit it still **must**: `DrainGuestReadback`, `TouchBuffer`, `InvalidateCopyFeedback`, `NoteGpuWrite`, and update live GPU-write counters. Misses also synchronize buffer and, for writes, extend GPU-modified range. These steps are not interchangeable or removable without reproducing observable memory/protection semantics. Do not add a second unguarded cache, bypass write tracking, or move callback ordering.
- `src/graphics/host_gpu/renderer/cache/streamBuffer.cpp` `StreamBuffer::Copy` does `Map`, `memcpy`, `Commit` and participates in scheduler watches/offset management. Aggregating final uploads across stages could change device addresses/order/watches; **not yet supported** by evidence.
- The PM4/QueueRun inclusive 16.49ms encompasses renderer work, not a 16.49ms parser-exclusive optimization budget.

**Recommended G2-J**: first audit codegen and existing `m_write_memo` hit/miss behavior *offline*; if an actual redundant **non-semantic** operation is found, prototype one reversible default-Off narrow test preserving readback drains, write marking, owner proofs, registration/coverage, texture invalidation, and per-write serialization. **Specific candidate from independent read-only review `agt_2ab08172`:** after `ObtainBuffer`, TableBlocks immediately calls `GetBufferIfLive(FindBuffer(address,size))` and compares to the returned owner. Explore whether a *validated owner ID* supplied through the existing `ObtainBuffer(..., id)` pathway or a rigorously equivalent returned ownership token can eliminate the second discovery without weakening the exact owner check. `GetBufferIfLive` alone is NOT a coverage/protection proof; `FindBuffer` may join overlapping buffers and replace owners. This is **a research candidate, not an admitted code change**. If offline evidence cannot prove it, use a sparse, census-gated **branch-frequency** diagnostic for memo hit / miss / invalid owner, pending readback, synchronization, and write annotations (no per-call timestamp, no additional guest memory probes), before any optimization. Never claim 41.17% writable share implies a 41% FPS gain.

**GO**: G2-I runtime diagnostics accepted; G2-J focused examination of async writable-ObtainBuffer repeated semantics. **NO-GO**: speculative memo cache shortcuts, dropping dirty/protection/readback checks, hoisting writes across stages, removing StreamBuffer::Commit or batching PM4. User preference: no Off baseline and no extra game run unless essential; current evidence permits offline work.

No third-party online research or game files were needed for this local analysis.
