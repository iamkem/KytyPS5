# RAM Safety Mode audit — 2026-10-24 (KytyPS5)

## Scope and evidence

- Source: integration worktree `KytyPS5-93e7e50d`, branch `integration/chenxiao-v20261023b-20261023`, initial HEAD `a6d20d08`.
- Installed configuration: `C:\Users\hoang\Desktop\dev\KytyPS5\launcher-settings.json` (observed 2026-10-24 02:16 local).
- Latest executable: `C:\Users\hoang\Desktop\dev\KytyPS5\_Build\latest\native-build\kyty_emulator.exe`.
- Runtime history, inspected read-only: `_Build/run-logs/20261024-012441-887.out.log` (Safety ON) and `20261024-021155-770.out.log` (Safety OFF).
- No game, shader precompile, stress test, cache deletion, save modification, or automated memory-pressure reproduction during this audit.

## Installed settings and launcher wiring

Installed `ram_safety=false`, `ram16_backing=true`, `ram_diet=true`, `vram_budget_mb=0`, `fps30=true`, `framegen=0`, `lowlatency=false`, `quality=lowest`, output `4k` and DLSS render height 1080. Launcher source defaults to `ram_safety=true`, but `loadSettings` honors the saved value. A read-only `buildPlayArgs` check confirms that the current saved config propagates `KYTY_RAM_DIET=1`, `KYTY_FLIP_RATE=1`, `KYTY_BACKING_FILE=1`, `KYTY_BACKING_ON_DEMAND=1`, and forces `KYTY_TEXTURE_OFFLOAD=0`, `KYTY_TEXTURE_OFFLOAD_PROBE=0` **without** requesting `KYTY_ADAPTIVE_RAM=1`.

When enabled, RAM Safety passes `KYTY_ADAPTIVE_RAM=1`, `KYTY_PREFETCH_MIN_AVAIL_MB=4096`, `KYTY_SHADER_PREFETCH_THREADS=1`, `KYTY_SHADER_FOLLOW_THREADS=1`. This does not cap process RAM: on-demand shader translation and shader-follow helpers remain possible. The independent offline shader precompile/cache files are not disabled or removed by RAM Safety.

- Adaptive texture retirement: physical RAM tiers (24 GiB nominal host) below 4 GiB elevated and 2 GiB critical, with 1 GiB recovery hysteresis, sampled every 60 flips. Idle images are retired after 1200/900/720 unused flips at most 16/20/24 per flip, subject to GPU ownership / depth and registered-image protections. The normal idle texture GC continues even when RAM Safety is OFF.
- Adaptive pipeline eviction: normal/elevated/critical/emergency inactivity of 300/240/180/90 seconds; scan caps 32/32/64/128. Remade pipelines get 600 seconds protection except in emergency below 1 GiB. Only remake-capable, sufficiently idle driver handles can be destroyed, not disk shader binaries. Synchronous remakes can produce stutter. With RAM Safety OFF but RAM Diet ON, the normal RAM Diet pipeline policy remains active.
- Adaptive guest backing omits the `FILE_ATTRIBUTE_TEMPORARY` caching hint for a sparse delete-on-close guest file, letting Windows write back cold mapped pages normally. It does not explicitly discard pages, impose working-set limits or guarantee reclamation. RAM16 is a separate independent setting; logs verify sparse file backing was created.
- Fresh Memory is enabled by default unless `KYTY_FRESH_MEMORY=0`. It substitutes zero fills for known never-written 64 KiB guest granules instead of reading in untouched pages; it is not an Adaptive RAM toggle.
- Texture Offload and probe remain forcibly OFF from the launcher. Do not activate destructive mapped-page discard: file-backed `DiscardVirtualMemory` previously failed with error 1224 / data changes in isolated validation.

## Recent runtime evidence (not controlled A/B)

| Statistic | ON: 20261024-012441 | OFF: 20261024-021155 |
| --- | ---: | ---: |
| Prefetch workers | 1 | 2 |
| Prefetch stop threshold | 4096 MiB | 1024 MiB |
| Lowest observed free physical RAM | 444 MiB (shader log) | 489 MiB (PC memory log) |
| Released driver pipelines by session end | 1005 | 64 |
| Pipelines recreated synchronously | 238 | 0 |
| Cumulative remake time | 418 ms | 0 ms |
| Worst remake | 41.7 ms | 0 ms |

These runs differ in time, scenes, cache state and workload; they do **not** prove OFF improves FPS/1% lows or memory use. With free RAM below 500 MiB in both, the 24 GiB host has dangerously little headroom. Safety ON demonstrably reduces the amount of speculative background work allowed when available RAM becomes low, but is not an OOM/BSOD guarantee. In the ON log, Vulkan video usage reached 7093 MiB against 11175 MiB budget near the end, so VRAM budget exhaustion is not proven as the primary cause of host RAM pressure.

## Follow-up: existing Stage 8 physical-residency sample

The existing `_Build/run-logs/ram-residency-v11.txt` (UTF-16LE) was inspected read-only. It was captured during a different v11 session with **2337.19 MiB system available** and **11793.05 MiB actual emulator process working set**. `QueryWorkingSetEx` statistically estimated **11929.79 MiB** across virtual address groups: `MAPPED_OTHER` **8057.78 MiB**, `PRIVATE_OTHER` **1876.39 MiB**, `PRIVATE_16MiB` **1157.72 MiB**, `MAPPED_LARGE` **543.25 MiB**, `PRIVATE_32MiB` **156.74 MiB**, `IMAGE` **137.91 MiB**.

`MAPPED_OTHER` is the largest resident *virtual mapping category*, not a demonstrated 8 GiB of unique or reclaimable RAM. The `GuestBackingStore` source maps the sparse guest backing into multiple fixed-address guest views (`MapViewOfFile3`, `MEM_MAPPED`), which plausibly account for much of this category. Aliases can refer to the same physical pages; the sampling method takes only one page per 256 KiB. The observed 32-MiB private allocation cohorts were mostly **nonresident in this snapshot** (~157 MiB estimated out of ~3584 MiB committed). This limits the value of inferring physical RAM use directly from earlier multi-GiB WDDM ETW commit totals.

Prior Stage 7 v13 resource-residency experiment was **NO-GO** on user gameplay: under 1 GiB free and severe pipeline remakes, with no proven savings. Do not re-enable it or attempt destructive mapped discard. The next measurement must identify mapped aliases / retained guest mapping ownership and physically resident versus shared pages before any memory-release experiment.

## Conservative improvement and verification

The only native logic change made this checkpoint was to stop iterating the graphics and compute pipeline maps immediately after the existing per-scan eviction quota is met. Previously the scan continued even though its eviction lambda could not release more pipelines. Eligibility, bookkeeping, quota and rebuild behavior are unchanged. Independent read-only review found no semantic regression in the changed control flow.

- Native incremental CMake build: **PASS**, target `kyty_emulator`, into the single existing `_Build/latest/native-build` (no duplicate build, no game execution).
- Launcher/cache Node suites: **55 total; 49 PASS, 0 FAIL, 6 SKIP**. The skips require a local emulator/game under the integration worktree; they do not indicate runtime correctness.
- `git diff --check`: **PASS**.
- Gameplay/runtime performance of this patch: **NOT TESTED**.

## Priorities / gates

1. Keep file-backed RAM16, RAM Diet and texture-offload-disable policy; do not change saved user settings automatically. Safety ON should be preferred when stability and pressure control matter more than possible pipeline remake spikes, but only after a consciously supervised short test; current saved settings are OFF.
2. Focus on `MAPPED_OTHER` (~8058 MiB sampled resident virtual mappings) and determine how much corresponds to active guest mappings versus aliases or stale parked ranges. Distinguish process working set, unique physical page ownership, private commit, and WDDM accounting; do not treat any mapped view as safely discardable without data-lifetime proof.
3. Independently verify whether pipeline eviction under sub-1 GiB RAM is a useful tradeoff: ON evicted many more pipelines and remade 238. A 1 GiB emergency threshold has no hysteresis; evaluate a bounded, conservative redesign only with evidence and reversible measurements.
4. Remaining source risks: the pipeline 32,768-flip timestamp ring cannot represent a 300-second idle horizon at sustained 120 flips/s (not triggered by current saved 30 FPS cap); texture retirement may traverse too many protected LRU candidates each flip; those need separately bounded/correctness-tested changes rather than speculative tuning.
5. A short *user-initiated* identical-scene A/B is required for FPS, 1% lows, disk paging and crash safety. Do not start it automatically; stop if free memory approaches 1 GiB or any system instability occurs. Never delete saves, shader caches, hints or seeds.
