# chenxiao07 v20261025 selective A/B integration — 2026-10-25

## Branch and scope

- Integration worktree only: `KytyPS5-93e7e50d`, branch `integration/chenxiao-v20261023b-20261023`, base `eb0c89e5`.
- Upstream branch `chenxiao07/KytyPS5:experiment/perf-40fps-20260926` at `baf00e31` when selected.
- No game executable, launcher settings, existing shader caches, saves, main checkout, or user-provided files are touched by cherry-picks.

## Group A (integrated, standard behavior)

1. `c2ae8e84` static pipeline store translation-feature stamp after quick merge into a **fresh** store; do not clear or rebuild existing stores just for this patch.
2. `1a7b1790` + `01523253` Demon's Souls reported direct memory: base PS5 12 GiB rather than prior 12.5 GiB; `KYTY_DIRECT_MEMORY_MB=0` preserves original ceiling if regression is diagnosed. Other games keep their pre-existing ceilings.
3. `88f8b5a0` host kept-file closing: last-read idle timeout 10 s by default (`KYTY_FILE_IDLE_CLOSE=0` restores old handle-retention behavior). Active readers are tracked to prevent close mid-read.

## Group B (integrated, gated / NOT automatically active)

- `5a231c6e` Engine Free Giveback logic was brought over, including game allocator/free-list detection and Windows discard implementation.
- Fork safety changes: `KYTY_ENGINE_FREE` defaults to **Off regardless of installed RAM** (upstream enabled giveback automatically at or below 20 GiB). `walk`/`count` are opt-in diagnostic modes. `giveback`/`1` is **rejected** when `KYTY_BACKING_FILE` requests a sparse file-backed mapping. The launcher normally uses that backing, so the destructive feature is effectively disabled on the user's normal configuration.
- Ported the upstream hot-read unlock dependency as `DropHotReadsBacking` in `src/kernel/memory.h`, `memory.cpp`, and `memoryAddressSpace.inc`, so an opted-in GiveBack attempts to release backing page locks before discard. This was required for the native build; it does not certify runtime concurrency or data safety.
- These controls are precautionary, not proof that `DiscardVirtualMemory` is correct with any other backing configuration. Do NOT activate Giveback for a routine performance test. Prior file-backed discard experiments returned `ERROR_USER_MAPPED_FILE` (1224) with unsafe byte behavior; user has experienced `MEMORY_MANAGEMENT` BSOD in earlier shader/memory sessions.

## Texture offload compatibility

- `0f832181` default-off policy integrated manually around fork's existing file-backed-mapping block. `KYTY_TEXTURE_OFFLOAD=1` remains opt-in and is still blocked with `KYTY_BACKING_FILE`; probe may be used independently if required by future supervised experiments. Upstream reports black textures/hair corruption and restore stalls on low-RAM PCs with offload enabled.

## Validation and rollout gate

- Source-contract Node tests under `launcher-electron/tests/chenxiao-memory-20261025.test.cjs` verify memory policy and precompile wiring without opening the game or touching GPU memory.
- Full launcher test suite and isolated-worktree Windows native build are required prior to pushing this work.
- Native build passing alone does **not** prove memory, gameplay, FPS, or BSOD safety. No automated runtime/game/shader precompile test. Later user-initiated, supervised in-game comparisons can evaluate A flags one at a time; B Giveback must remain off until independent safety validation.
