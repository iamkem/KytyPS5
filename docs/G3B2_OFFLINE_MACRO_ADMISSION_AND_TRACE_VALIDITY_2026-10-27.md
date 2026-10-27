# G3-B2 — Offline macro bottleneck admission / GPU trace integrity (2026-10-27)

**Decision: G3-B2 classification = UNKNOWN / BLOCKED ON CORRELATED GPU EXECUTION.** Offline review and trace-tool semantic correction are complete. **No renderer/PM4/Vulkan-native change admitted.** This is an evidence-gate result, not a performance win or a claim that the game is CPU-bound. G2-J remains DEFERRED.

## Scope, provenance and preservation

- Checkout `C:\Users\hoang\Desktop\dev\KytyPS5`; branch `integration/chenxiao-v20261023b-20261023`; resume HEAD `dbf40855`.
- Authoritative input: `docs/HANDOFF_G3_MACRO_LATEST_LAUNCHER_2026-10-27.md`, `docs/G3A_MACRO_RENDER_PIPELINE_AUDIT_2026-10-27.md`, `docs/G3B_MACRO_GPU_TIMELINE_CAPTURE_2026-10-27.md`.
- Read-only inventory: 17 `_Build/scene-benchmark/session-*` directories; no `gpu-timeline-results.jsonl`, `gpu-trace-*.bin` or `*.bin.hz` in existing scene benchmark sessions, nor any trace binary found in the searched `_Build` tree. Recorded `LIVE_DONE` events in run logs correspond to pre-existing FPS/Census measurements; no `LIVE_TRACE id` found in searched run logs. An absent artifact is **not** a measured idle GPU.
- Verified canonical packaged executable exists at `_Build/latest/launcher/DemonsSoulsLauncher-win32-x64/DemonsSoulsLauncher.exe`; native CMake cache keeps `KYTY_LLD_THINLTO_JOBS:STRING=2`.
- No game launched, no native compile, no Launcher repack, no staging build, no cache rebuild; all untracked personal/backup assets retained unchanged.

## Existing scene evidence; what it does and does not prove

Same-boot RTX 5070 Standard shader 0x0 (`session-C4lk7U/results.jsonl`): two 15 s windows at 49.47 / 49.80 native flips/s (mean 49.64; ~20.15ms wall period). Render producer **19.04 / 18.80ms thread CPU/flip** (mean 18.92); `Kyty.Record` worker **14.76 / 15.04ms thread CPU/flip** (mean 14.90). Producer busy ~93.9%. ~10,834 Table draws, ~1,358 Table dispatches, 59 guest PM4 suspends, 57 requeues and 31.6 async readbacks per native Flip. Producer `record_wait_us` ~0.2us/flip. G2-H On is a research setting, not certified default.

**Valid deduction:** busy serial producer and substantial Vulkan recording work make CPU-side pipeline pressure a high-priority **hypothesis**. Producer and recorder CPU times overlap; **do not add** 18.92 + 14.90 as latency, and neither number describes RTX 5070 hardware utilization. Guest WAIT/readback counts do not establish time actually blocked. `record_wait_us` measures record-stream backpressure, not driver's Vulkan work time. FPS below the configured 60Hz cap does not identify the limiting component.

## Actual trace markers and newly verified semantics

- `src/graphics/guest_gpu/graphicsRun.cpp`: one host producer interleaves guest render and async-queue slices; `RenderIdle` indicates explicit empty/blocked scheduler waiting, `FrontSuspend` is a point-in-time guest WAIT indication, not a paired duration; `FlipSubmit` denotes native producer Flip, **not display scanout**.
- `src/graphics/host_gpu/renderer/context.cpp:ReplayBegin`: if tracing is active, TOP_OF_PIPE timestamp goes into the command buffer. `src/graphics/host_gpu/renderer/commandScheduler.cpp:ReplaySubmit`: BOTTOM_OF_PIPE timestamp is written before end/submit; TickMon reads the query after the associated GPU timeline semaphore tick. A timestamp span is a command-buffer elapsed range, may include hardware stalls and is not whole-GPU utilization; separate transfer/present work is not fully covered.
- Crucial correction: `GpuSubmit(tick, 1)` is recorded **immediately after `AsyncUpload::Wait` and before `vkEndCommandBuffer`, queue mutex and actual Vulkan `QueueSubmit`** in `commandScheduler.cpp:ReplaySubmit`. It is a **record-worker replay start**, not the instant that work reached the driver/GPU queue. The CPU producer `GpuSubmit(tick, 0)` is an enqueue-side marker. `m_driver_tick` updates after the actual submit returns; that also is not GPU completion.
- `tools/local/live-trace.py` formerly printed the worker marker as `queued`; corrected to `replay_start` with semantic comments. This is an **offline decoder labeling correction**, with no tracing/native/render behavior change.
- Decoder GPU-to-host alignment uses `min(host TickDone - GPU timestamp end)`, **not a calibrated clock-pair**. Unknown monitor observation latency shifts the absolute offset; GPU durations are more reliable than exact cross-clock gap edges. GPU/host clocks may have drift; retain clock uncertainty. `frames` uses union of GPU spans per Flip, not a measured full-device busy %; queue classification is by the guest slice responsible for scheduling the submit, not true independent engine occupancy.
- `producers` requires `tracew` writes and heuristic range matching; a first `trace 2` deliberately does not claim producer-of-readback certainty. `tracem` is heavyweight and not part of the first capture. Do not infer zero GPU work from missing timestamp spans; reject malformed/short captures.

## Macro hypotheses and the decision gate

| Candidate | What existing data suggests | Evidence required for admission |
|---|---|---|
| **P0 producer-side serialized PM4 / resource preparation** | ~19ms render-thread CPU per ~20ms Flip, high draw/dispatch density | Repeated GPU command-buffer gaps while render producer is actively generating command work, and no already-queued backlog capable of feeding the GPU; confirm submission/replay timing uncertainty |
| **P1 recorder/driver handoff** | ~15ms separate recorder CPU; almost no producer record-queue backpressure | Evidence that replay/driver submission is the late stage, rather than GPU execution; the `replay_start` marker alone is **not** `vkQueueSubmit` |
| **P1 guest GPU/CPU sync, readback, PM4 suspension** | ~59 WAIT suspends, ~32 readbacks per Flip | Repeated bursts and delays correlated with guest readback waits / guest completion, not merely high event counts; preserve guest memory semantics and queue ordering |
| **P2 GPU pass throughput** | Unknown because no current RTX 5070 GPU spans | Sustained command-buffer GPU intervals with work supplied and no meaningful producer starvation; optionally targeted pass study only after that |
| **Separate frame-tail/loading** | Historical pipeline compilation/streaming hitches | Different hitch-oriented benchmark, not interchangeable with steady 1-1 FPS |

**GO:** continue diagnosis of macro critical path. **NO-GO:** raise PM4 batching speculatively; create concurrent recorder threads; eliminate barriers or readback waits; move guest SRT reads to later GPU time; change cache/lifetime or promote a default-On rendering optimization. Prior historical GPU-driven live-SRT work documented translation-versus-execution value drift and visual failures (`docs/GPU-DRIVEN-XPR.md`); correctness is a blocking invariant.

## Minimal next evidence: one optional On-only GPU Timeline (2s)

A genuine GPU trace **is now necessary to close the CPU/GPU/sync classification**; further static-only passes over the same counters will not resolve it. The current latest Launcher already has the button per G3-B deployment smoke; do **not** build again to request this data.

The user, when convenient, opens PowerShell:

```powershell
cd "C:\Users\hoang\Desktop\dev\KytyPS5"
.\launcher.cmd
```

Click **Play** in Launcher, keep Standard shader 0x0 / current On-only G2-H research configuration, enable Scene Benchmark, warm the 1-1 scene, and click **GPU Timeline (2s)** once. Return to gameplay during the **5s handoff**; do **not** run FPS/Census simultaneously, reboot for Off baseline, precompile shaders, or run the native executable directly. User signals completion; analysis remains offline. A complete result has session-matched `LIVE_TRACE` and `LIVE_DONE`, `gpu-timeline-results.jsonl`, same-ID `gpu-trace-*.bin` and `.bin.hz` with verified count/frequency.

Then, using the **actual verified file path** and the decoder (no new game run):

```powershell
python -B tools\local\live-trace.py frames "<actual-trace.bin>" --detail 6
python -B tools\local\live-trace.py gpu "<actual-trace.bin>" 2 --span 34
python -B tools\local\live-trace.py frame "<actual-trace.bin>" 2 --span 34
```

Check sufficient flip markers, valid non-wrap GPU spans, aligned tick IDs and plausible submission/replay/complete order before drawing conclusions. If clock calibration or queue coverage is inadequate, report **UNKNOWN** and choose one bounded validity improvement—not a renderer rewrite.

**Checkpoint:** G3-B2 offline admission/decoder-semantics complete, classification OPEN; G3-B3 renderer optimization NOT admitted; G3-C native FPS, 1%-low, image/world correctness pending. No extra Off baseline or multi-boot A/B required.
