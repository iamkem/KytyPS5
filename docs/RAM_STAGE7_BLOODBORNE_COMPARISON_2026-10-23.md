# Stage 7 Architecture Review — Borrowing Bloodborne PC's Memory Policy (2026-10-23)

## Scope and sources

User priority: **reduce actual physical RAM without undoing v11's stutter improvements**. The chenxiao BSOD fix is explicitly out of scope for this stage. Avoid autoplay / memory stress on the Windows host.

External source inspected:
- Supermedo/bloodborne_pc, branch `windows`, based on bbport (Bloodborne-specific x86-64 PS4 runtime + shadPS4-derived Vulkan renderer), not a generic natively authored PC game.
- `gpu/shadps4/video_core/renderer_vulkan/vk_staging_buffer_pool.cpp`
- `gpu/shadps4/video_core/texture_cache/texture_cache.cpp`
- Windows release notes `windows-v1.9.3` and preceding `v1.9.1-v1.9.2` (October 2026).

**A smaller RAM figure in Bloodborne has NOT been measured on this user's machine in the same conditions.** It is not a fair apples-to-apples memory budget against a PS5-era remake.

## Confirmed comparative findings

| Pattern | Bloodborne bbport/Supermedo | KytyPS5 current source | Port decision |
|---|---|---|---|
| Staging uploads | 16 MiB blocks, on-demand growth, per-block last-used frame, GPU-tick-safe retirement, keep count, 30-second-ish intent; `BB_STAGING_KEEP_MB` default 512 | `BufferCache::m_staging_buffer` is fixed 512 MiB, plus 64/32-MiB upload/download buffers | **Candidate**, replace one fixed ring with adaptive block pool, preserving device-address and non-coherent semantics and continuous GPU in-flight use |
| GPU-only scratch | Separate `BB_STAGING_KEEP_VRAM_MB` default 32; search from first block to allow new blocks to cool | `m_staging_device` fixed 64 MiB and other utility buffers | Candidate, but expected savings limited; count and prove ownership first |
| GC age | Real-time idle thresholds (20 seconds normal/5 under pressure) with minimum tick protection and custom critical fallback | `RetireStaleImages` has idle flips (1200/900/720) with safety gates; main GC only when over VRAM budget | **Adapt ideas, not numeric thresholds**; flip-based timer varies with frame rate |
| Data safety | Marks GPU-modified/tiled resources non-droppable by default; prior unsafe `BB_GC_DROP_OLD` caused black screen in Hunter's Dream | Kyty also has protection for GPU-modified images and safe download conditions | **Keep safety**; never destroy non-restorable GPU-only content |
| Retry under OOM | `ReclaimMemoryFor`: eligible unbound clean idle textures, wait submitted, clear 64→256→1024 MiB, retry | Kyty already has image pool trimming and failure/GC path | Could adapt escalation if and only if host/GPU allocation actually fails |
| Coherent shader cache | bbport scene-specific and GPU caching optimized for one PS4 title | Kyty has 5.7 GiB on-disk static binaries, lazy payload load, and Stage 4 pipelines | **Do not disable**; Stage 6C proved shared binary handle cache does not hold the 5.7 GiB in RAM |

Important: bbport itself reverted a 1.9 graphics change in 1.9.3 due to texture stalls/black screen; V1.9.2 addressed FG memory leak and errors, and 1.9.3 frees some idle staging (~240 MiB) and right-sizes copy buffers. These are per-game empirical fixes; they do NOT establish a multi-GB physical host-RAM saving in Kyty.

## Stronger evidence from our Windows ETW

`_Build/run-logs/kyty-valloc-20261023-155803.etl` (0 lost events): Kyty PID 15312 has about 9.36 GiB outstanding virtual commit; ~6.53 GiB top stack is `dxgmms2.sys!VIDMM_RECYCLE_RANGE::Commit` through `nvoglv64.dll` and Vulkan VMA resource creation. This is WDDM outstanding commit, **not the quantity of physical RAM we can reclaim**; local VRAM usage is a separate dimension (~5.5 GiB at last logged frame). Distinguishing host-physical residency from GPU memory-driver backing is mandatory.

Census v3: 116 private allocation groups ~32 MiB (3.71 GiB committed) and 84 ~16 MiB (1.33 GiB). Exact allocation-address-to-WDDM-stack correlation has not been measured; avoid claiming they *are* those WDDM commits.

## Stage 7 implementable roadmap — ordered

**7A. Offline design and diagnostic gates (current).** Inspect verified free/lifetime contract of `BufferCache::m_staging_buffer` & `StreamBuffer`: callers `Copy, Map, Commit, DeviceAddress, GPU Submit`. Instrument pool in an isolated native candidate; distinguish allocated, mapped, in-flight, idle, resident, driver committed. No game launch by assistant. Compile/smoke tests.

**7B. Opt-in chunked upload staging pool.** Adapt bbport's 16-MiB block pattern with:
- separate 16 MiB blocks, growth only on demand, cap on cached idle blocks and 20–30 sec grace,
- strict GPU completion/timeline fence check before reclaim,
- preserve buffer device addresses, per-frame copy offsets, buffer usage flags, coherent and non-coherent flush, and ordering; support large transfers through dedicated buffers,
- staging pool has budget relative to host available RAM, not an unconditional shrinking target; prewarm a small number of blocks,
- keep old ring as default fallback; new code goes in isolated candidate and switches OFF by default until game validation.

**7C. Host-aware Vulkan cold image-buffer GC.** Only if sampled per-resource live/idle bytes and host physical RAM suggest it can help. Retire *unbound, clean, restorable*, old resources via VMA after GPU safe horizon; exclude BDA-in-use and writable render targets. Use hysteresis, bytes-per-pass and grace to avoid thrash; log actual driver private/WS/host available effect.

**7D. Storage-backed immutable resource hints.** Leverage existing game files and sparse guest backing; do not duplicate every texture to SSD. GPU-written data needs a verified guest copy or fully checked readback with consistent synchronization before retiring an image. Stage 5 file-backed `DiscardVirtualMemory` remains prohibited (error 1224 and failed byte integrity gate).

**7E. Validation.** Matched gameplay v11 baseline vs isolated 7B candidate in same scene, independent v3 RAM census, WDDM ETW and frame-time 1% lows. Accept only an actual RAM available increase with stable stutter, zero data loss, zero missing texture, and no resource race. Numeric GB reduction target TBD from measured idle bytes.

## Current engineering decision

**YES, port Bloodborne's allocation lifetime algorithms; NO, copy its whole shadPS4 renderer or assume smaller game memory load.** A 16-MiB block pool is a concrete code direction, but writing into Kyty's current `m_staging_buffer` without auditing all device-address callers risks corrupt copies; it must be a guarded experimental implementation.

No gameplay source modifications, no new running build, and no claimed savings have been made by this architecture review. Stage 4 v11 and v12 are preserved. User's existing unrelated dirty working-tree files remain untouched.

Source links:
- https://github.com/Supermedo/bloodborne_pc/blob/windows/gpu/shadps4/video_core/renderer_vulkan/vk_staging_buffer_pool.cpp
- https://github.com/Supermedo/bloodborne_pc/blob/windows/gpu/shadps4/video_core/texture_cache/texture_cache.cpp
- https://github.com/Supermedo/bloodborne_pc/releases
