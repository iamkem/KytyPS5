# HANDOFF — Demon's Souls Remake PC / KytyPS5 — G3 Macro Pipeline (2026-10-27)

**Use this file as the authoritative resume checkpoint in the next ChatGPT session.**

## 0. USER RULES — STRICT, NOT OPTIONAL

1. **FOCUS ON MACRO (VĨ MÔ) ONLY.** Investigate frame-wide CPU→PM4→Vulkan recording→GPU execution→readback/present critical paths, GPU/CPU queue overlap, high-level resource-preparation duplication and architectural batching with exact correctness dependencies. **Do not resume G2-J or speculative micro-optimizations**: no prefetch/small-read/owner-lookup nanosecond tweaks, no extra experimental per-run branches, no timer proliferation without critical-path need. Prefer a few material architecture hypotheses with real evidence.
2. **BUILD ONLY INTO THE CANONICAL LATEST TREE, NEVER A STAGING / SIDE BUILD.**
   - Native CMake build directory **ONLY**: `C:\Users\hoang\Desktop\dev\KytyPS5\_Build\latest\native-build`.
   - Native executable produced by that build: `_Build/latest/native-build/kyty_emulator.exe`. It is a **build artifact, not a user/game launch entrypoint**.
   - Packaged Launcher output **ONLY**: `_Build/latest/launcher/DemonsSoulsLauncher-win32-x64/`.
   - Do **not** build or package into `_Build/g3b-staging`, `_Build/test`, `_Build/bench`, any worktree's build folder, temporary build trees, or alternate launch packages. An old G3-B staging folder exists from a previous session; **do not use it**. Do not delete it without need/permission either.
   - Never rebuild shaders / perform heavy game shader precompile unless user explicitly authorizes. Preserve all existing shader caches, saves, game installation and prior outputs.
3. **ALL GAMEPLAY/RUNTIME GAME LAUNCHES MUST GO THROUGH THE LAUNCHER.**
   - Correct Windows PowerShell user command, **always reproduce when asking for a game test**:
     ```powershell
     cd "C:\Users\hoang\Desktop\dev\KytyPS5"
     .\launcher.cmd
     ```
   - The Launcher starts the game via its Play button; do **not** launch `kyty_emulator.exe` directly, invoke `run-windows.ps1` independently, or use a staging executable for game tests. Offline decoders, compilation, unit tests and packaged **Launcher UI smoke** are okay; do not conflate launcher smoke with a real game run.
   - The user personally starts the game and observes visuals. Do not force-close an ongoing Launcher/game. If the latest Launcher exe is in use, wait until the user naturally closes it before packaging into `_Build/latest` (do not kill it or fall back to staging).
4. **NO FRESH OFF BASELINE OR REPEATED A/B REQUESTS.** User explicitly wants **On-only** investigations and minimal game boots; ask for a real GPU timeline only if needed, and one capture in one manually launched game. Do not request 4-boot ABBA.
5. Autonomously inspect, research, use **read-only independent DevSpace subagents** when useful, implement well-grounded authorized changes, tests, commit/push. Only ask user for their physical gameplay test, destructive or high-risk operation, or genuinely necessary permission. Subagents **read/analyze only**, not source edits; main assistant owns changes. Do not make speculative default-On changes.
6. Never remove, overwrite, stage or "clean" untracked user/private local assets. Current untracked items to preserve:
   ```text
   Steam_DemonsSouls_Launcher.bat
   _SaveData.rar
   docs/HANDOFF_GRAPHICS_OPTIMIZATION_2026-10-25.md
   docs/HANDOFF_MODS_MANAGER_V6_2026-10-22.md
   tools/local/static-precompile/archive-incomplete-shards.ps1
   tools/local/static-precompile/hints-PPSA01341_01.007.000.hints.backup-20261024
   ```

## 1. Workspace and Git checkpoint

- **DevSpace Windows tool**, current workspaceId `ws_b144bfb5f5` (reuse it for the same directory; if it expires, open the exact checkout).
- Actual checkout: `C:\Users\hoang\Desktop\dev\KytyPS5`.
- Git remote: `https://github.com/iamkem/KytyPS5.git`.
- Active branch: `integration/chenxiao-v20261023b-20261023`.
- **Last feature checkpoint before this handoff: `f1a95839`** — `feat(graphics): add opt-in G3-B macro GPU timeline capture in Launcher`.
- Prior research commit: **`eca755ca`** — G3-A macro CPU/GPU pipeline audit.
- Latest G2-I result report commit: `f2b79615` — G2-I live census / G2-J candidate (**G2-J now DEFERRED**).
- Stage only explicit new G3 handoff / source files; push to current branch after verification, do not switch to an older PortPS5 repo or experiment/worktree.

Use the DevSpace Windows connector. In this environment `bash` is allowed for **read-only git/search, tests, canonical builds and package scripts**; **modify source/docs using DevSpace `write` / `edit` actions**, never bash redirection/sed scripts to edit files.

## 2. G3-A completed research — what is actually known

Read `docs/G3A_MACRO_RENDER_PIPELINE_AUDIT_2026-10-27.md` first.

Recent RTX 5070, Demon's Souls 1-1 map `m04_00_00_00` G2-H On-only Standard shader 0x0 benchmark, two **15 s** FPS samples in **one** native game boot: `_Build/scene-benchmark/session-C4lk7U/results.jsonl`.

| Metric per native Flip | Measurement |
|---|---:|
| Average FPS | **49.47 / 49.80**, mean **49.64** |
| Implied frame wall interval | ~20.15 ms |
| Render producer CPU time | **19.04 / 18.80**, mean **18.92 ms** |
| Vulkan recording worker CPU time | **14.76 / 15.04**, mean **14.90 ms** |
| Render producer busy | **94.2% / 93.6%**, mean **93.9%** |
| Logical `table_draws` | ~**10,834/native flip** |
| Table compute dispatches | ~**1,358/native flip** |
| Guest PM4 suspend / requeue | ~**59 / 57 per flip** |
| Async readbacks | ~**31.6/flip** |
| Guest callbacks / submission slices | ~**119.7 / 93.1 per flip** |

**Critical limitations:** `render_ms` and `record_ms` are CPU time of concurrent threads; never sum them as frame latency. `render_busy` is **NOT GPU utilization**. `QueueRun` CPU Census (~16.49ms graphics + ~4.42ms async inclusive) contains nested renderer work, not parser-exclusive overhead. Existing GPU execution/busy **was not measured on this RTX 5070 run**. Presentation 60Hz cap does not by itself explain ~50 FPS. Historic prior builds/other GPU evidence is not a matched benchmark.

### Architectural work graph verified

```text
PS5 AGC submission, graphics + compute
  → GuestGpu submission queues / guest epoch
  → SINGLE host render CPU producer: resumable PM4 Execute
      → ordered callbacks / guest faults / readbacks / WAIT_REG_MEM
      → compatible native draw batches (already up to 64)
      → TableTry / TableContinue / TableDraw
      → immutable shader plan + live guest SRT reads + buffer/image proofs
      → Vulkan command emission and CommandScheduler
  → separate ordered Kyty.Record CPU worker
      → replay Vulkan recording stream + driver API
      → deferred vkQueueSubmit and timeline
  → GPU graphics execution + compute / transfer dependencies
  → flip-ready callback, video-out / swapchain present thread
```

No safe simplification of callback ordering, GPU-write ownership, BDA/page mapping proofs, image transitions, staging lifetime, semaphores or guest-memory translation-time snapshot semantics without a full correctness argument. `docs/GPU-DRIVEN-XPR.md` documents historical GPU-driven experiments with SRT snapshot drift (~7.6% sampled slot values) and failures such as missing geometry, particle corruption/device loss; do not resurrect a naive all-GPU live-read plan.

**Macro ranking**:
- P0: serial CPU producer **whole-frame work**, with ~10.8k logical table draws and high CPU occupancy.
- P1: Vulkan recorder/driver throughput and potential overlap (record worker ~14.9ms), not conclusively critical because producer recorded `record_wait_us` only ~0.2 microseconds/flip.
- P1: guest compute/readback WAIT dependencies and submission fragments; counts ≠ GPU idle duration.
- P2: GPU shader/pass throughput **only if actual GPU timeline supports saturation**.
- Separate track: loading/streaming shader/pipeline first-use hitches vs steady FPS.

## 3. G3-B new capability — now correctly installed under _Build/latest

Read `docs/G3B_MACRO_GPU_TIMELINE_CAPTURE_2026-10-27.md`.

**Code commit `f1a95839`:** Launcher gained **GPU Timeline (2s)** in the Scene Benchmark window. It uses the existing native **plain trace**, not heavyweight `tracem`:
- native command via session-scoped `KYTY_LIVE_FILE`: `sleep 5\ntrace 2 <unique-session-path>\n`, user remains in game.
- Strict same-ID matching of `LIVE_TRACE` and `LIVE_DONE`, validates trace binary size/record count and TSC Hz, serializes against FPS/Census.
- Result stored under `_Build/scene-benchmark/session-*/gpu-trace-<id>.bin`, matching `.bin.hz`, and `gpu-timeline-results.jsonl`.
- **Real G3-B GPU trace NOT captured yet**. No CPU-only or GPU-only bottleneck classification claimed.

**IMPORTANT POST-G3B PACKAGING FIX VERIFIED THIS SESSION:** Previous G3-B report says packaged **only to `_Build/g3b-staging`** because original Launcher was busy. That report is now **outdated about deployment**: after processes closed, latest Launcher was **successfully packaged into `_Build/latest/launcher/DemonsSoulsLauncher-win32-x64`** using the canonical `launcher-electron/scripts/package-latest.ps1` script. The packaged **LATEST** Launcher `--smoke-ui` returned **`ELECTRON_SCENE_BENCHMARK_UI_PASS` with `gpuTimeline:true`, `ELECTRON_UI_SMOKE_PASS`, exit code 0**. It is **ready from `.\launcher.cmd`**; do **not** use staging. An unrelated nonfatal `SCREENSHOT_UNAVAILABLE main: UnknownVizError` appeared during smoke; all behavioral controls passed.
- Last native binary is unchanged from G2-I (built Oct 27 ~10:08) because **G3-B is Launcher-only**; do not rebuild native unnecessarily.
- Tests from G3-B: **135/135 Node tests PASS**; 5 targeted GPU Timeline tests PASS.
- Experimental Shader 0x3 cache recognized READY but never recompiled. Do not enable it without reason.
- The latest Launcher GUI smoke observed **G2-D Off, G2-G Off, G2-H On saved**; retain Standard shader 0x0 for comparable diagnostics. G2-H On is a *research setting*, not certified default performance improvement.

## 4. Canonical commands only

To inspect/reuse project via DevSpace Windows: workspace `ws_b144bfb5f5`, checkout above.

**Allowed, only when native source actually needs rebuild:**

```powershell
cd "C:\Users\hoang\Desktop\dev\KytyPS5"
cmake --build "_Build/latest/native-build" --target kyty_emulator --parallel 1
```

Verify existing `_Build/latest/native-build/CMakeCache.txt` has `KYTY_LLD_THINLTO_JOBS:STRING=2` **before full native link**. Do not increase Ninja concurrency or ThinLTO backend jobs, preserve RAM. Do not run another CMake configure that moves the build output. Do not use an alternate `_Build` folder.

**Allowed, only when Launcher source changed, or old latest package is missing:**

```powershell
cd "C:\Users\hoang\Desktop\dev\KytyPS5"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "launcher-electron\scripts\package-latest.ps1"
```

Close Launcher naturally first to avoid Windows file locks. This script targets **only** `_Build/latest/launcher`.

**Run game ONLY via Launcher:**

```powershell
cd "C:\Users\hoang\Desktop\dev\KytyPS5"
.\launcher.cmd
```

Then click **Play** in Launcher. For real benchmarks, only the user operates gameplay; assistant analyzes session-scoped files after user says `xong`. **No `kyty_emulator.exe` direct invocation or alternative game run path**.

`cd launcher-electron && npm test` checks Launcher source; UI smoke may be run using the packaged latest Launcher with `--smoke-ui` (this only validates UI, does not start the game). Never claim smoke is an actual GPU trace.

## 5. Recommended next session sequence (G3-B2 / G3-B3)

1. **Start by reading this handoff plus G3-A and G3-B docs**, check Git branch/status, check newest `_Build/scene-benchmark/session-*` for GPU timeline results before requesting any game interaction. If a valid trace already exists, analyze it **offline immediately**.
2. Reuse the **existing** `tools/local/live-trace.py` decoder; interpret GPU timestamp interval unions, producer/recorder handoff gaps, PM4 WAIT suspend/resume and readback timeline. Do not invent GPU busy percentages when trace missing or GPU/host clock alignment weak.
3. If no G3-B trace exists **and needed to classify critical path**, ask for exactly **one On-only, warmed GPU Timeline (2s)** user capture via the now-installed **latest Launcher**. No Off baseline, no 4 game boots, no CPU Census/Measure FPS required simultaneously. Use GPU Timeline button in Scene Benchmark; return to game after click during five-second handoff. Ensure **Scene Benchmark On** and Standard shader 0x0. Do not proactively open the game yourself.
4. Result binary path `_Build/scene-benchmark/session-*/gpu-trace-<id>.bin`, frequency `*.bin.hz`, metadata `gpu-timeline-results.jsonl`. Example offline decoder (replace with actually verified path):
   ```powershell
   cd "C:\Users\hoang\Desktop\dev\KytyPS5"
   python tools\local\live-trace.py frames "<actual-full-gpu-trace.bin>" --detail 6
   python tools\local\live-trace.py gpu "<actual-full-gpu-trace.bin>" 2 --span 34
   python tools\local\live-trace.py frame "<actual-full-gpu-trace.bin>" 2 --span 34
   ```
5. **Choose one macro engineering target based on evidence**:
   - GPU has repeated idle gaps awaiting producer ⇒ redesign coarse-grained serial producer/recorder scheduling and only provably immutable resource-plan preparation.
   - Relevant GPU execution continuous, CPU-ready queue backlog ⇒ GPU pass/compute/texture-bandwidth bottleneck; use **short bounded Nsight GPU trace** only if indispensable.
   - GPU bursts bracketed by guest WAIT/readback/flip dependencies ⇒ pipeline dependency/queue scheduling architecture without violating guest visibility or causal order.
   - Valid alignment insufficient ⇒ result **UNKNOWN**; improve timestamp/queue coverage only with explicit invariants and short captures, don't implement speculative batching.
6. An architecture change **must be opt-in/default Off, fully reversible, preserve memory/image/pipeline correctness and get visual/scene regression approval**. Measure user-visible FPS and tails **after** a justified change, respecting On-only preference and the user's aversion to multiple test boots. Prioritize critical-path reduction, not per-call cycles.
7. Write a G3-B2 decision report with source paths, caveats, next gate; commit/push only explicit files. **No micro-tuning G2-J revival.**

## 6. Acceptance/status for the next assistant

| Milestone | Current state |
|---|---|
| G2-D/E/F/G/H/I | Completed source/diagnostics research, mixed or unproven FPS results; all default-off trials remain experiments |
| G2-J owner lookup micro patch | **DEFERRED by user request** |
| G3-A macro critical-path audit | **COMPLETE** (offline, `eca755ca`) |
| G3-B1 GPU Timeline Launcher UI | **IMPLEMENTED** (`f1a95839`), **NOW INSTALLED IN _Build/latest**, **UI SMOKE PASS** |
| G3-B2 real CPU↔GPU queue timeline | **PENDING one real trace, only if user elects capture** |
| G3-B3 one validated macro architecture optimization | **NOT YET ADMITTED** |
| G3-C FPS/1%-low/hitch + pixel/13-world consistency | **PENDING** |

**Do not** equate thread CPU busy with GPU occupancy; do not count nested inclusive scope time as a separate additive overhead; do not use historical 5090 experiments as RTX 5070 current measurements; do not claim raw event reductions give FPS gain; do not skip guest-memory snapshot/protection checks to force CPU savings.

**Most important user instruction to retain:** *Từ nay chỉ nghiên cứu/tối ưu vĩ mô; mọi build chỉ trong `_Build/latest` và mọi lần chạy game phải qua `.\launcher.cmd`/Launcher. Không chạy game trực tiếp từ emulator và không yêu cầu baseline Off.*
