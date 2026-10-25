# KytyPS5: world pipeline sweep independent of RAM Safety / RAM Diet (2026-10-25)

## Decision

The world-transition **scene sweep** is enabled only when reported installed physical RAM is known and `<=20 GiB`. On hosts with more than 20 GiB (including this PC's 40 GB), scene sweeps remain disabled whether RAM Safety (`KYTY_ADAPTIVE_RAM`) and RAM Diet (`KYTY_RAM_DIET`) are ON or OFF. If the host RAM query fails (zero), err on the side of **not** doing a mass world sweep. This is a narrow change to the previous `!MemoryPressure::Enabled()` scene-sweep guard, not a wholesale upstream pipeline policy merge.

## Independent controls preserved

- `KYTY_RAM_DIET=1`: **still** makes *idle* pipeline eviction eligible under the existing 180-second default (and retires replaced unoptimized driver pipelines); this change does **not** make a 40 GB PC retain every idle pipeline. It also does not turn world sweeps on.
- VRAM pressure: current budget/margin and per-scan quota policy are unchanged.
- `KYTY_PIPELINE_EVICT=0`: existing early return continues to disable policy-based pipeline eviction. `KYTY_PIPELINE_EVICT=2` retains its test behavior.
- `KYTY_ADAPTIVE_RAM=1`: shader prefetch throttling, backing behavior and adaptive texture retirement are unchanged. It does not influence world sweep admission or pipeline eviction age.
- Worlds *just left* retain the pre-existing protection through `m_prev_scene_flip` if world sweeps are enabled on low-RAM machines.
- No texture offload, guest page discard, pipeline cache deletion, save modification, or game launch is involved.

## Verification

`src/local/pipeline-sweep-policy.h` has compile-time RAM-threshold assertions, including unknown, 8/16/20, above-20 and 40 GiB cases. `launcher-electron/tests/ram-safety-decoupling.test.cjs` checks the native source wiring and independent launcher flags. Validate via `node --test launcher-electron/tests/*.test.cjs` and isolated-worktree Windows native build. FPS, memory pressure and gameplay stability require separate user-initiated runtime testing; a clean build alone does not prove performance gains.
