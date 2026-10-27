# G3-B — Macro CPU→Vulkan→GPU critical-path capture integration (2026-10-27)

**Deployment update (same day):** After the original Launcher process closed, the G3-B package was successfully installed via `launcher-electron/scripts/package-latest.ps1` into the **canonical** `_Build/latest/launcher/DemonsSoulsLauncher-win32-x64/`. Packaged latest `--smoke-ui` confirmed `ELECTRON_SCENE_BENCHMARK_UI_PASS` with `gpuTimeline:true`, `ELECTRON_UI_SMOKE_PASS`, exit 0. No game was launched. The staged-only/EBUSY narrative below is historical and **no longer represents the deployment state**. Use only `.\launcher.cmd` to start the latest Launcher; do not use `_Build/g3b-staging` for builds or game runs. See `docs/HANDOFF_G3_MACRO_LATEST_LAUNCHER_2026-10-27.md`.

## Status / decision

**G3-B macro execution graph design + opt-in GPU timeline capture in Launcher: CODE, TESTS, STAGING PACKAGE and GUI SMOKE PASS. Real G3-B GPU timeline not yet captured.** No shader cache, saves, GPU-rendering algorithm, native emitter/PM4 or actual game execution was modified. The user's directive is **macro research only**. **G2-J and all speculative micro-optimizations remain deferred**; performance improvement not claimed.

Parent audit: `docs/G3A_MACRO_RENDER_PIPELINE_AUDIT_2026-10-27.md` at commit `eca755ca`. Latest user-run RTX 5070 1080p internal/4K output Standard shader, G2-H On: `session-C4lk7U`, 49.47 / 49.80 FPS (two 15 s windows in **one game boot**); producer CPU 19.04 / 18.80 ms/frame, record worker 14.76 / 15.04 ms/frame, render busy 94.2 / 93.6%. ~10,834 TableDraws, ~1,358 compute dispatches, 59 PM4 suspends, 57 requeues and ~31.6 async readbacks/frame. This **supports busy serial CPU work**, but cannot decide CPU-only or GPU bottleneck since producer, record worker and GPU overlap.

## Offline G3-B architecture findings

1. **One host CPU render producer** schedules guest graphics and async-compute submissions and runs resumable `ProcessPm4` with ordered guest-memory/fault/readback callbacks. Frame epoch, `WAIT_REG_MEM` suspends/requeues, dirty-page proof and write ordering are real semantic constraints. Async guest queue labels do not imply asynchronous host CPU execution.
2. **`Kyty.Record` is a second CPU thread** that replays captured Vulkan command calls and the deferred submission. It can run in parallel with the producer but is itself ordered. A low `record_wait_us` (0.2µs/frame in the captured scene) means producer seldom stalls *waiting for record chunks*, not that the driver records Vulkan calls at zero cost.
3. **Submission and GPU completion are separate events.** `vkQueueSubmit` delivery/driver tick is not a completed GPU tick. Readback transfers, upload lifetime, guest waits, and presentation may gate progress off the render thread. A CPU timer or `gpu_busy` predicate alone does not measure true hardware execution.
4. Prior `docs/GPU-DRIVEN-XPR.md` experiments on **different hardware and historical builds** discovered guest SRT values sometimes change **after command translation but before GPU executes it** (~7.6% of observed slot samples). A GPU-driven live-read rewrite may render wrong constant values unless it explicitly preserves translation-time snapshots. Earlier v4 GPU-driven shader additionally introduced ~4.3ms GPU pressure despite less CPU work. Avoid using historical FPS as RTX 5070 projection.
5. GPU trace tooling **already exists in native**: `src/local/live-control.h` supports `trace 2 PATH`; `src/local/live-trace.h` records submit/idle/readback/Flip and GPU command-buffer timestamp pairs; `commandScheduler.cpp` timestamps GPU TOP/BOTTOM and completion; `tools/local/live-trace.py` has `frames`, `frame`, `gpu` and optional `producers` analysis. **Prefer plain `trace`**, not heavy per-draw `tracem` or write-heavy `tracew`, as the first macro measurement.

## Shipped G3-B measurement UI

Only the Launcher/Node side changed:

- `launcher-electron/scene-benchmark.cjs`: new `gpuTimeline(session)`, **strict explicit opt-in**, fixed **2 seconds**, default **5-second focus handoff**, and at most one concurrent FPS/Census/Timeline command. Uses the pre-existing session-scoped `KYTY_LIVE_FILE` command handoff; native command is exactly `sleep 5\ntrace 2 <session-unique-trace-path>\n`. Does **not** invoke the game automatically.
- Successful `LIVE_TRACE id=<id> records=<count> tsc_hz=<hz> path=<path>` and the *matching* `LIVE_DONE id=<id>` must both be observed in the bound native stdout. Reject missing/duplicate headers, wrong ID, spoofed path, missing or bad binary size, wrong record count, oversized binaries (4,194,304 records × 32 bytes = 128 MiB limit), invalid TSC frequency, game exit and concurrent capture. Paths with spaces/over native parser length are rejected upfront rather than creating a misleading trace. Unlike FPS/Census, it does **not** need any new native build.
- On success, the **raw native binary** is preserved at `_Build/scene-benchmark/session-*/gpu-trace-<id>.bin`; its precise native TSC Hz is saved to `gpu-trace-<id>.bin.hz` (needed by the existing Python decoder). Metadata is appended to `gpu-timeline-results.jsonl`. On failure, no **successful** trace report or Hz companion is claimed. Existing FPS/Census JSON and game state are never changed.
- `launcher-electron/preload.cjs` and `main.cjs`: new IPC handler `launcher:benchmark-gpu-timeline`, permitted only for the active trusted benchmark window with a running game; status includes `gpuTraceResults`, capture serialized with FPS/Census.
- `launcher-electron/benchmark.html` and `benchmark.js`: explicit **GPU Timeline (2s)** button, separate latest raw-trace result, disabled when game/handshake is unavailable. Status warns that this is a hardware/CPU scheduling trace, **not an FPS sample or speedup**.
- `launcher-electron/tests/g3b-gpu-timeline.test.cjs`: 5 tests exercise header parsing, session data, exact ID/Hz, serialization, fake native response, malformed/spoofed files, cancellation on exit, IPC/GUI wiring. These synthetic tests do **not** simulate Vulkan or assert real timestamp correctness.

## Acceptance evidence

- Targeted G3-B tests: **5/5 PASS**.
- Full `cd launcher-electron && npm test`: **135/135 PASS**.
- Node `--check` source sanity and git whitespace: **PASS**.
- Existing native emulator binary retained untouched: `_Build/latest/native-build/kyty_emulator.exe` timestamp **2026-10-27 10:08** (G2-I).
- Native compile, runtime game boot, real GPU trace: **NOT run** because no native modification and explicit user-controlled gameplay.
- `launcher-electron/scripts/package-latest.ps1` encountered **EBUSY** because the original latest Launcher was *actively running* (observed `DemonsSoulsLauncher.exe` parent PID 14236 + child renderer/GPU process). Deliberately **did not kill the user's Launcher** or overwrite its executable.
- Equivalent electron-packager command completed successfully into **separate staging folder** `_Build/g3b-staging/launcher/DemonsSoulsLauncher-win32-x64`, exit 0. Staged executable `--smoke-ui` with `KYTY_PROJECT_ROOT` set to repository root passed **ELECTRON_SCENE_BENCHMARK_UI_PASS** with GPU Timeline bridge, button and disabled-state; full **ELECTRON_UI_SMOKE_PASS**, exit 0. Full diagnostic tests pass. This staged binary is **not yet installed over `_Build/latest/launcher`**.
- Existing untracked local/game/backup files preserved; no shader precompile or cache copy.

## One On-only GPU timeline (future user action, only when ready)

**The original already-running Launcher remains the old package and does not have the GPU Timeline button.** When it is closed naturally (do not force-close ongoing tasks), rerun `launcher-electron/scripts/package-latest.ps1` to populate the canonical `_Build/latest/launcher` path; this is a packaging operation only. Alternatively the **staged** executable can be started directly via its path if the user has closed the previous Launcher. The user does **not** need an Off baseline, multiple game boots or shader precompile to collect this.

After opening the updated Launcher and starting their usual stable game settings (Shader Standard 0x0, G2-D/G Off, G2-H On if they wish to retain the current research configuration), ensure Scene Benchmark On. In Boletaria 1-1 after warmup, click **GPU Timeline (2s)** **once**, return to the game during the 5s handoff. No FPS or CPU Census necessary. Inspect `gpu-timeline-results.jsonl` and the associated trace `*.bin` + `*.bin.hz`.

Offline after a real capture:

```powershell
cd "C:\Users\hoang\Desktop\dev\KytyPS5"
python tools\local\live-trace.py frames "<full-path-to-gpu-trace.bin>" --detail 6
python tools\local\live-trace.py gpu "<full-path-to-gpu-trace.bin>" 2 --span 34
python tools\local\live-trace.py frame "<full-path-to-gpu-trace.bin>" 2 --span 34
```

The existing decoder computes GPU span interval **union** within native-flip windows, maps GPU timestamp period to TSC using available completion ticks, and identifies render-idle gaps, PM4 wait sites and GPU-submit timing. IMPORTANT: the GPU-to-host clock alignment is an **approximation** based on completion observations; TOP/BOTTOM GPU spans may include stalls and timestamps on the measured graphics scheduler **do not cover all transfer/presentation queues**. Missing spans or fewer than three flip markers make classification inconclusive. Do not assume GPU work from multiple queues can be simply added.

**G3-B next-decision gate:**
- Repeated GPU gaps while render producer is busy and submit lagging ⇒ P0 macro producer/resource pipeline / P1 recording concurrency.
- Continuous relevant GPU execution with ready submissions backlog ⇒ GPU pass scheduling/shader bandwidth / possible GPU-bound.
- Short GPU bursts separated by guest wait, async readback, upload or presentation handoff ⇒ investigate the dependency graph (P1), with causal ordering preserved.
- Trace lacks valid span/flip alignment ⇒ **UNKNOWN**, no rewrite admitted; consider a single bounded Nsight Systems Vulkan queue capture in a separate phase if actually useful.
- Startup/streaming hangs/compilation spikes require a different **1% low/hitch** audit than steady-state FPS.

**NO-GO** for unmeasured PM4 batch increases, unsafely removing barriers, asynchronously moving guest-memory dependent reads, skipping owner/protection checks, extending host recorder chunk counts by guesswork, or default-on macro feature changes from this report alone.

## G3 roadmap

| Phase | State |
|---|---|
| G3-A | Offline CPU→GPU execution and ordering audit COMPLETE (commit eca755ca) |
| **G3-B1** | Macro queue critical-path plan + opt-in 2s GPU timeline **built/tested in staged Launcher**; real GPU timeline PENDING |
| G3-B2 | GPU-vs-CPU-vs-sync decision, based on real trace **PENDING** |
| G3-B3 | One reversible, correctness-proven architectural optimization **NOT YET ADMITTED** |
| G3-C | Native FPS/1% low/hitch + representative geometry, fog, effects and 13-world validation **PENDING** |

The purpose is *macro* improvement of the time to complete the entire frame, not optimizing a few CPU nanoseconds in hot helper functions.
