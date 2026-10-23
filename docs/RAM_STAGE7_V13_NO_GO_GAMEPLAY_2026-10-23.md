# Stage 7E — v13 REAL GAMEPLAY RESULT: NO-GO (2026-10-23)

## Evidence gathered from user-run test (no new gameplay started by assistant)

Latest gameplay log: `_Build/run-logs/20261023-165745-068.out.log` (16:57:45–17:05:04 local, ~7m19s).
Latest RAM read-only census: `_Build/run-logs/ram-census-stage7-v13.txt` (16:59:21–17:04:56, **12/12 snapshots**, PID 7040).
Stderr file for same session has **zero bytes**, but this is *not* a runtime safety guarantee.
Previous baselines:
- `_Build/run-logs/ram-census-v12.txt` (12 snapshots, 15:15:37–15:21:11; Texture Residency Probe On).
- `_Build/run-logs/ram-census-v3.txt` (12 snapshots, 15:33:35–15:39:08; Texture Residency Probe On).
- Earlier v11 gameplay log `20261023-140733-513.out.log`.

All compared v3/v12/v13 logs show Demon's Souls HD 1920×1080 PS5 Pro/DLSS rendering. However, exact character route, progression, host background load, shader warmup and foreground activity are not matched. Probe On in v3/v12 is a controlled-setting difference: avoid strict causal claims.

## RAM samples

| Metric (MiB) | v3 (earlier session) | v12 (earlier session) | v13 Stage7 |
|---|---:|---:|---:|
| Starting system available physical | 5093 | 4799 | 4634 |
| Ending system available physical | 3392 | 1349 | **827** |
| Minimum observed system available physical | 2920 | 1198 | **625** |
| Starting process working set | 11023 | 11169 | 11240 |
| Ending process working set | 12520 | 13501 | **13799** |
| Starting process private bytes | 9244 | 8861 | 9222 |
| Ending process private bytes | 9103 | 9969 | 9483 |
| Peak process private bytes | 9462 | 10591 | 9768 |
| Ending committed MEM_PRIVATE VQE | 8646 | 9508 | 9024 |
| Ending committed MEM_MAPPED VQE | 26871 | 27898 | 28033 |

**Crucial:** Stage7 v13 has *less process private commit than v12* at end (~486 MiB) but *more process working set and less globally available physical RAM*. This means the objective is **not met**. It does NOT prove all 522 MiB lower available RAM is caused by v13, due to unmatched play/background load and mapped residency. MEM_MAPPED committed size can alias and should never be added to physical memory.

## Stage 7 subsystems actually exercised

- `Stage7 staging:` repeatedly reports **blocks=1, created=1, trimmed=0, cached_mib=16**, main contiguous staging ring 256 MiB. Thus the chunk pool never grew past one block and no chunk reclaim occurred. It cannot be a several-GiB RAM solution in this measured workload.
- `Stage7 guest backing:` reached **2,752 MiB, 6,898 requests** logical backing reads over entire run. This is **cumulative logical bytes requested**, *not* bytes offloaded or freed and not measured SSD disk read throughput.
- `Stage7 host GC:` periodically logged image reuse pool trim after host RAM critical. **Existing log does not report image bytes actually released**, so do not infer that the calls freed RAM.
- GPU system memory in log was ~589 MiB at flip 11580; GPU local usage ~5.1–5.5 GiB out of reported 11175 MiB. Major WDDM committed allocations are not necessarily within an emulator-controllable idle cache.

## Stutter/regression signal

Latest v13 pipeline summary: **4,288 evicted**; **982 remade**, ~1,932 ms cumulative remake work, with worst reported ~173.3 ms.
v12 earlier: 2,964 evicted; 493 remade, 622 ms cumulative and worst ~22.8 ms.
v3 earlier: 2,372 evicted; 2 remade, 9 ms cumulative, worst ~8 ms.
v11 older: 1,857 evicted; 507 remade, ~687 ms, worst ~16.2 ms.

These are not matched gameplay trials, so cannot claim Stage7 *caused* the difference. Nevertheless, the v13 result fails the requested low-stutter target and is a serious warning.

The common existing pipeline policy activates **emergency** below 1 GiB available (`src/graphics/host_gpu/renderer/pipeline/pipelineCache.cpp` `EvictIdlePipelines`). The policy `src/local/memory-pressure.h` uses `{90 seconds idle, 128 evictions/scan, 0 seconds remake protection}` in emergency mode. This is an intentional memory-survival tradeoff, but can produce re-eviction and rebuild under persistent pressure. It was **not introduced by Stage7**, yet the v13 game spent multiple snapshots below 1 GiB, making the emergency trigger relevant. Avoid relaxing it without a proven remedy for RAM exhaustion and BSOD risk.

`_Build/run-logs/20261023-165745-068.err.log` is empty; the session reached a normal final graphics/pipeline summary. No fatal errors found in stderr. This does not prove gameplay visually correct or stable under all scenes.

## Decision: v13 NO-GO

Reject Stage7 v13 for **recommended gameplay / production default** and leave `stage7_ram=false` (default) unchanged. Existing v11 remains preferred for gameplay pending a better verified candidate. v12 remains a diagnostic comparator with Texture Probe Off for normal play, but the available earlier v12/v3 measured runs had Probe On.

**Do not** announce a RAM saving from a 512→256 MiB ring: actual Windows available RAM did not improve. The v13 fixed 256 MiB ring might push >256 MiB texture uploads to a temporary GPU buffer, increasing churn. The 16 MiB pool/idle image trim also did not demonstrate verified physical RAM savings. Do not turn aggressive eviction higher in response.

**Next engineering gate:** identify actual *physically resident and reclaimable* WDDM/Vulkan allocations by owner and lifetime; measure idle image-pool bytes returned rather than log only calls; build a **separately isolated** candidate with at most one memory-policy change per A/B pass. Consider restoring the 512 MiB contiguous staging capacity before profiling texture fallback effects. Avoid GPU-only SSD swap until fully reversible Vulkan/guest coherency and restore correctness is proven. Keep the Stage5 unsafe mapped `DiscardVirtualMemory` path blocked.

## Safety

No new game or stress test was run; no existing game saves, shader caches, user settings or binaries modified. v13 remains available as experimental evidence, but is not recommended. No upstream chenxiao BSOD fix was merged. Existing unrelated dirty working-tree files must not be staged.
